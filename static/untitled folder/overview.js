/**
 * static/js/overview.js — Market Overview Tab
 * =============================================
 * A scrollable full-market overview panel.
 *
 * Layout per group:
 *   1. Group header + analytics strip (biggest move, avg Δ, spread)
 *   2. Row of market cards — each with sparkline per featured strategy + stats
 *   3. Rates group gets extended deep-dive analytics panel
 *
 * Featured strategies per group:
 *   Rates      → Out, S12, L6
 *   Meeting    → Out, 1×O−2×O(n+1), 1×O−3×O(n+2)   (1m: as-is)
 *   Inter      → S12, L12
 *   Short End  → Out, S3  (1m → S1)
 *   Vol        → Out, S3, L3 (1m → S1, L1)
 *   Other      → Out, S3, S6 (1m → S1, S2)
 */

import STATE from './state.js';
import { CURVE_LENS_DEFAULTS } from './state.js';

// ── Group config ──────────────────────────────────────────────────────────────

const TAB_GROUPS = [
  { label: 'Rates',     color: '#4a9eff', markets: ['SR3', 'ER', 'SO3', 'ER3', 'SA3', 'CRA'],
    strategies: ['Out', 'S12', 'L6'] },
  { label: 'Meeting',   color: '#f0a828', markets: ['EMP', 'MPC'],
    strategies: ['Out', '1×O−2×O(n+1)', '1×O−3×O(n+2)'] },
  { label: 'Inter',     color: '#a78bfa', markets: ['SR3 vs ER', 'SR3 vs SO3', 'ER vs SO3'],
    strategies: ['S12', 'L12'] },
  { label: 'Short End', color: '#34d399', markets: ['SR1', 'ZQ'],
    strategies: ['Out', 'S3'] },
  { label: 'Vol',       color: '#f87171', markets: ['VIX', 'VOXX'],
    strategies: ['Out', 'S3', 'L3'] },
  { label: 'Other',     color: '#94a3b8', markets: ['SZI0'],
    strategies: ['Out', 'S3', 'S6'] },
];

const _1M = new Set(['EMP', 'MPC', 'SR1', 'ZQ', 'VIX', 'VOXX', 'SZI0', 'SZIO']);
const _INTER_MARKETS = new Set(['SR3 vs ER', 'SR3 vs SO3', 'ER vs SO3']);

// ── State ─────────────────────────────────────────────────────────────────────
let _mountEl = null;
let _visible = false;

export function mountOverview(el) {
  _mountEl = el;
}

export function showOverview() {
  _visible = true;
  _mountEl?.classList.remove('hidden');
  _render();
}

export function hideOverview() {
  _visible = false;
  _mountEl?.classList.add('hidden');
}


// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL singleton tooltip — ONE element, ONE at a time, zero stacking.
// Place this near the top of overview.js, outside all functions.
// ─────────────────────────────────────────────────────────────────────────────

let _TIP = null;   // singleton DOM node
let _TIP_SVG = null; // which svg currently owns the tip

function _getTooltip() {
  if (!_TIP) {
    _TIP = document.createElement('div');
    _TIP.className = 'ov-xhair-tip';
    _TIP.style.cssText = 'display:none;position:fixed;z-index:9999;pointer-events:none;';
    document.body.appendChild(_TIP);
  }
  return _TIP;
}


STATE.on('marketsData', () => { if (_visible) _render(); });
STATE.on('viewMode',    () => { if (_visible) _render(); });

// ── Render ────────────────────────────────────────────────────────────────────

function _render() {
  if (!_mountEl) return;
  const marketsData = STATE.get('marketsData');
  if (!marketsData) return;

  _mountEl.innerHTML = '';
  const root = _div('ov-root');

  // Page header
  const ph = _div('ov-page-header');
  ph.innerHTML = `
    <div class="ov-page-title">
      <span class="ov-title-icon">◈</span>
      <span>MARKET OVERVIEW</span>
    </div>
    <div class="ov-page-meta">All markets · Live snapshot · Δ from settle</div>
  `;
  root.appendChild(ph);

  TAB_GROUPS.forEach(group => {
    // Only include markets that exist in current data
    const available = group.markets.filter(m => marketsData[m]);
    if (!available.length) return;
    const g = { ...group, markets: available };
    root.appendChild(_buildGroup(g, marketsData));
  });

  _mountEl.appendChild(root);
}

// ── Group ─────────────────────────────────────────────────────────────────────

