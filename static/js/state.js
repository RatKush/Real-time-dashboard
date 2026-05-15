/**
 * static/js/state.js — Central Reactive State Store
 * ===================================================
 * Single source of truth for all dashboard state.
 * Components subscribe via STATE.on(key, handler).
 *
 * Key state entries:
 *   activeMarket        — currently selected tab  (string)
 *   activeChip          — currently selected chip per market  ({ market: chipName })
 *   marketsData         — full server payload  { market: { chips, contracts, ... } }
 *   marketList          — ordered list of market names
 *   cardOrders          — drag-drop order per market { market: [stratName,...] }
 *   viewMode            — "delta" | "absolute"
 *   showChartLabels     — show live value labels on strategy cards
 *   curveLens           — max points shown per market { market: number }
 *   highlightedStrategy — strategy name currently hovered (cross-link)
 *   connectionStatus    — "connecting" | "ok" | "error"
 *   lastUpdate          — timestamp of last successful poll
 */

// ── Per-market curve length defaults ─────────────────────────────────────────
// These are used when no persisted value exists for a market.
export const CURVE_LENS_DEFAULTS = {
  SR3:  15,
  ER:   12,
  SO3:  12,
  SA3:    6,
  CRA:   8,
  EMP:   4,
  MPC:   4,
  ER3:   6,
  SR1:   6,
  ZQ:    9,
  SZI0:  6,
  VIX:   6,
  VOXX:  5,
  'SR3 vs SO3': 12,
  'SR3 vs ER': 12,
  'ER vs SO3': 12,
};

const _LENS_STORAGE_KEY = 'rtd_curve_lens';
const _SKIP_STORAGE_KEY = 'rtd_curve_skip';
const _THEME_STORAGE_KEY = 'rtd_theme';

export const CURVE_SKIP_DEFAULTS = {
  SR3:  0,
  ER:   0,
  SO3:  0,
  SA3:  0,
  CRA:  0,
  EMP:  0,
  MPC:  0,
  ER3:  0,
  SR1:  0,
  ZQ:   0,
  SZI0: 0,
  VIX:  0,
  VOXX: 0,
  'SR3 vs SO3': 6,
  'SR3 vs ER':  6,
  'ER vs SO3':  6,
};

/** Load persisted lens map from localStorage (merge over defaults). */
function _loadLens() {
  try {
    const raw = localStorage.getItem(_LENS_STORAGE_KEY);
    if (raw) return { ...CURVE_LENS_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ...CURVE_LENS_DEFAULTS };
}

/** Persist the whole lens map to localStorage. */
export function saveLens(lensMap) {
  try { localStorage.setItem(_LENS_STORAGE_KEY, JSON.stringify(lensMap)); } catch (_) {}
}

function _loadSkip() {
  try {
    const raw = localStorage.getItem(_SKIP_STORAGE_KEY);
    if (raw) return { ...CURVE_SKIP_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ...CURVE_SKIP_DEFAULTS };
}

export function saveSkip(skipMap) {
  try { localStorage.setItem(_SKIP_STORAGE_KEY, JSON.stringify(skipMap)); } catch (_) {}
}

function _loadTheme() {
  try {
    return localStorage.getItem(_THEME_STORAGE_KEY) || 'classic';
  } catch (_) { /* ignore */ }
  return 'classic';
}

export function saveTheme(theme) {
  try { localStorage.setItem(_THEME_STORAGE_KEY, theme); } catch (_) {}
}

// ── State ─────────────────────────────────────────────────────────────────────
const _state = {
  activeMarket:        null,
  activeChip:          {},       // { "SR3": "Default", "SONIA": "spread", ... }
  marketsData:         {},
  marketList:          [],
  cardOrders:          {},
  viewMode:            'delta',
  showChartLabels:     false,
  curveLens:           _loadLens(),   // { market: maxPoints }
  curveSkip:           _loadSkip(),   // { market: skippedFrontPoints }
  theme:               _loadTheme(),
  highlightedStrategy: null,
  connectionStatus:    'connecting',
  lastUpdate:          null,
};

const _listeners = {};

const STATE = {
  get(key)        { return _state[key]; },

  set(key, value) {
    const old = _state[key];
    _state[key] = value;
    if (old !== value) {
      (_listeners[key] || []).forEach(fn => {
        try { fn(value, old); } catch (e) { console.error(`STATE[${key}]:`, e); }
      });
    }
  },

  on(key, handler) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(handler);
    return () => { _listeners[key] = _listeners[key].filter(f => f !== handler); };
  },

  snapshot() { return { ..._state }; },
};

export default STATE;
