# Futures Curve Monitor — Setup & Run Guide

A real-time monitoring dashboard for futures curve structures.
Reads live data from your `RTD dashboard.xlsx` workbook and serves
an auto-refreshing browser dashboard.

---

## Project Structure

```
dashboard/
│
├── server.py              # Flask app entry point
├── excel_reader.py        # Workbook parser (column mapping lives here)
├── requirements.txt       # Python dependencies
│
├── api/
│   ├── __init__.py
│   ├── data_api.py        # REST endpoints: /api/data/*
│   └── config_api.py      # Layout persistence: /api/config/*
│
├── templates/
│   └── index.html         # Single-page shell
│
├── static/
│   ├── css/
│   │   ├── base.css       # Design tokens & reset
│   │   ├── layout.css     # Top-bar, tabs, main panel
│   │   ├── chart.css      # Strategy card & mini-chart
│   │   └── table.css      # Ratio table
│   └── js/
│       ├── state.js       # Central reactive state store
│       ├── api.js         # Backend fetch helpers
│       ├── utils.js       # Math & formatting utilities
│       ├── curve.js       # Top curve chart renderer
│       ├── chart.js       # Strategy mini-chart renderer
│       ├── grid.js        # Drag-and-drop strategy grid
│       ├── table.js       # Ratio table renderer
│       ├── focus.js       # Focus modal (expanded view)
│       ├── tabs.js        # Tab bar
│       └── app.js         # Bootstrapper & polling loop
│
└── config/
    └── layout.json        # Auto-created — stores drag-and-drop card orders
```

---

## Data Column Mapping

The parser reads each sheet in `RTD dashboard.xlsx` as follows:

| Column | Index | Field   | Usage              |
|--------|-------|---------|--------------------|
| C      | 2     | Name    | X-axis / card label |
| H      | 7     | Settle  | Settle price        |
| K      | 10    | Mid     | Live price          |

- Row 1 (index 0) → group label (e.g. "SR3")
- Row 2 (index 1) → column headers (skipped)
- Row 3+ (index 2+) → contract data rows

To adjust column mapping, edit the constants at the top of `excel_reader.py`:
```python
_COL_NAME   = 2   # Column C
_COL_SETTLE = 7   # Column H
_COL_MID    = 10  # Column K
```

Sheets whose names end with `_bg` are ignored (e.g. `cont list_bg`).

---

## Prerequisites

- Python 3.9+
- `RTD dashboard.xlsx` placed in the **same folder as `server.py`**

---

## Installation

```bash
# 1. Navigate to the dashboard folder
cd dashboard

# 2. Create a virtual environment 
python -m venv .venv 
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt
```

---

## Running

```bash
python server.py
```

Then open your browser at: **http://localhost:5000**

The dashboard polls the workbook every **1.5 seconds**.
Save the workbook (Ctrl+S in Excel) to push updates to the browser.

---

## Production (optional)

For a more robust deployment, use gunicorn:

```bash
pip install gunicorn
gunicorn -w 1 -b 0.0.0.0:5000 server:app
```

Use `-w 1` (one worker) because multiple workers would each re-read the
file independently, which is fine but wasteful. A single worker handles
the 1.5-second polling load easily.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Workbook not found` error on load | Move `RTD dashboard.xlsx` to the same folder as `server.py` |
| All markets show `—` for prices | Check column indices in `excel_reader.py`; open the file and count columns |
| Sheets not appearing as tabs | Ensure sheet names don't end in `_bg` |
| Layout not persisting | Check write permissions on the `config/` folder |

---

## Extending

**Add High/Low data**: Once your RTD feed includes high/low prices,
add their column indices in `excel_reader.py` and populate the
`"high"` and `"low"` fields. All charts will pick them up automatically.

**Add time-series history**: The focus modal in `focus.js` is designed
to accept a time-series once tick data is available.
Replace the scalar chart in `_renderExpandedChart()` with a line chart
using the `ptsToPath()` helper from `utils.js`.

**Change poll interval**: Edit `POLL_INTERVAL_MS` in `app.js`.