function _buildGroup(group, marketsData) {
  const wrap = _div('ov-group');
  wrap.style.setProperty('--gc', group.color);

  // Header row
  const hdr = _div('ov-group-hdr');
  hdr.innerHTML = `
    <div class="ov-group-name">
      <span class="ov-group-dot"></span>
      <span>${group.label.toUpperCase()}</span>
    </div>
    <div class="ov-group-tags">
      ${group.strategies.map(s =>
        `<span class="ov-tag">${s}</span>`
      ).join('')}
    </div>
  `;
  wrap.appendChild(hdr);

  // Analytics strip
  const strip = _buildStrip(group, marketsData);
  if (strip) wrap.appendChild(strip);

  // Cards
  const cards = _div('ov-cards');
  group.markets.forEach(mkt => {
    cards.appendChild(_buildCard(mkt, marketsData[mkt], group));
  });
  wrap.appendChild(cards);

  // Rates deep-dive
  if (group.label === 'Rates') {
    const dd = _buildRatesDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  }

  return wrap;
}

// ── Analytics strip ───────────────────────────────────────────────────────────

function _buildStrip(group, marketsData) {
  const primary = group.strategies[0];
  const moves = [];

  group.markets.forEach(mkt => {
    const md = marketsData[mkt];
    if (!md) return;
    const chip = _chip(md, 'Default');
    if (!chip) return;
    const strat = _findStrat(chip, primary, mkt);
    if (!strat?.points?.length) return;
    const f = strat.points[0];
    if (f?.delta == null) return;
    moves.push({ mkt, delta: f.delta });
  });

  if (!moves.length) return null;

  moves.sort((a, b) => b.delta - a.delta);
  const top = moves[0], bot = moves[moves.length - 1];
  const avg = moves.reduce((s, m) => s + m.delta, 0) / moves.length;
  const spd = top.delta - bot.delta;

  const strip = _div('ov-strip');
  const pills = [
    // { l: '▲ TOP MOVER', v: `${top.mkt}  ${_fd(top.delta)}`, c: top.delta >= 0 ? 'pos' : 'neg' },
    // { l: '▼ BTM MOVER', v: `${bot.mkt}  ${_fd(bot.delta)}`, c: bot.delta >= 0 ? 'pos' : 'neg' },
    // { l: 'GROUP AVG Δ', v: _fd(avg),  c: avg >= 0 ? 'pos' : 'neg' },
    // { l: 'DISPERSION',  v: _fd(spd),  c: 'neu' },
  ];

  pills.forEach(p => {
    const pill = _div('ov-pill');
    pill.innerHTML = `
      <span class="ov-pill-l">${p.l}</span>
      <span class="ov-pill-v ${p.c}">${p.v}</span>
    `;
    strip.appendChild(pill);
  });

  return strip;
}

// ── Market card ───────────────────────────────────────────────────────────────

function _buildCard(mkt, mktData, group) {
  const card = _div('ov-card');
  card.dataset.market = mkt;

  card.addEventListener('click', () => {
    hideOverview();
    const allChips = { ...(STATE.get('activeChip') || {}) };
    if (!allChips[mkt]) allChips[mkt] = 'Default';
    STATE.set('activeChip', allChips);
    STATE.set('activeMarket', mkt);
    document.getElementById('contentRow')?.classList.remove('hidden');
  });

  const chip = _chip(mktData, 'Default');

  // Card top: market name only (no top-right stat)
  const top = _div('ov-card-top');
  top.innerHTML = `<div class="ov-card-mktname">${mkt}</div>`;
  card.appendChild(top);

  // Charts: sparkline + delta bars per strategy
  const chartsWrap = _div('ov-card-charts');
  group.strategies.forEach((stratName, idx) => {
    if (!chip) return;
    const rawstrat = _findStrat(chip, stratName, mkt);
    if (!rawstrat?.points?.length) return;

        // Slice to per-market lens length 
    const _lensMap = CURVE_LENS_DEFAULTS;
    const _lensN = _lensMap[mkt] ?? rawstrat.points.length;
    const strat = { ...rawstrat, market: mkt, points: rawstrat.points.slice(0, _lensN) };

    const isOut = stratName === 'Out';
    const color = idx === 0 ? group.color : 'rgba(168,180,204,0.5)';

    // ── Sparkline row ──────────────────────────────────────────────────────
    const cw = _div('ov-cw');
    if (idx === 0) cw.classList.add('ov-cw--primary');

    const lbl = _div('ov-cw-lbl');
    lbl.textContent = _sname(stratName, mkt);
    cw.appendChild(lbl);

    // Tally column (max upside / max downside)
    const tally = _div('ov-cw-tally');
    const pts = strat.points || [];
    const mode = STATE.get('viewMode') || 'delta';

    const vals = pts.map(p => _pointValue(p, mode));
    const validVals = vals.filter(v => v != null);
    if (validVals.length) {
      const maxVal = Math.max(...validVals);
      const minVal = Math.min(...validVals);
      const mult   = isOut && mode === 'delta' ? 100 : 1;
      const maxMove = maxVal * mult;
      const minMove = minVal * mult;
      const showUp = Math.abs(maxMove) >= Math.abs(minMove);
      const moveVal = showUp ? maxMove : minMove;
      const movePt = pts[vals.indexOf(showUp ? maxVal : minVal)];
      const moveCls = showUp ? 'pos' : 'neg';
      const moveArrow = showUp ? '▲' : '▼';

      tally.innerHTML = `
        <div class="ov-tally-row ov-tally-${moveCls}">
          <span class="ov-tally-stack">
            <span class="ov-tally-lbl"><span class="ov-tally-arrow">${moveArrow}</span>${movePt?.label ?? '—'}</span>
            <span class="ov-tally-val ${moveCls}">${_fd1(moveVal)}</span>
          </span>
        </div>
      `;
    }

    // SVG chart area (spark + fixed-pixel marker overlay)
    const sparkShell = _div('ov-spark-shell');

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'ov-spark');
    svg.setAttribute('viewBox', '0 0 280 88');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.flex = '1 1 0';
    svg.style.minWidth = '0';

    const markerLayer = _div('ov-spark-markers');

    _sparkFull(svg, strat, color, isOut, group.color, markerLayer);

    // Crosshair overlay layer + tooltip

    _attachCrosshair(svg, strat, mkt, isOut, markerLayer, color, lbl.textContent);

    sparkShell.appendChild(svg);
    sparkShell.appendChild(markerLayer);
    cw.appendChild(sparkShell);
    cw.appendChild(tally);
    chartsWrap.appendChild(cw);
  });

  card.appendChild(chartsWrap);
  // No bottom strip
  return card;
}

