/**
 * static/js/utils.js — Shared Utility Functions
 * ===============================================
 * Pure functions: number formatting, delta colouring,
 * near-extreme detection, SVG coordinate helpers.
 *
 * getActiveStrategies now respects STATE.curveLens — it slices each
 * strategy's points array to the configured curve length for the market.
 */

import STATE from './state.js';

// ── Number formatting ─────────────────────────────────────────────────────────

export function fmtPrice(v, dp = 4) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(dp);
}

export function fmtDelta(v, dp = 4) {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(dp)}`;
}

export function deltaClass(v) {
  if (v == null || isNaN(v)) return 'neu';
  if (v > 0) return 'pos';
  if (v < 0) return 'neg';
  return 'neu';
}


// ── Near-extreme detection ────────────────────────────────────────────────────

const NEAR_THRESHOLD = 0.04;   // 4% of range

export function nearExtreme(live, allLives) {
  if (live == null || !allLives || allLives.length < 2) return null;
  const valid = allLives.filter(v => v != null);
  if (!valid.length) return null;
  const hi  = Math.max(...valid);
  const lo  = Math.min(...valid);
  const rng = hi - lo;
  if (rng <= 0) return null;
  const eps = NEAR_THRESHOLD * rng;
  if (live >= hi - eps) return 'high';
  if (live <= lo + eps) return 'low';
  return null;
}


// ── View-mode transform ───────────────────────────────────────────────────────

export function modePoint(pt, mode, ctx = {}) {
  if (mode !== 'delta') return { live: pt.live, settle: pt.settle, high: pt.high, low: pt.low };
  const s = pt.settle ?? 0;
  const mult = _deltaDisplayMultiplier(ctx);
  return {
    live:   pt.live   != null ? (pt.live   - s) * mult : null,
    settle: 0,
    high:   pt.high   != null ? (pt.high   - s) * mult : null,
    low:    pt.low    != null ? (pt.low    - s) * mult : null,
  };
}

export function modePoints(points, mode, ctx = {}) {
  return points.map(pt => modePoint(pt, mode, ctx));
}

export function deltaDisplayMultiplier(ctx = {}) {
  return _deltaDisplayMultiplier(ctx);
}

function _deltaDisplayMultiplier(ctx = {}) {
  const strategyName = String(ctx.strategyName || ctx.name || '');
  const market = String(ctx.market || STATE.get('activeMarket') || '').toUpperCase();
  if (strategyName === 'Out' && market !== 'SZI0') return 100;
  return 1;
}


// ── SVG coordinate helpers ────────────────────────────────────────────────────

export function toY(v, minV, maxV, height, padPx = 4) {
  const range = maxV - minV;
  if (range === 0) return height / 2;
  const ratio = (v - minV) / range;
  return height - padPx - ratio * (height - padPx * 2);
}

export function toX(i, total, width) {
  if (total <= 1) return width / 2;
  return (i / (total - 1)) * width;
}

export function ptsToPath(pts) {
  const valid = pts.filter(([, y]) => y != null && !isNaN(y));
  if (!valid.length) return '';
  return valid
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}


// ── Curve lens helper ─────────────────────────────────────────────────────────

/**
 * Return the configured max-points (lens) for the current market.
 * Falls back to Infinity so all points are shown when no value set.
 */
export function getLensForMarket(market) {
  const lens = STATE.get('curveLens') || {};
  const val  = lens[market];
  return (val != null && val > 0) ? val : Infinity;
}

/**
 * Return how many front contracts are hidden before any rendering.
 */
export function getSkipForMarket(market) {
  const skip = STATE.get('curveSkip') || {};
  const val  = skip[market];
  return (val != null && val > 0) ? val : 0;
}

/**
 * Apply the current per-market curve window.
 * Skip removes the first N front points, then lens keeps the next N points.
 */
export function applyCurveWindow(strategy, market) {
  if (!strategy?.points?.length) return strategy;
  const skipPts = getSkipForMarket(market);
  const maxPts = getLensForMarket(market);
  if (skipPts <= 0 && (!isFinite(maxPts) || strategy.points.length <= maxPts)) return strategy;
  const skipped = skipPts > 0 ? strategy.points.slice(skipPts) : strategy.points;
  const points  = isFinite(maxPts) ? skipped.slice(0, maxPts) : skipped;
  return {
    ...strategy,
    points,
    n_points: points.length,
  };
}


// ── Strategy data helpers ─────────────────────────────────────────────────────

/**
 * Return the strategy list for the currently active chip of a market.
 * Points are sliced to the current curveLens value for the market.
 */
export function getActiveStrategies(market, chipName, marketsData) {
  const mktData = marketsData[market];
  if (!mktData || !mktData.chips) return [];
  const chip = mktData.chips.find(c => c.chip === chipName);
  if (!chip) return [];
  return chip.strategies.map(s => applyCurveWindow(s, market));
}

/**
 * Return the list of chip names for a market.
 */
export function getChipNames(market, marketsData) {
  const mktData = marketsData[market];
  if (!mktData || !mktData.chips) return [];
  return mktData.chips.map(c => c.chip);
}
