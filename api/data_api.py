"""
api/data_api.py — Market Data REST Endpoints
=============================================
Endpoints:
  GET /api/data/markets                → list of market tab names
  GET /api/data/market/<n>             → raw outright contracts for one market
  GET /api/data/all                    → snapshot of every market's raw contracts
  GET /api/data/ratios                 → all strategy definitions from ratio_bg
  GET /api/data/strategies/<market>    → computed strategy series for one market
  GET /api/data/strategies_all         → computed strategies for ALL markets
  GET /api/data/status                 → connection health + current data-source mode

Design notes:
  - The workbook is re-read on every request so data is always fresh.
  - excel_reader auto-detects LIVE (Excel COM) vs DELAYED (pandas file) mode
    on every call, and logs a single banner line whenever the mode changes.
  - strategy_engine computes all rolling strategy values server-side.
  - default_strategies.py injects the "Default" chip strategies per market.
"""


import traceback
from flask import Blueprint, jsonify
import threading
import time

DATA_CACHE = {
    "markets": None,
    "mode": None,
    "timestamp": None
}


from excel_reader import (
    get_all_markets, get_market, get_ratios,
    get_current_mode, WORKBOOK_PATH,
)
from strategy_engine import compute_strategies
from default_strategies import get_default_strategies, get_chip_groups

data_bp = Blueprint("data", __name__)


# ── Raw outright data ─────────────────────────────────────────────────────────

@data_bp.route("/strategies_all", methods=["GET"])
def strategies_all():

    if DATA_CACHE["markets"] is None:
        return jsonify({"error": "Data not ready"}), 503

    age_ms = int((time.time() - DATA_CACHE["timestamp"]) * 1000)

    return jsonify({
        "markets": DATA_CACHE["markets"],
        "mode": DATA_CACHE["mode"],
        "age_ms": age_ms
    })


@data_bp.route("/market/<market_name>", methods=["GET"])
def single_market(market_name):
    """Return raw outright contract data for one market."""
    try:
        data = get_market(market_name)
        if data is None:
            return jsonify({"error": f"Market '{market_name}' not found"}), 404
        return jsonify(data)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@data_bp.route("/all", methods=["GET"])
def all_markets():
    """Return raw outright contracts for every market.
    Response: { "markets": { "SR3": {...}, ... } }"""
    try:
        return jsonify({"markets": get_all_markets()})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── Ratio / strategy definitions ──────────────────────────────────────────────

@data_bp.route("/ratios", methods=["GET"])
def list_ratios():
    """Return all strategy definitions from ratio_bg.
    Response: { "ratios": [ { name, group, weights, n_legs }, ... ] }"""
    try:
        return jsonify({"ratios": get_ratios()})
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Computed strategy series ──────────────────────────────────────────────────

@data_bp.route("/strategies/<market_name>", methods=["GET"])
def strategies_for_market(market_name):
    
    """
    Return computed strategy series for one market.

    Response:
    {
      "market": "SR3",
      "chips": [
        {
          "chip":       "Default",
          "strategies": [ { name, group, weights, points: [...] }, ... ]
        },
        ...
      ]
    }
    """
    try:
        market_data = get_market(market_name)
        if market_data is None:
            return jsonify({"error": f"Market '{market_name}' not found"}), 404

        ratio_list = get_ratios()
        contracts  = market_data["contracts"]

        result = _build_chips(market_name, contracts, ratio_list)
        return jsonify({"market": market_name, "chips": result})

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# @data_bp.route("/strategies_all", methods=["GET"])
# def strategies_all():
#     """
#     Return computed strategy series for every market in one payload.
#     This is the primary endpoint polled by the frontend every 1.5 s.

#     Response:
#     {
#       "markets": {
#         "SR3":   { "market": "SR3", "mode": "live",    "chips": [...] },
#         "SONIA": { "market": "SONIA", "mode": "live",  "chips": [...] },
#         ...
#       },
#       "mode": "live"    ← current data-source mode for the whole payload
#     }
#     """
#     try:
#         all_mkt    = get_all_markets()
#         ratio_list = get_ratios()
#         mode       = get_current_mode()

