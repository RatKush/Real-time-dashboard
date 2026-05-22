"""
default_strategies.py — Default Chip Strategy Definitions
==========================================================
Defines which strategies appear on the "Default" chip for each market.

Rules:
  ── General markets (all except the special groups below):
     Out, S3, S6, S12, L3, L6, L12, D6
     (Note: ratio variants are excluded from general defaults)

  ── Group A  {EMP, MPC, SZI0}:
     Out
     Out-ratio variants:
       1×O − 2×O(n+1)     weights: [1, -2]
       2×O − 1×O(n+1)     weights: [2, -1]
       2×O − 3×O(n+1)     weights: [2, -3]
       3×O − 2×O(n+1)     weights: [3, -2]
     S1-ratio variants:
       1×S1 − 2×S1(n+1)   weights: [1, -3, 2]
       2×S1 − 1×S1(n+1)   weights: [2, -3, 1]
       2×S1 − 3×S1(n+1)   weights: [2, -3]
       3×S1 − 2×S1(n+1)   weights: [3, -2]
     S3, S6, L3, L6

  ── Group B1 {SR1, ZQ}:
     Out
     S1-ratio variants:
       1×S1 − 2×S1(n+1)   weights: [1, -3, 2]
       2×S1 − 1×S1(n+1)   weights: [2, -3, 1]
       2×S1 − 3×S1(n+1)   weights: [2, -3]
       3×S1 − 2×S1(n+1)   weights: [3, -2]
     S3, S6, L3

  ── Group B2 {VIX, VOXX}:
     Out
     S1-ratio variants:
       1×S1 − 2×S1(n+1)   weights: [1, -3, 2]
       2×S1 − 1×S1(n+1)   weights: [2, -3, 1]
       2×S1 − 3×S1(n+1)   weights: [2, -3]
       3×S1 − 2×S1(n+1)   weights: [3, -2]
     S3, L3, D3

  ── Inter group  {markets added dynamically}:
     Default strategies: S3, S6, S12, L6, L12
     Strategy names are suffixed as "Name vs Name"
       e.g. S12 → "S12 vs S12", L6 → "L6 vs L6"

The "Default" chip is always the first chip — group chips follow in the
order they appear in ratio_bg (deduplicated, preserving first occurrence).
"""

from typing import List, Dict, Optional


# ── Market groupings ──────────────────────────────────────────────────────────

# Group A — out ratio + s1 ratio + spread variants
_GROUP_A_MARKETS = {"EMP", "MPC", "SZI0"}

# Group B1 - short-end default set
_GROUP_B1_MARKETS = {"SR1", "ZQ"}

# Group B2 - vol default set
_GROUP_B2_MARKETS = {"VIX", "VOXX"}

# Inter group — inter-market strategies with dynamic "Name vs Name" labelling
# Add markets here as they are introduced
_INTER_MARKETS = {"SR3 VS SO3", "SR3 VS ER", "ER VS SO3"}

# General default strategy names — ratio variants are intentionally
# excluded; matched case-insensitively against ratio_bg names.
_GENERAL_DEFAULT_NAMES = ["Out", "S3", "S6", "S12", "L3", "L6", "L12", "D6"]

# Inter default strategy base-names (before "vs" renaming)
_INTER_DEFAULT_NAMES = ["S3", "S6", "S12", "L6", "L12"]


# ── Inline ratio strategy specs ───────────────────────────────────────────────

# Out-ratio variants — used by Group A only
_OUT_RATIO_EXTRA = [
    {"name": "1×O−2×O(n+1)",  "group": "Default", "weights": [1, -2], "n_legs": 2},
    {"name": "2×O−1×O(n+1)",  "group": "Default", "weights": [2, -1], "n_legs": 2},
    {"name": "2×O−3×O(n+1)",  "group": "Default", "weights": [2, -3], "n_legs": 2},
    {"name": "3×O−2×O(n+1)",  "group": "Default", "weights": [3, -2], "n_legs": 2},
]

# S1-ratio variants — used by Group A and Group B
_S1_RATIO_EXTRA = [
    {"name": "1×S1−2×S1(n+1)", "group": "Default", "weights": [1, -3, 2], "n_legs": 3},
    {"name": "2×S1−1×S1(n+1)", "group": "Default", "weights": [2, -3, 1], "n_legs": 3},
    {"name": "2×S1−3×S1(n+1)", "group": "Default", "weights": [2, -3], "n_legs": 2},
    {"name": "3×S1−2×S1(n+1)", "group": "Default", "weights": [3, -2], "n_legs": 2},
]


# ── Public API ────────────────────────────────────────────────────────────────




