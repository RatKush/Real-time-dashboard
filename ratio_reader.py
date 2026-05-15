"""
ratio_reader.py — Ratio / Strategy Definition Parser
======================================================
Reads the "ratio_bg" sheet from the workbook and returns structured
strategy definitions that describe how to combine outright contracts.

Sheet layout (from the screenshot):
  Col A (index 0) → ratio   : Python-list string  e.g. "[1, -1]"
  Col B (index 1) → name    : Strategy label      e.g. "S3"
  Col C (index 2) → group   : Group label         e.g. "spread", "Fly"

Row 1 = header  ("ratio", "name", "group")
Row 2+ = data   (blank rows between groups are skipped)

Output per strategy:
{
  "name":    "S3",
  "group":   "spread",
  "weights": [1, -1],          # integer weight per leg (variable length)
  "n_legs":  2,                # len(weights) — number of contracts consumed
}

The "ratio" column encodes the weight vector as a JSON-style list literal.
For example:
  "[1, -1]"         → S3   = 1×C[0] − 1×C[1]
  "[1, 0, -1]"      → S6   = 1×C[0] − 1×C[2]  (C[1] skipped, weight=0)
  "[1, -2, 1]"      → L3   = 1×C[0] − 2×C[1] + 1×C[2]
  "[1, -3, 3, -1]"  → D3   = 1×C[0] − 3×C[1] + 3×C[2] − 1×C[3]

Default/special strategies are handled in default_strategies.py, not here.
This module only reads what's in the workbook.
"""

import ast
import os
import pandas as pd
from typing import Optional, List

# ── Constants ─────────────────────────────────────────────────────────────────

_RATIO_SHEET_SUFFIX = "_bg"   # sheet name ends with this
_RATIO_SHEET_NAME   = "ratio_bg"

# Column indices in ratio_bg sheet
_COL_RATIO  = 0   # Column A — weight vector as list string
_COL_NAME   = 1   # Column B — strategy name
_COL_GROUP  = 2   # Column C — group label

_HEADER_ROW = 0   # Row 1 in Excel = index 0 in pandas (skip it)
_DATA_START  = 1  # Row 2 onwards = data


# ── Public API ────────────────────────────────────────────────────────────────

def get_ratios(all_sheets: dict, mode="auto") -> List[dict]:
    """
    Parse the ratio_bg sheet from a dict of all Excel sheets.

    Args:
        all_sheets: dict returned by pd.read_excel(..., sheet_name=None, header=None)
                    Keys are sheet names, values are DataFrames.

    Returns:
        List of strategy dicts, in sheet order:
        [
          { "name": "Out",  "group": "Out",    "weights": [1]         },
          { "name": "S3",   "group": "spread", "weights": [1, -1]     },
          { "name": "S6",   "group": "spread", "weights": [1, 0, -1]  },
          ...
        ]

    Returns [] if the sheet is missing or unparseable.
    """
    # Find the ratio_bg sheet (case-insensitive)
    df = _find_ratio_sheet(all_sheets)
    if df is None:
        return []

    return _parse_ratio_df(df)





def parse_ratio_string(s: str) -> Optional[List[float]]:
    """
    Parse a weight vector string like "[1, -2, 1]" into a Python list.

    Accepts:
      - Standard JSON/Python list literals: "[1, -1]"
      - Whitespace variations: "[ 1 , -1 ]"

    Returns None if the string cannot be parsed or is empty.
    """
    if not s or not str(s).strip():
        return None
    s = str(s).strip()
    try:
        result = ast.literal_eval(s)
        if isinstance(result, (list, tuple)):
            return [float(x) for x in result]
        # Single value without brackets
        return [float(result)]
    except Exception:
        return None


# ── Internal helpers ──────────────────────────────────────────────────────────

def _find_ratio_sheet(all_sheets: dict) -> Optional[pd.DataFrame]:
    """
    Locate the ratio sheet in all_sheets.
    Tries exact match "ratio_bg" first, then case-insensitive fallback.
    """
    # Exact match
    if _RATIO_SHEET_NAME in all_sheets:
        return all_sheets[_RATIO_SHEET_NAME]

    # Case-insensitive search
    for name, df in all_sheets.items():
        if str(name).lower() == _RATIO_SHEET_NAME.lower():
            return df

    return None


def _parse_ratio_df(df: pd.DataFrame) -> List[dict]:
    """
    Parse the ratio_bg DataFrame (header=None) into strategy dicts.

    Row 0 = header row (skipped)
    Row 1+ = data
    """
    strategies = []

    # Skip the header row
    data_df = df.iloc[_DATA_START:].reset_index(drop=True)

    for _, row in data_df.iterrows():
        # ── Column A: ratio weight vector ──────────────────────────────────
        raw_ratio = row.iloc[_COL_RATIO] if len(row) > _COL_RATIO else None
        if raw_ratio is None or (isinstance(raw_ratio, float) and pd.isna(raw_ratio)):
            continue                             # blank row — skip

        weights = parse_ratio_string(str(raw_ratio))
        if not weights:
            continue                             # unparseable — skip

        # ── Column B: strategy name ────────────────────────────────────────
        raw_name = row.iloc[_COL_NAME] if len(row) > _COL_NAME else None
        if raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name)):
            continue                             # name required
        name = str(raw_name).strip()

        # ── Column C: group label ──────────────────────────────────────────
        raw_group = row.iloc[_COL_GROUP] if len(row) > _COL_GROUP else None
        if raw_group is None or (isinstance(raw_group, float) and pd.isna(raw_group)):
            group = "Other"
        else:
            group = str(raw_group).strip()
        #print(f"{name:<20} | group: {group:<10} | weights: {weights}")
        strategies.append({
            "name":    name,
            "group":   group,
            "weights": weights,
            "n_legs":  len(weights),
        })

    return strategies