#         payload = {}
#         for mkt_name, mkt_data in all_mkt.items():
#             contracts = mkt_data["contracts"]
#             chips     = _build_chips(mkt_name, contracts, ratio_list)
#             payload[mkt_name] = {
#                 "market":    mkt_name,
#                 "group":     mkt_data["group"],
#                 "mode":      mode,
#                 "chips":     chips,
#                 "contracts": contracts,
#             }

#         return jsonify({"markets": payload, "mode": mode})

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── Health / status ───────────────────────────────────────────────────────────

@data_bp.route("/status", methods=["GET"])
def data_status():
    """Quick probe — returns workbook health, counts, and current data mode."""
    import os
    if not os.path.exists(WORKBOOK_PATH):
        return jsonify({"ok": False, "message": f"Not found: {WORKBOOK_PATH}"}), 404
    try:
        data   = get_all_markets()
        ratios = get_ratios()
        return jsonify({
            "ok":        True,
            "path":      WORKBOOK_PATH,
            "mode":      get_current_mode(),   # "live" or "delayed"
            "markets":   len(data),
            "contracts": sum(len(v["contracts"]) for v in data.values()),
            "ratios":    len(ratios),
        })
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 500


# ── Internal builder ──────────────────────────────────────────────────────────

def _build_chips(market: str, contracts: list, ratio_list: list) -> list:
    """
    Build the chip list for a market:
      Chip 0  → "Default"  (market-specific strategy selection)
      Chip 1+ → one per group in ratio_bg (all strategies in that group)

    Each chip: { chip: str, strategies: [ computed_strategy, ... ] }
    """
    chips = []

    # ── Chip 0: Default ───────────────────────────────────────────────────────
    default_defs     = get_default_strategies(market, ratio_list)
    default_computed = _apply_market_render_adjustments(
        market,
        compute_strategies(contracts, default_defs),
    )
    chips.append({"chip": "Default", "strategies": default_computed})

    # ── Chips 1+: one per group found in ratio_bg ─────────────────────────────
    for group_name in get_chip_groups(ratio_list):
        group_strats   = [s for s in ratio_list if s["group"] == group_name]
        group_computed = _apply_market_render_adjustments(
            market,
            compute_strategies(contracts, group_strats),
        )
        chips.append({"chip": group_name, "strategies": group_computed})

    return chips


def _apply_market_render_adjustments(market: str, strategies: list) -> list:
    if str(market).upper() != "SZI0":
        return strategies

    for strat in strategies:
        if strat.get("name") != "Out":
            continue
        for pt in strat.get("points", []):
            for key in ("live", "settle", "delta", "high", "low"):
                v = pt.get(key)
                if v is not None:
                    pt[key] = round(v * 100, 6)

    return strategies



## caching help
def _data_loop():
    while True:
        try:
            all_mkt    = get_all_markets()
            ratio_list = get_ratios()
            mode       = get_current_mode()

            payload = {}

            for mkt_name, mkt_data in all_mkt.items():
                contracts = mkt_data["contracts"]

                chips = _build_chips(mkt_name, contracts, ratio_list)

                payload[mkt_name] = {
                    "market":    mkt_name,
                    "group":     mkt_data["group"],
                    "mode":      mode,
                    "chips":     chips,
                    "contracts": contracts,
                }

            DATA_CACHE["markets"]   = payload
            DATA_CACHE["mode"]      = mode
            DATA_CACHE["timestamp"] = time.time()
            print("Updated at", time.time())
        except Exception:
            traceback.print_exc()

        time.sleep(0.8)   # start slow (500 ms)

def start_data_loop():
    
    t = threading.Thread(target=_data_loop, daemon=True)
    t.start()
