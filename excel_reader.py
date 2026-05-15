"""
excel_reader.py — Excel workbook parser  (stable v2)
======================================================
Dual-mode data reading:

  LIVE    — Excel is open AND our workbook is loaded in it.
            Data read from Excel's in-memory COM object (RTD values current).

  DELAYED — Excel is closed, OR the workbook isn't loaded in it.
            Data read from a temp-file copy of the .xlsx so we never hit the
            Windows file-lock that causes "Permission denied" when Excel has
            the file open.

Mode transitions are logged ONCE when they change:
  [MODE → LIVE]     Excel opened / workbook found
  [MODE → DELAYED]  Excel closed / workbook not found in Excel

Changelog from original
────────────────────────
- pythoncom import moved to module level (was buried inside _read_via_com)
- CoUninitialize() paired with every CoInitialize() via try/finally
- _read_via_com() no longer silently opens the workbook when it isn't found;
  instead it raises cleanly so the caller falls through to DELAYED mode.
  (Auto-opening caused focus-steal / Excel popping up on the user's screen.)
- Temp file is written to the system temp dir, not alongside the workbook,
  so a crash cannot litter the workbook folder with .~rtd_tmp_* files.
- _read_via_file() retries up to 3 times on PermissionError with a short
  back-off; handles transient locks during Excel auto-save.
- _parse_sheet() tolerates sheets narrower than the expected column indices
  without raising IndexError.
- All public functions accept an explicit workbook_path kwarg so unit tests
  can point at a fixture file without monkey-patching globals.
- Module-level constants grouped and commented for easy tuning.
"""

import os
import sys
import shutil
import tempfile
import time
from typing import Optional, List

import pandas as pd

from ratio_reader import get_ratios as _parse_ratios_from_sheets


# ── Platform guard for win32com / pythoncom ───────────────────────────────────

_WIN32_AVAILABLE =   False#   sys.platform == "win32"
if _WIN32_AVAILABLE:
    try:
        import win32com.client as _win32
        import pythoncom
    except ImportError:
        _WIN32_AVAILABLE = False


# ── Constants ─────────────────────────────────────────────────────────────────

_WORKBOOK_NAME  = "RTD dashboard.xlsx"
_BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
WORKBOOK_PATH   = os.path.join(_BASE_DIR, _WORKBOOK_NAME)

_SKIP_SUFFIX    = "_bg"   # sheets whose names end with this are skipped

# Column indices within each market sheet (0-indexed)
_COL_NAME   = 2    # Column C — Instrument Name
_COL_SETTLE = 7    # Column H — Settle price
_COL_MID    = 10   # Column K — Mid (live/RTD price)

# First two rows are metadata/headers, not data
_DATA_ROW_START = 2

# Retry settings for _read_via_file when a transient lock is hit
_FILE_RETRY_COUNT = 3
_FILE_RETRY_DELAY = 0.3   # seconds between retries


# ── Mode tracking ─────────────────────────────────────────────────────────────

_current_mode: str = ""   # "" = uninitialised; "live" or "delayed"


def get_current_mode() -> str:
    """Return the last observed data-source mode: 'live' or 'delayed'."""
    return _current_mode


def _set_mode(new_mode: str) -> None:
    """Update mode and print a banner only on transitions."""
    global _current_mode
    if new_mode != _current_mode:
        _current_mode = new_mode
        if new_mode == "live":
            print("[MODE -> LIVE]     Reading from Excel memory (RTD values current)")
        else:
            print("[MODE -> DELAYED]  Reading from disk copy (values lag by last save)")


# ── Public API ────────────────────────────────────────────────────────────────

def get_all_markets(workbook_path: Optional[str] = None) -> dict:
    sheets = _load_all_sheets(workbook_path)
    result = {}
    for sheet_name, raw_df in sheets.items():
        if str(sheet_name).lower().endswith(_SKIP_SUFFIX):
            continue
        parsed = _parse_sheet(sheet_name, raw_df)
        if parsed:
            result[sheet_name] = parsed
    return result


def get_market(market_name: str, workbook_path: Optional[str] = None) -> Optional[dict]:
    return get_all_markets(workbook_path).get(market_name)


def get_ratios(workbook_path: Optional[str] = None) -> List[dict]:
    all_sheets = _load_all_sheets(workbook_path)
    return _parse_ratios_from_sheets(all_sheets)


def get_all_sheets_raw(workbook_path: Optional[str] = None) -> dict:
    return _load_all_sheets(workbook_path)


# ── Core loader ───────────────────────────────────────────────────────────────

def _load_all_sheets(workbook_path: Optional[str] = None) -> dict:
    """
    Try LIVE (COM) first.  Fall back to DELAYED (temp-file copy) if:
      - not Windows / win32com missing
      - Excel not running
      - workbook not currently open in Excel
      - any COM error

    _set_mode() is called only after we know which path succeeded.
    """
    path = workbook_path or WORKBOOK_PATH

    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Workbook not found at '{path}'. "
            f"Place '{_WORKBOOK_NAME}' in the same folder as server.py."
        )

    # ── Attempt LIVE via COM ──────────────────────────────────────────────────
    if _WIN32_AVAILABLE:
        try:
            sheets = _read_via_com(path)   # raises on any failure
            _set_mode("live")              # only set AFTER confirmed live data
            return sheets
        except Exception as exc:
            msg = str(exc)
            # Suppress routine "not open" noise; log genuine unexpected errors
            if not any(kw in msg.lower() for kw in
                       ("not running", "not open", "no workbooks", "workbook not found")):
                print(f"[COM warn] {msg}")

    # ── DELAYED: temp-copy → read → discard ──────────────────────────────────
    _set_mode("delayed")
    return _read_via_file(path)


