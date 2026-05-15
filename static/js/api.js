/**
 * static/js/api.js — Backend Fetch Helpers
 * ==========================================
 * All communication with the Flask backend passes through this module.
 * Every function uses a timeout, returns plain objects, never throws.
 *
 * Primary endpoint used by the polling loop:
 *   fetchAllStrategies() → /api/data/strategies_all
 *   Returns fully-computed strategy series for every market + chip.
 */

const BASE = '';
const TIMEOUT_MS = 8000;

async function _fetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function _json(url, opts) {
  try {
    const res  = await _fetch(url, opts);
    const data = await res.json();
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (err) {
    if (err.name === 'AbortError') return { error: 'Request timed out' };
    return { error: err.message || 'Network error' };
  }
}

/**
 * Fetch fully-computed strategy series for ALL markets.
 * This is the primary poll endpoint — called every 1.5 s.
 *
 * Response shape:
 * {
 *   markets: {
 *     "SR3": {
 *       market: "SR3",
 *       group:  "SR3",
 *       contracts: [...],          // raw outrights (for reference)
 *       chips: [
 *         {
 *           chip: "Default",
 *           strategies: [
 *             {
 *               name: "S3",
 *               group: "spread",
 *               weights: [1,-1],
 *               n_points: 3,
 *               points: [
 *                 { label:"H6", live:1.0, settle:0.75, delta:0.25, high:null, low:null },
 *                 ...
 *               ]
 *             }, ...
 *           ]
 *         },
 *         { chip: "spread", strategies: [...] },
 *         ...
 *       ]
 *     }, ...
 *   }
 * }
 */
export async function fetchAllStrategies() {
  return _json('/api/data/strategies_all');
}

/** Fetch strategies for a single market (used for targeted refresh). */
export async function fetchMarketStrategies(marketName) {
  return _json(`/api/data/strategies/${encodeURIComponent(marketName)}`);
}

/** Raw outright contracts — legacy / debugging. */
export async function fetchAllMarkets() {
  return _json('/api/data/all');
}

/** Backend health check. */
export async function fetchStatus() {
  return _json('/api/data/status');
}

/** Load saved card order for a market. */
export async function fetchCardOrder(marketName) {
  return _json(`/api/config/${encodeURIComponent(marketName)}`);
}

/** Persist card order after drag-and-drop. */
export async function saveCardOrder(marketName, order) {
  return _json(`/api/config/${encodeURIComponent(marketName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
}