// ── Sparkline (full — doubled size, delta bars, smart x-axis labels) ──────────

function _sparkFull(svg, strat, color, isOut, groupColor, markerLayer) {
  // viewBox is 280×88: top 78px = sparkline, bottom 10px = x-axis labels
  const W = 280;
  const SPARK_H  = 78;   // sparkline zone height (+50% over original 52)
  const BAR_H    = 0;    // delta bars removed
  const XLAB_H   = 10;   // x-axis label zone
  const TOTAL_H  = SPARK_H + XLAB_H; // = 88
  const PAD = { t: 4, r: 4, b: 0, l: 4 };
  const cW = W - PAD.l - PAD.r;

  const ns = 'http://www.w3.org/2000/svg';
  const mk = t => document.createElementNS(ns, t);
  const pts = strat.points || [];
  if (!pts.length) return;
  const n = pts.length;
  const mode = STATE.get('viewMode') || 'delta';

  const vals = pts.map(p => _pointValue(p, mode));
  const valid = vals.filter(v => v != null);
  if (!valid.length) return;

  const maxVal = Math.max(...valid);
  const minVal = Math.min(...valid);
  const hiI = vals.indexOf(maxVal);
  const loI = vals.indexOf(minVal);

  // ── X-axis label collision avoidance ──────────────────────────────────────
  // Labels: max-upside contract, max-downside contract (+ first/last if different)
  const xp = i => PAD.l + (i / Math.max(n - 1, 1)) * cW;

  // Collect label candidates: {idx, label, anchor}
  const labelCandidates = [];
  const addLbl = (idx, lbl) => {
    if (idx < 0 || idx >= n || !lbl) return;
    const x = xp(idx);
    const anchor = x < W * 0.2 ? 'start' : x > W * 0.8 ? 'end' : 'middle';
    labelCandidates.push({ idx, lbl, x, anchor });
  };
  // Always add first + last
  addLbl(0, pts[0]?.label);
  addLbl(n - 1, pts[n - 1]?.label);
  // 1M products get every alternate label; others stay lighter at every 4th.
  const labelStep = _1M.has(strat.market ?? '') ? 2 : 4;
  for (let i = labelStep; i < n - 1; i += labelStep) {
    addLbl(i, pts[i]?.label);
  }
  // Add extremes (if different)
  if (hiI !== 0 && hiI !== n - 1) addLbl(hiI, pts[hiI]?.label);
  if (loI !== 0 && loI !== n - 1 && loI !== hiI) addLbl(loI, pts[loI]?.label);

  // De-duplicate by idx
  const seen = new Set();
  const labels = labelCandidates.filter(c => {
    if (seen.has(c.idx)) return false;
    seen.add(c.idx);
    return true;
  }).sort((a, b) => a.idx - b.idx);

  // ── Sparkline zone ─────────────────────────────────────────────────────────
  const sH = SPARK_H - PAD.t;
  let minV = minVal, maxV = maxVal;
  const rng = maxV - minV || 0.1;
  minV -= rng * 0.12; maxV += rng * 0.12;
  const yp = v => PAD.t + (1 - (v - minV) / (maxV - minV)) * sH;

  // Zero line
  if (minV <= 0 && maxV >= 0) {
    const zy = yp(0);
    const zl = mk('line');
    zl.setAttribute('x1', PAD.l); zl.setAttribute('x2', W - PAD.r);
    zl.setAttribute('y1', zy.toFixed(1)); zl.setAttribute('y2', zy.toFixed(1));
    zl.setAttribute('stroke', 'rgba(255,255,255,0.09)');
    zl.setAttribute('stroke-width', '0.8');
    zl.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(zl);
  }

  const coords = pts.map((p, i) => {
    const v = _pointValue(p, mode);
    return v != null ? [xp(i), yp(v)] : null;
  }).filter(Boolean);

  if (coords.length >= 2) {
    // Gradient fill
    const gid = `spk_${Math.random().toString(36).slice(2, 7)}`;
    const defs = mk('defs');
    const grad = mk('linearGradient');
    grad.setAttribute('id', gid); grad.setAttribute('x1','0'); grad.setAttribute('y1','0');
    grad.setAttribute('x2','0'); grad.setAttribute('y2','1');
    const s1 = mk('stop'); s1.setAttribute('offset','0%');
    s1.setAttribute('stop-color', color); s1.setAttribute('stop-opacity','0.30');
    const s2 = mk('stop'); s2.setAttribute('offset','100%');
    s2.setAttribute('stop-color', color); s2.setAttribute('stop-opacity','0.0');
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    const pathD = coords.map(([x,y],i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const baseY = (minV <= 0 && maxV >= 0) ? yp(0) : PAD.t + sH;
    const aD = `${pathD} L${coords[coords.length-1][0].toFixed(1)},${baseY.toFixed(1)} L${coords[0][0].toFixed(1)},${baseY.toFixed(1)} Z`;

    const area = mk('path');
    area.setAttribute('d', aD); area.setAttribute('fill', `url(#${gid})`);
    svg.appendChild(area);

    const line = mk('path');
    line.setAttribute('d', pathD); line.setAttribute('fill','none');
    line.setAttribute('stroke', color); line.setAttribute('stroke-width','1.6');
    line.setAttribute('stroke-linejoin','round'); line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);
  }

  pts.forEach((p, i) => {
    const v = vals[i];
    if (v == null) return;
    _addFixedMarker(markerLayer, xp(i), yp(v), W, TOTAL_H, color, 'ov-fixed-marker--node');
  });

  // Extrema dots + vertical guide lines
  [hiI, loI].forEach((idx, ei) => {
    if (idx < 0 || vals[idx] == null) return;
    const cx = xp(idx).toFixed(1);
    const cy = yp(vals[idx]).toFixed(1);
    const dotColor = ei === 0 ? 'var(--col-pos)' : 'var(--col-neg)';

    // Vertical guide from dot to x-axis label area
    const guide = mk('line');
    guide.setAttribute('x1', cx); guide.setAttribute('x2', cx);
    guide.setAttribute('y1', cy); guide.setAttribute('y2', SPARK_H.toFixed(1));
    guide.setAttribute('stroke', dotColor);
    guide.setAttribute('stroke-width', '0.5');
    guide.setAttribute('stroke-dasharray', '2 2');
    guide.setAttribute('opacity', '0.25');
    svg.appendChild(guide);

  });

  // (no separator — bar zone removed)

  // ── Delta bar chart zone ────────────────────────────────────────────────────
//   const barTop = SPARK_H + 2;
//   const barBottom = SPARK_H + BAR_H - 4;
//   const barZoneH = barBottom - barTop;

//   // Zero baseline for bars
//   const absMax = Math.max(Math.abs(maxVal), Math.abs(minVal), 0.001);
//   const mult = isOut ? 100 : 1;

//   const zeroX = xp(0); // bars grow from x position of each contract

//   // Bar zero line (horizontal baseline at mid of bar zone)
//   const bzY = ((barTop + barBottom) / 2).toFixed(1);
//   const bzl = mk('line');
//   bzl.setAttribute('x1', PAD.l); bzl.setAttribute('x2', W - PAD.r);
//   bzl.setAttribute('y1', bzY); bzl.setAttribute('y2', bzY);
//   bzl.setAttribute('stroke', 'rgba(255,255,255,0.10)');
//   bzl.setAttribute('stroke-width', '0.8');
//   svg.appendChild(bzl);

//   // Each contract gets a bar
//   const barW = Math.max(1.5, (cW / n) * 0.72);
// // FIX 5: Replace fat bars with thin impulse lines — less clutter, still readable
// const impulseW = Math.max(0.8, (cW / n) * 0.30);   // much narrower than bars
// pts.forEach((p, i) => {
//   const v = mode === 'delta' ? (p.delta ?? null) : (p.live ?? null);
//   if (v == null) return;
//   const pct = v / absMax;
//   const halfZone = barZoneH / 2;
//   const impulseH = Math.abs(pct) * halfZone;
//   const midY = (barTop + barBottom) / 2;
//   const x = xp(i);

//   // Vertical impulse line from baseline to value
//   const line = mk('line');
//   line.setAttribute('x1', x.toFixed(1));
//   line.setAttribute('x2', x.toFixed(1));
//   line.setAttribute('y1', midY.toFixed(1));
//   line.setAttribute('y2', (v >= 0 ? midY - impulseH : midY + impulseH).toFixed(1));

//   // FIX 5: muted colors, low opacity — subordinate to main curve
//   line.setAttribute('stroke', v >= 0
//     ? 'rgba(74,190,120,0.45)'    // muted green
//     : 'rgba(220,90,90,0.40)'     // muted red
//   );
//   line.setAttribute('stroke-width', impulseW.toFixed(1));
//   line.setAttribute('stroke-linecap', 'round');
//   svg.appendChild(line);

//   // Tiny cap dot at tip
//   const dot = mk('circle');
//   const tipY = v >= 0 ? midY - impulseH : midY + impulseH;
//   dot.setAttribute('cx', x.toFixed(1));
//   dot.setAttribute('cy', tipY.toFixed(1));
//   dot.setAttribute('r', '0.7');
//   dot.setAttribute('fill', v >= 0
//     ? 'rgba(74,190,120,0.55)'
//     : 'rgba(220,90,90,0.50)'
//   );
//   svg.appendChild(dot);
// });

  // ── X-axis labels ────────────────────────────────────────────────────────
  const yLbl = TOTAL_H - 1;
  labels.forEach(({ idx, lbl, x, anchor }) => {
    const isHi = idx === hiI;
    const isLo = idx === loI;
    const lc = isHi ? 'var(--col-pos)' : isLo ? 'var(--col-neg)' : 'rgba(168,180,204,0.55)';

    const grid = mk('line');
    grid.setAttribute('x1', x.toFixed(1));
    grid.setAttribute('x2', x.toFixed(1));
    grid.setAttribute('y1', PAD.t.toFixed(1));
    grid.setAttribute('y2', SPARK_H.toFixed(1));
    grid.setAttribute('stroke', 'var(--bg-raised)');
    grid.setAttribute('stroke-width', '0.3');
    //grid.setAttribute('stroke-dasharray', '2 4');
    svg.appendChild(grid);

    const tick = mk('line');
    tick.setAttribute('x1', x.toFixed(1));
    tick.setAttribute('x2', x.toFixed(1));
    tick.setAttribute('y1', (SPARK_H - 2).toFixed(1));
    tick.setAttribute('y2', (SPARK_H + 3).toFixed(1));
    tick.setAttribute('stroke', 'var(--bg-raised)');
    tick.setAttribute('stroke-width', '0.8');
    svg.appendChild(tick);

    const t = mk('text');
    t.setAttribute('x', x.toFixed(1));
    t.setAttribute('y', yLbl.toFixed(1));
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-family', 'var(--font-data)');
    t.setAttribute('font-size', '6');
    t.setAttribute('fill', lc);
    t.setAttribute('font-weight', (isHi || isLo) ? '700' : '400');
    t.textContent = lbl;
    svg.appendChild(t);
  });

  // Crosshair overlay (invisible wide rect for mouse tracking)
  const overlay = mk('rect');
  overlay.setAttribute('x', '0'); overlay.setAttribute('y', '0');
  overlay.setAttribute('width', W); overlay.setAttribute('height', SPARK_H);
  overlay.setAttribute('fill', 'transparent');
  overlay.setAttribute('class', 'ov-spark-overlay');
  overlay.dataset.pts = JSON.stringify(pts.map(p => ({
    label: p.label, live: p.live, settle: p.settle, delta: p.delta,
  })));
  overlay.dataset.isOut = isOut ? '1' : '0';
  overlay.dataset.n = n;
  overlay.dataset.padL = PAD.l;
  overlay.dataset.cW = cW;
  svg.appendChild(overlay);
}

// ── Crosshair on hover ────────────────────────────────────────────────────────
document.documentElement.style.setProperty('--ov-tip-opacity', '0.75');
function _attachCrosshair(svg, strat, mkt, isOut, markerLayer, lineColor, paneLabel) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = t => document.createElementNS(ns, t);
  const tipOpacity = getComputedStyle(document.documentElement).getPropertyValue('--ov-tip-opacity').trim() || '0.92';
  const W = 280, SPARK_H = 78, BAR_H = 0;  // MUST match _sparkFull exactly
  const PAD = { t: 4, r: 4, b: 0, l: 4 };
  const cW = W - PAD.l - PAD.r;
  const pts = strat.points || [];
  const n = pts.length;
  if (!n) return;

  // Per-svg crosshair vertical line plus fixed-pixel HTML dot.
  const xLine = mk('line');
  xLine.setAttribute('y1', '0');
  xLine.setAttribute('y2', (SPARK_H + BAR_H).toString());
  xLine.setAttribute('stroke', 'rgba(255,255,255,0.28)');
  xLine.setAttribute('stroke-width', '0.8');
  xLine.setAttribute('stroke-dasharray', '2 2');
  xLine.setAttribute('pointer-events', 'none');
  xLine.style.display = 'none';
  svg.appendChild(xLine);

  const dot = _addFixedMarker(markerLayer, 0, 0, W, SPARK_H + 10, lineColor, 'ov-fixed-marker--hover');
  dot.style.display = 'none';

  const overlay = svg.querySelector('.ov-spark-overlay');
  if (!overlay) return;

  const mode = STATE.get('viewMode') || 'delta';
  const vals = pts.map(p => _pointValue(p, mode));
  const valid = vals.filter(v => v != null);
  if (!valid.length) return;

  let minV = Math.min(...valid), maxV = Math.max(...valid);
  const rng = maxV - minV || 0.1;
  minV -= rng * 0.12; maxV += rng * 0.12;

  const xpI = i => PAD.l + (i / Math.max(n - 1, 1)) * cW;
  const ypV = v => PAD.t + (1 - (v - minV) / (maxV - minV)) * (SPARK_H - PAD.t);

  const getIdx = (mouseX, svgRect) => {
    const svgX = (mouseX - svgRect.left) * (W / svgRect.width);
    const raw = (svgX - PAD.l) / cW * (n - 1);
    return Math.max(0, Math.min(n - 1, Math.round(raw)));
  };

  const api = {
    svg,
    paneLabel,
    isOut,
    pts,
    vals,
    mode,
    xLine,
    dot,
    xpI,
    ypV,
    color: lineColor,
  };
  svg._ovCrosshair = api;

  const showAt = (api, idx) => {
    idx = Math.max(0, Math.min(api.pts.length - 1, idx));
    const p = api.pts[idx];
    if (!p) return null;
    const val = api.vals[idx];
    const cx = api.xpI(idx);
    const cy = val != null ? api.ypV(val) : SPARK_H / 2;

    api.xLine.setAttribute('x1', cx.toFixed(1));
    api.xLine.setAttribute('x2', cx.toFixed(1));
    api.xLine.style.display = '';

    _setFixedMarkerPosition(api.dot, cx, cy, W, SPARK_H + 10);
    api.dot.style.display = val != null ? '' : 'none';
    return { p, val };
  };

  const hideApi = api => {
    api.xLine.style.display = 'none';
    api.dot.style.display = 'none';
  };

  overlay.addEventListener('mouseenter', () => {
    _TIP_SVG = svg;
  });

  overlay.addEventListener('mousemove', e => {
    _TIP_SVG = svg;

    const rect = svg.getBoundingClientRect();
    const idx = getIdx(e.clientX, rect);
    const p = pts[idx];
    if (!p) return;

    const card = svg.closest('.ov-card');
    const apis = [...(card?.querySelectorAll('.ov-spark') ?? [])]
      .map(s => s._ovCrosshair)
      .filter(Boolean);
    const targetLabel = p.label;
    const rows = [];

    apis.forEach(peer => {
      const peerIdx = peer.pts.findIndex(pt => pt.label === targetLabel);
      const hit = showAt(peer, peerIdx >= 0 ? peerIdx : idx);
      if (!hit) return;
      const mult = peer.isOut ? 100 : 1;
      const delta = _deltaValue(hit.p);
      const displayVal = peer.mode === 'delta' ? delta * mult : hit.val;
      const cls = displayVal > 0 ? 'pos' : displayVal < 0 ? 'neg' : 'neu';
      rows.push({
        label: peer.paneLabel,
        value: peer.mode === 'delta' ? _fd(displayVal) : (displayVal != null ? displayVal.toFixed(2) : '—'),
        cls,
      });
    });

    const tip = _getTooltip();
    tip.innerHTML = `
      <div class="ov-xhair-contract">${p.label ?? '—'}</div>
      ${rows.map(r => `
        <div class="ov-xhair-row">
          <span class="ov-xhair-k">${r.label}</span>
          <span class="ov-xhair-v ${r.cls}">${r.value}</span>
        </div>
      `).join('')}
    `;

    // Position: prefer right of cursor, flip left if near edge
    const tw = 124;
    const th = 86;
    const tx = e.clientX + 14;
    const ty = e.clientY - 10;
    tip.style.left = (tx + tw > window.innerWidth  ? e.clientX - tw - 14 : tx) + 'px';
    tip.style.top  = (ty + th > window.innerHeight ? e.clientY - th - 10 : ty) + 'px';
    tip.style.display = 'block';
  });

  const hide = () => {
    const card = svg.closest('.ov-card');
    [...(card?.querySelectorAll('.ov-spark') ?? [])]
      .map(s => s._ovCrosshair)
      .filter(Boolean)
      .forEach(hideApi);
    // Only clear the global tip if WE own it
    if (_TIP_SVG === svg) {
      _TIP_SVG = null;
      if (_TIP) _TIP.style.display = 'none';
    }
  };

  overlay.addEventListener('mouseleave', hide);
}

