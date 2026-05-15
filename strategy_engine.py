"""
strategy_engine.py — Strategy Value Calculator
================================================
Given a list of outright contracts (ordered by expiry) and a strategy
definition (weight vector), this module computes the strategy's value
at every valid "roll position" along the contract strip.

Core concept — rolling application:
  For a strategy with weights [w0, w1, w2] and contracts [C0, C1, C2, C3, ...]:
    position 0 → w0*C0 + w1*C1 + w2*C2
    position 1 → w0*C1 + w1*C2 + w2*C3
    position 2 → w0*C2 + w1*C3 + w2*C4
    ...
  This gives a time-series-like curve of strategy values across the strip.

Multiplier:
  All strategy values are multiplied by 100 (basis-points convention).
  S3 = (1×H6 − 1×M6) × 100 = 0.0025 × 100 = 0.25 bps

Output per strategy × market:
{
  "name":    "S3",
  "group":   "spread",
  "weights": [1, -1],
  "points":  [
    {
      "label":  "H6",          # label = first leg's contract name
      "live":   0.25,          # strategy value using live prices
      "settle": 0.30,          # strategy value using settle prices
      "delta":  -0.05,         # live − settle
      "high":   None,          # reserved
      "low":    None,          # reserved
    },
    { "label": "M6", "live": ..., ... },
    ...
  ],
  "n_points": 3,               # len(points) = n_contracts − n_legs + 1
}

A strategy with fewer contracts than legs has 0 valid positions — it is
returned with an empty points list (the caller should decide whether to
show it as unavailable).
"""

from typing import List, Optional, Dict


# ── Constants ─────────────────────────────────────────────────────────────────

# Multiply all strategy values by this factor (bp convention)
_SCALE = 100.0


# ── Public API ────────────────────────────────────────────────────────────────

def compute_strategies(
    contracts: List[dict],
    strategies: List[dict],
) -> List[dict]:
    """
    Compute all strategy series for a given market's contract strip.

    Args:
        contracts:  Ordered list of outright contracts from excel_reader:
                    [{ "name", "live", "settle", "high", "low" }, ...]
        strategies: Strategy definitions from ratio_reader:
                    [{ "name", "group", "weights", "n_legs" }, ...]

    Returns:
        List of computed strategy dicts (same order as input strategies).
        Strategies with insufficient contracts still appear but with
        an empty "points" list.
    """
    results = []
    for strat in strategies:
        computed = _compute_single(contracts, strat)
        results.append(computed)
    return results


def compute_single_strategy(
    contracts: List[dict],
    strategy: dict,
) -> dict:
    """
    Compute a single strategy's rolling series.

    Convenience wrapper around _compute_single, exposed for testing
    and for one-off computations in the API.
    """
    return _compute_single(contracts, strategy)


# ── Internal ──────────────────────────────────────────────────────────────────

def _compute_single(contracts: List[dict], strat: dict) -> dict:
    """
    Roll the weight vector across the contract strip and compute values.

    Args:
        contracts: outright contract list, ordered by expiry
        strat:     strategy definition { name, group, weights, n_legs }

    Returns:
        Strategy dict with a populated "points" list.
    """
    weights  = strat["weights"]
    n_legs   = len(weights)
    n_ctrs   = len(contracts)
    n_points = max(0, n_ctrs - n_legs + 1)

    points = []

    for i in range(n_points):
        # The window of contracts used for this roll position
        window = contracts[i : i + n_legs]

        # ── Compute live value ─────────────────────────────────────────────
        live_val = _weighted_sum(
            [c.get("live") for c in window],
            weights,
        )

        # ── Compute settle value ───────────────────────────────────────────
        settle_val = _weighted_sum(
            [c.get("settle") for c in window],
            weights,
        )

        # ── Compute high / low (when available) ───────────────────────────
        # High of strategy = weighted sum of highs (only valid for spreads
        # where all weights are the same sign; included for completeness)
        high_val = _weighted_sum(
            [c.get("high") for c in window],
            weights,
        )
        low_val = _weighted_sum(
            [c.get("low") for c in window],
            weights,
        )

        # ── Delta ─────────────────────────────────────────────────────────
        delta = None
        if live_val is not None and settle_val is not None:
            delta = round(live_val - settle_val, 6)

        # ── Label = first leg's contract name ─────────────────────────────
        label = window[0]["name"] if window else f"#{i}"

        points.append({
            "label":  label,
            "live":   live_val,
            "settle": settle_val,
            "delta":  delta,
            "high":   high_val,
            "low":    low_val,
        })

    return {
        "name":     strat["name"],
        "group":    strat["group"],
        "weights":  weights,
        "n_legs":   n_legs,
        "points":   points,
        "n_points": n_points,
    }


def _weighted_sum(
    values: List[Optional[float]],
    weights: List[float],
) -> Optional[float]:
    """
    Compute sum(w_i * v_i) * SCALE, returning None if any required value
    is missing (None).

    Zero-weight legs are skipped — a None price on a zero-weight leg
    does NOT invalidate the result.  This handles strategies like S6
    where the weight vector is [1, 0, -1] and C[1] may be absent.

    Args:
        values:  list of float | None, same length as weights
        weights: list of float, the strategy weight vector

    Returns:
        Scaled float or None
    """
    total = 0.0
    for w, v in zip(weights, values):
        if w == 0.0:
            continue                    # zero-weight leg — ignore missing price
        if v is None:
            return None                 # non-zero weight, price missing → invalid
        total += w * v

    return round(total * _SCALE, 6)
