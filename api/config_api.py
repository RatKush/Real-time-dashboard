"""
api/config_api.py — User Configuration Persistence Endpoints
=============================================================
Provides:
  GET  /api/config/<market>    → fetch saved card order for a market
  POST /api/config/<market>    → save card order after drag-and-drop
  DELETE /api/config/<market>  → reset to default order

Layout preferences are stored in a local JSON file (config/layout.json)
so they survive server restarts without needing a database.

JSON structure of layout.json:
{
  "SR3":  ["H6", "M6", "U6", "Z6", ...],   // ordered list of contract names
  "SR1":  [...],
  ...
}
"""

import json
import os

from flask import Blueprint, jsonify, request

# ── Constants ─────────────────────────────────────────────────────────────────

# config/ directory lives alongside server.py
_CONFIG_DIR  = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
_LAYOUT_FILE = os.path.join(_CONFIG_DIR, "layout.json")

# ── Blueprint ─────────────────────────────────────────────────────────────────
config_bp = Blueprint("config", __name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_layout() -> dict:
    """Read the layout file from disk.  Returns {} if it doesn't exist yet."""
    if not os.path.exists(_LAYOUT_FILE):
        return {}
    with open(_LAYOUT_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save_layout(layout: dict) -> None:
    """Persist the entire layout dict to disk (atomic-ish via tmp rename)."""
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    tmp = _LAYOUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(layout, fh, indent=2)
    os.replace(tmp, _LAYOUT_FILE)   # atomic on POSIX; best-effort on Windows


# ── Routes ────────────────────────────────────────────────────────────────────

@config_bp.route("/<market>", methods=["GET"])
def get_layout(market: str):
    """
    Fetch the saved card order for a market.

    Response: { "market": "SR3", "order": ["H6", "M6", ...] }
    Returns an empty order list if no preference has been saved yet.
    """
    layout = _load_layout()
    order  = layout.get(market, [])
    return jsonify({"market": market, "order": order})


@config_bp.route("/<market>", methods=["POST"])
def save_layout(market: str):
    """
    Persist the card order after a drag-and-drop rearrangement.

    Request body: { "order": ["Z6", "H6", "M6", ...] }
    Response:     { "ok": true, "market": "SR3", "order": [...] }
    """
    body = request.get_json(silent=True)
    if not body or "order" not in body:
        return jsonify({"error": "Request must include { order: [...] }"}), 400

    order = body["order"]
    if not isinstance(order, list):
        return jsonify({"error": "'order' must be an array"}), 400

    layout = _load_layout()
    layout[market] = order
    _save_layout(layout)

    return jsonify({"ok": True, "market": market, "order": order})


@config_bp.route("/<market>", methods=["DELETE"])
def reset_layout(market: str):
    """
    Remove any saved layout for a market, reverting to default (data) order.

    Response: { "ok": true, "market": "SR3" }
    """
    layout = _load_layout()
    layout.pop(market, None)
    _save_layout(layout)
    return jsonify({"ok": True, "market": market})