// ── Rates deep-dive ───────────────────────────────────────────────────────────

function _addFixedMarker(layer, x, y, w, h, color, extraClass = '') {
  const marker = document.createElement('span');
  marker.className = `ov-fixed-marker ${extraClass}`.trim();
  marker.style.setProperty('--marker-color', color);
  layer?.appendChild(marker);
  _setFixedMarkerPosition(marker, x, y, w, h);
  return marker;
}

function _setFixedMarkerPosition(marker, x, y, w, h) {
  if (!marker) return;
  marker.style.left = `${(x / w) * 100}%`;
  marker.style.top = `${(y / h) * 100}%`;
}

function _buildRatesDeepDive(group, marketsData) {
  const wrap = _div('ov-dd');
  wrap.innerHTML = `<div class="ov-dd-header">◈ RATES DEEP-DIVE ANALYTICS</div>`;

  const panels = _div('ov-dd-panels');

  // Collect per-market stats
  const stats = [];
  group.markets.forEach(mkt => {
    const md = marketsData[mkt];
    if (!md) return;
    const chip = _chip(md, 'Default');
    if (!chip) return;

    const out  = _findStrat(chip, 'Out',  mkt);
    const s12  = _findStrat(chip, 'S12',  mkt);
    const l6   = _findStrat(chip, 'L6',   mkt);

    const outFront  = out?.points?.[0];
    const s12Front  = s12?.points?.[0];
    const l6Front   = l6?.points?.[0];

    // Curve shape: bull/bear via outright delta, flat/steep via s12 curve slope
    let shape = '—';
    if (s12?.points?.length >= 2 && outFront?.delta != null) {
      const d0 = s12.points[0]?.delta ?? 0;
      const d1 = s12.points[Math.min(2, s12.points.length - 1)]?.delta ?? 0;
      const isBull = outFront.delta > 0;
      const isSteep = d0 > d1;   // front spread widening more = steepening
      shape = (isBull ? 'BULL' : 'BEAR') + (isSteep ? ' STEEP' : ' FLAT');
    }

    stats.push({
      mkt,
      outDelta:  outFront?.delta  ?? null,
      s12Delta:  s12Front?.delta  ?? null,
      l6Delta:   l6Front?.delta   ?? null,
      s12Pts:    s12?.points      ?? [],
      l6Pts:     l6?.points       ?? [],
      shape,
    });
  });

  if (!stats.length) return null;

  // Panel 1: OUT ranking
  panels.appendChild(_rankPanel('OUT Δ RANKING', stats, 'outDelta', group.color));
  // Panel 2: S12 ranking
  panels.appendChild(_rankPanel('S12 Δ RANKING', stats, 's12Delta', '#a78bfa'));
  // Panel 3: L6 ranking
  panels.appendChild(_rankPanel('L6 Δ RANKING',  stats, 'l6Delta',  '#34d399'));

  // Panel 4: Curve shape
  const shapePanel = _div('ov-dp');
  shapePanel.innerHTML = `<div class="ov-dp-title">CURVE SHAPE</div>`;
  const shapeBody = _div('ov-dp-body');
  const shapeColors = {
    'BULL STEEP': '#4ab868', 'BULL FLAT': '#f0a828',
    'BEAR STEEP': '#f87171', 'BEAR FLAT': '#c44848',
  };
  stats.filter(s => s.shape !== '—').forEach(s => {
    const row = _div('ov-dp-row');
    const col = shapeColors[s.shape] ?? '#94a3b8';
    row.innerHTML = `
      <span class="ov-dp-mkt">${s.mkt}</span>
      <span class="ov-dp-shape" style="color:${col}">${s.shape}</span>
    `;
    shapeBody.appendChild(row);
  });
  shapePanel.appendChild(shapeBody);
  panels.appendChild(shapePanel);

  // Panel 5: Hawkish / Dovish
  const validOut = stats.filter(s => s.outDelta != null).sort((a, b) => a.outDelta - b.outDelta);
  if (validOut.length >= 2) {
    const hawk = validOut[0];
    const dove = validOut[validOut.length - 1];
    const hdPanel = _div('ov-dp ov-dp--wide');
    hdPanel.innerHTML = `
      <div class="ov-dp-title">HAWKISH / DOVISH</div>
      <div class="ov-hd">
        <div class="ov-hd-side ov-hd-hawk">
          <div class="ov-hd-arrow">▼</div>
          <div class="ov-hd-ttl">MOST HAWKISH</div>
          <div class="ov-hd-mkt">${hawk.mkt}</div>
          <div class="ov-hd-val neg">${_fd(hawk.outDelta)}</div>
        </div>
        <div class="ov-hd-rule"></div>
        <div class="ov-hd-side ov-hd-dove">
          <div class="ov-hd-arrow">▲</div>
          <div class="ov-hd-ttl">MOST DOVISH</div>
          <div class="ov-hd-mkt">${dove.mkt}</div>
          <div class="ov-hd-val pos">${_fd(dove.outDelta)}</div>
        </div>
      </div>
    `;
    panels.appendChild(hdPanel);
  }

  // Panel 6: Similarity (L6 curve correlation)
  const simPanel = _buildSimilarityPanel(stats, 'l6Pts');
  if (simPanel) panels.appendChild(simPanel);

  wrap.appendChild(panels);
  return wrap;
}