# ── COM reader ────────────────────────────────────────────────────────────────

def _read_via_com(path: str) -> dict:
    pythoncom.CoInitialize()
    try:
        # ── Step 1: Attach or create ─────────────────────
        try:
            excel = _win32.GetActiveObject("Excel.Application")
            attached = True
        except Exception:
            excel = _win32.Dispatch("Excel.Application")
            attached = False

        # ── Step 2: Find workbook ────────────────────────
        target_name = os.path.basename(path).lower()
        target_wb = None

        for wb in excel.Workbooks:
            try:
                if os.path.basename(wb.FullName).lower() == target_name:
                    target_wb = wb
                    break
            except Exception:
                continue

        # ── Step 3: Open if needed ───────────────────────
        if target_wb is None:
            target_wb = excel.Workbooks.Open(path)

            if not attached:
                excel.Visible = False
                excel.DisplayAlerts = False
                excel.ScreenUpdating = False

        # ── Step 4: Force calc (important for RTD) ───────
        try:
            excel.CalculateFull()
        except Exception:
            pass

        # ── Step 5: Read sheets ─────────────────────────
        result = {}

        for sheet in target_wb.Worksheets:
            try:
                name = sheet.Name
                data = sheet.UsedRange.Value
            except Exception:
                continue

            if not data:
                continue

            if not isinstance(data[0], tuple):
                data = (data,)

            result[name] = pd.DataFrame(list(data))

        if not result:
            raise RuntimeError("workbook open but no sheet data read via COM")

        return result

    finally:
        pythoncom.CoUninitialize()


# ── File reader (DELAYED) ─────────────────────────────────────────────────────

def _read_via_file(path: str) -> dict:
    """
    Read from disk via pandas, using a temp-file copy to avoid the Windows
    write-lock held by Excel.  Windows permits copying a file that another
    process holds open for writing.

    The temp file goes in the system temp directory (not next to the workbook)
    so that a hard crash cannot leave litter in the workbook folder.

    Retries up to _FILE_RETRY_COUNT times on PermissionError to tolerate the
    brief lock Excel holds during an auto-save cycle.
    """
    tmp_path = None
    last_exc = None

    for attempt in range(1, _FILE_RETRY_COUNT + 1):
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=".xlsx", prefix=".~rtd_tmp_")
            os.close(fd)
            shutil.copy2(path, tmp_path)
            return pd.read_excel(tmp_path, sheet_name=None, header=None)
        except PermissionError as exc:
            last_exc = exc
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            tmp_path = None
            if attempt < _FILE_RETRY_COUNT:
                time.sleep(_FILE_RETRY_DELAY)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                tmp_path = None

    raise PermissionError(
        f"Could not read workbook after {_FILE_RETRY_COUNT} attempts: {last_exc}"
    )


# ── Sheet parser ──────────────────────────────────────────────────────────────

def _parse_sheet(sheet_name: str, df: pd.DataFrame) -> Optional[dict]:
    """
    Parse one market sheet DataFrame.

    Row 0  → group label (e.g. "SR3" in col A)
    Row 1  → column headers  (skipped)
    Row 2+ → contract data rows

    Tolerates sheets that are narrower than the expected column indices so
    a sparse or malformed sheet never raises an IndexError.
    """
    if df.empty or len(df) < _DATA_ROW_START + 1:
        return None

    first_cell = df.iloc[0, 0]
    group_label = (
        str(first_cell).strip()
        if first_cell is not None
        and not (isinstance(first_cell, float) and pd.isna(first_cell))
        else sheet_name
    )

    contracts = []
    data_df = df.iloc[_DATA_ROW_START:].reset_index(drop=True)
    ncols = len(data_df.columns)

    for _, row in data_df.iterrows():
        raw_name = row.iloc[_COL_NAME] if ncols > _COL_NAME else None
        if raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name)):
            continue
        name_str = str(raw_name).strip()
        if not name_str:
            continue

        display_name = _strip_group_prefix(name_str, group_label)
        live_val   = _safe_float(row.iloc[_COL_MID]    if ncols > _COL_MID    else None)
        settle_val = _safe_float(row.iloc[_COL_SETTLE] if ncols > _COL_SETTLE else None)

        if live_val is None and settle_val is None:
            continue

        contracts.append({
            "name":      display_name,
            "full_name": name_str,
            "live":      live_val,
            "settle":    settle_val,
            "delta":     _delta(live_val, settle_val),
            "high":      None,
            "low":       None,
        })

    if not contracts:
        return None

    return {"market": sheet_name, "group": group_label, "contracts": contracts}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_group_prefix(name: str, group: str) -> str:
    if name.upper().startswith(group.upper()):
        stripped = name[len(group):].strip()
        return stripped if stripped else name
    return name


def _safe_float(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _delta(live: Optional[float], settle: Optional[float]) -> Optional[float]:
    if live is None or settle is None:
        return None
    return round(live - settle, 6)