def get_default_strategies(
    market: str,
    ratio_list: List[dict],
) -> List[dict]:
    """
    Return the list of strategy definitions for the "Default" chip
    of a given market.

    Args:
        market:     Market name (sheet name), e.g. "SR3", "VIX"
        ratio_list: All strategies parsed from ratio_bg (from ratio_reader)

    Returns:
        Ordered list of strategy dicts suitable for strategy_engine.
        Each dict has: { name, group, weights, n_legs }
    """
    mkt_upper = market.upper()

    # Build a lookup map: name.lower() → strategy dict
    ratio_by_name: Dict[str, dict] = {
        s["name"].lower(): s for s in ratio_list
    }

    if mkt_upper in _GROUP_A_MARKETS:
        return _build_group_a(ratio_by_name)

    if mkt_upper in _GROUP_B1_MARKETS:
        return _build_group_b1(ratio_by_name)

    if mkt_upper in _GROUP_B2_MARKETS:
        return _build_group_b2(ratio_by_name)

    if mkt_upper in _INTER_MARKETS:
        return _build_inter(ratio_by_name)

    return _build_general(ratio_by_name)


def get_chip_groups(ratio_list: List[dict]) -> List[str]:
    """
    Return an ordered, deduplicated list of group names from ratio_bg.
    These become the non-Default chips.

    The order follows first appearance in ratio_list.
    """
    seen   = set()
    groups = []
    for s in ratio_list:
        g = s["group"]
        if g not in seen:
            seen.add(g)
            groups.append(g)
    return groups


# ── Internal builders ─────────────────────────────────────────────────────────

def _lookup_names(
    names: List[str],
    ratio_by_name: Dict[str, dict],
) -> List[dict]:
    """
    Helper: resolve a list of strategy names against ratio_by_name.
    Unmatched names are silently skipped.
    """
    result = []
    for name in names:
        strat = ratio_by_name.get(name.lower())
        if strat:
            result.append(strat)
    return result


def _build_general(ratio_by_name: Dict[str, dict]) -> List[dict]:
    """
    Default chip for general markets.
    Returns strategies Out, S3, S6, S12, L3, L6, L12, D6 from ratio_bg.
    Unmatched names are silently skipped.
    """
    return _lookup_names(_GENERAL_DEFAULT_NAMES, ratio_by_name)


def _build_group_a(ratio_by_name: Dict[str, dict]) -> List[dict]:
    """
    Default chip for Group A markets (EMP, MPC, SZI0).

    Order:
      1. Out                    (from ratio_bg)
      2. Out-ratio variants     (inline: 1×O−2×O, 2×O−1×O, 2×O−3×O, 3×O−2×O)
      3. S1-ratio variants      (inline: 1×S1−2×S1, 2×S1−1×S1, 2×S1−3×S1, 3×S1−2×S1)
      4. S3, S6, L3, L6         (from ratio_bg)
    """
    result = _lookup_names(["Out"], ratio_by_name)
    result.extend(_lookup_names(["S3", "S6", "L3"], ratio_by_name))
    result.extend(_OUT_RATIO_EXTRA)
    #result.extend(_S1_RATIO_EXTRA)
    return result


def _build_group_b1(ratio_by_name: Dict[str, dict]) -> List[dict]:
    """
    Default chip for Group B1 markets (SR1, ZQ).

    Order:
      1. Out                    (from ratio_bg)
      2. S1-ratio variants      (inline: 1×S1−2×S1, 2×S1−1×S1, 2×S1−3×S1, 3×S1−2×S1)
      3. S3, S6, L3             (from ratio_bg)
    """
    result = _lookup_names(["Out"], ratio_by_name)
    result.extend(_lookup_names(["S3", "S6", "L3"], ratio_by_name))
    result.extend(_S1_RATIO_EXTRA)
    return result


def _build_group_b2(ratio_by_name: Dict[str, dict]) -> List[dict]:
    """
    Default chip for Group B2 markets (VIX, VOXX).

    Order:
      1. Out                    (from ratio_bg)
      2. S1-ratio variants
      3. S3, L3, D3             (from ratio_bg)
    """
    result = _lookup_names(["Out"], ratio_by_name)
    result.extend(_lookup_names(["S3", "L3", "D3"], ratio_by_name))
    result.extend(_S1_RATIO_EXTRA)
    return result


def _build_inter(ratio_by_name: Dict[str, dict]) -> List[dict]:
    """
    Default chip for Inter-group markets.

    Strategies S3, S6, S12, L6, L12 are pulled from ratio_bg and their
    display names are transformed to "Name vs Name"
      e.g.  S12 → "S12 vs S12",  L6 → "L6 vs L6"

    The underlying weights/legs are unchanged; only the display name differs.
    Unmatched base names are silently skipped.
    """
    result = []
    for base_name in _INTER_DEFAULT_NAMES:
        strat = ratio_by_name.get(base_name.lower())
        if strat:
            # Shallow-copy so we don't mutate the shared ratio_bg entry
            inter_strat = dict(strat)
            inter_strat["name"] = f"{strat['name']} vs {strat['name']}"
            result.append(inter_strat)
    return result
