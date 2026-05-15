/**
 * static/js/app.js — Application Bootstrapper & Polling Loop
 * ============================================================
 * Single entry point loaded by index.html as an ES module.
 *
 * Responsibilities:
 *   1. Import all renderer modules (registering their STATE listeners)
 *   2. Initial fetch of fully-computed strategy data (/api/data/strategies_all)
 *   3. Build the tab bar (which auto-selects the first market)
 *   4. Show the dashboard panels
 *   5. Start the 1.5-second polling loop
 *   6. Manage the connection-status pill
 *
 * Data flow on every poll:
 *   fetchAllStrategies()
 *     → STATE.set('marketsData', ...)    ← triggers curve, grid, table via listeners
 *
 * The primary data shape stored in STATE.marketsData:
 *   {
 *     "SR3": {
 *       market: "SR3",
 *       group:  "SR3",
 *       contracts: [...],            // raw outrights (reference only)
 *       chips: [
 *         { chip: "Default",  strategies: [{ name, points:[...] }, ...] },
 *         { chip: "spread",   strategies: [...] },
 *         { chip: "Fly",      strategies: [...] },
 *         ...
 *       ]
 *     },
 *     ...
 *   }
 */

// ── Imports — order matters: renderers must register STATE listeners
//    before buildTabs() fires the first render ──────────────────────────────
import STATE from './state.js';
import { fetchAllStrategies } from './api.js';
import './theme.js';

// Renderer modules — importing them registers their STATE.on() listeners
import './chips.js';        // chip bar (Default / spread / Fly / Dfly …)
import { buildGrid, updateGrid }   from './grid.js';
import { buildTable, updateTable } from './table.js';
import { buildTabs } from './tabs.js';

// ── DOM references ────────────────────────────────────────────────────────────
const panelLoadingEl = document.getElementById('panelLoading');
const panelErrorEl   = document.getElementById('panelError');
const panelErrorText = document.getElementById('panelErrorText');
const statusPillEl   = document.getElementById('statusPill');
const statusLabelEl  = document.getElementById('statusLabel');
const modeToggleEl   = document.getElementById('modeToggle');

// ── Poll cadence ──────────────────────────────────────────────────────────────
// 1500 ms keeps the dashboard feeling live without hammering the file system.
const POLL_INTERVAL_MS = 1500;


// ── Mode toggle (Δ from Settle ↔ Absolute) ───────────────────────────────────
modeToggleEl?.querySelectorAll('.mode-toggle__btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Visual state
    modeToggleEl.querySelectorAll('.mode-toggle__btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // STATE change → triggers curve.js, grid.js, table.js to re-render
    STATE.set('viewMode', btn.dataset.mode);
  });
});


// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * init() — runs once on page load.
 * Fetches the full strategy payload, sets up the UI, then starts polling.
 */
async function init() {
  _setStatus('connecting');

  const res = await fetchAllStrategies();

  if (res.error) {
    _showError(
      `Cannot connect to the workbook.\n\n${res.error}\n\n` +
      `Ensure "RTD dashboard.xlsx" is in the same folder as server.py and restart.`
    );
    return;
  }

  const marketsData = res.markets || {};
  const marketList  = Object.keys(marketsData);

  if (marketList.length === 0) {
    _showError('Workbook is reachable but no market sheets were found.');
    return;
  }

  // ── Push into STATE — renderer listeners fire here ─────────────────────────
  STATE.set('marketsData', marketsData);
  STATE.set('marketList',  marketList);

  // ── Build tab bar — auto-selects first market, triggers chip + grid render ─
  buildTabs();

  // ── Reveal the dashboard panels ────────────────────────────────────────────
  panelLoadingEl?.classList.add('hidden');

  _setStatus(res.mode === 'live' ? 'live' : 'delayed');

  // ── Start real-time polling ────────────────────────────────────────────────
  setTimeout(_poll, POLL_INTERVAL_MS);
}


// ── Polling loop ──────────────────────────────────────────────────────────────

/**
 * _poll() — called every POLL_INTERVAL_MS.
 * Fetches fresh strategy data, updates STATE (which triggers lightweight
 * in-place updates of cards and table rows), then reschedules itself.
 */
async function _poll() {
  const res = await fetchAllStrategies();

  if (res.error) {
    // Don't tear down the UI — just signal the status pill
    _setStatus('error');
  } else {
    const marketsData = res.markets || {};

    // Update data — grid/table update via their STATE.on('marketsData') listeners
    STATE.set('marketsData', marketsData);

    // If the sheet list changed (tab added/removed), rebuild the tab bar
    const newList = Object.keys(marketsData);
    const oldList = STATE.get('marketList');
    if (JSON.stringify(newList) !== JSON.stringify(oldList)) {
      STATE.set('marketList', newList);
      buildTabs();
    }

    STATE.set('lastUpdate', Date.now());
    _setStatus(marketsData[Object.keys(marketsData)[0]]?.mode === 'live' ? 'live' : 'delayed');
  }

  // Schedule next cycle regardless of success/failure
  setTimeout(_poll, POLL_INTERVAL_MS);
}


// ── UI state helpers ──────────────────────────────────────────────────────────

/**
 * Show the full-screen error panel (used only on fatal init failure).
 */
function _showError(msg) {
  panelLoadingEl?.classList.add('hidden');
  panelErrorEl?.classList.remove('hidden');
  if (panelErrorText) panelErrorText.textContent = msg;
  _setStatus('error');
}

/**
 * Update the top-bar connection pill.
 * @param {'connecting'|'ok'|'error'|'stale'} status
 */
function _setStatus(status) {
  STATE.set('connectionStatus', status);
  if (!statusPillEl || !statusLabelEl) return;

  statusPillEl.className = `status-pill status-pill--${status === 'live' || status === 'ok' ? 'ok' : status === 'delayed' ? 'stale' : 'error'}`;
  statusLabelEl.textContent = {
    connecting: 'CONNECTING…',
    live:       'LIVE',
    delayed:    'DELAYED',
    ok:         'LIVE',
    error:      'DISCONNECTED',
    stale:      'STALE',
  }[status] ?? status.toUpperCase();
}


// ── Kick off ──────────────────────────────────────────────────────────────────
init();