function _rankPanel(title, stats, key, color) {
  const panel = _div('ov-dp');
  panel.innerHTML = `<div class="ov-dp-title">${title}</div>`;
  const body = _div('ov-dp-body');

  const sorted = [...stats].filter(s => s[key] != null).sort((a, b) => b[key] - a[key]);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s[key])), 0.001);

  sorted.forEach(s => {
    const v = s[key];
    const pct = Math.min(100, (Math.abs(v) / maxAbs) * 100);
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
    const barColor = v > 0 ? 'var(--col-pos)' : 'var(--col-neg)';
    const row = _div('ov-dp-row');
    row.innerHTML = `
      <span class="ov-dp-mkt">${s.mkt}</span>
      <div class="ov-dp-barwrap">
        <div class="ov-dp-bar" style="width:${pct.toFixed(1)}%;background:${barColor};opacity:0.45"></div>
      </div>
      <span class="ov-dp-val ${cls}">${_fd(v)}</span>
    `;
    body.appendChild(row);
  });

  panel.appendChild(body);
  return panel;
}

function _buildSimilarityPanel(stats, ptsKey) {
  const curves = {};
  stats.forEach(s => {
    if (s[ptsKey]?.length) curves[s.mkt] = s[ptsKey].map(p => p.delta ?? 0);
  });

  const mkts = Object.keys(curves);
  if (mkts.length < 2) return null;

  let mostSim = null, mostDiff = null, simScore = -Infinity, diffScore = Infinity;

  for (let i = 0; i < mkts.length; i++) {
    for (let j = i + 1; j < mkts.length; j++) {
      const a = curves[mkts[i]], b = curves[mkts[j]];
      const len = Math.min(a.length, b.length);
      if (len < 2) continue;
      const r = _pearson(a.slice(0, len), b.slice(0, len));
      if (r > simScore)  { simScore = r;  mostSim  = [mkts[i], mkts[j], r]; }
      if (r < diffScore) { diffScore = r; mostDiff = [mkts[i], mkts[j], r]; }
    }
  }

  const panel = _div('ov-dp ov-dp--wide');
  panel.innerHTML = `
    <div class="ov-dp-title">L6 CURVE SIMILARITY</div>
    ${mostSim  ? `<div class="ov-sim-row"><span class="ov-sim-lbl">MOST SIMILAR</span><span class="ov-sim-pair pos">${mostSim[0]} ↔ ${mostSim[1]}</span><span class="ov-sim-rho">ρ ${mostSim[2].toFixed(2)}</span></div>` : ''}
    ${mostDiff ? `<div class="ov-sim-row"><span class="ov-sim-lbl">MOST DIVERGENT</span><span class="ov-sim-pair neg">${mostDiff[0]} ↔ ${mostDiff[1]}</span><span class="ov-sim-rho">ρ ${mostDiff[2].toFixed(2)}</span></div>` : ''}
  `;
  return panel;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function _div(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

function _chip(mktData, name) {
  return mktData?.chips?.find(c => c.chip === name);
}

function _findStrat(chip, target, mkt) {
  return chip?.strategies?.find(s => _matchStrat(s.name, target, mkt));
}

function _matchStrat(name, target, mkt) {
  if (_INTER_MARKETS.has(mkt) && name === `${target} vs ${target}`) return true;

  if (_1M.has(mkt)) {
    const remapped = target.replace(/([SLDW])(\d+)/g, (_, p, n) =>
      p + Math.max(1, Math.round(parseInt(n) / 3))
    );
    if (name === remapped) return true;
  }
  return name === target;
}

function _sname(name, mkt) {
  if (_INTER_MARKETS.has(mkt)) return `${name} vs ${name}`;

  if (!_1M.has(mkt)) return name;
  return name.replace(/([SLDW])(\d+)/g, (_, p, n) =>
    p + Math.max(1, Math.round(parseInt(n) / 3))
  );
}

function _fd(v) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

function _fd1(v) {
  if (v == null || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}

function _pointValue(point, mode) {
  return mode === 'delta' ? _deltaValue(point) : (point?.live ?? null);
}

function _deltaValue(point) {
  if (!point) return null;
  if (point.delta != null) return point.delta;
  return point.live != null ? 0 : null;
}

function _pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ea = a[i] - ma, eb = b[i] - mb;
    num += ea * eb; da += ea * ea; db += eb * eb;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-10 ? 0 : num / den;
}
