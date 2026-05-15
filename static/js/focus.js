/**
 * static/js/focus.js — Expanded Strategy Modal  [VISUAL v4]
 * ===========================================================
 * Data: X-axis = futures contract roll positions (peers). NOT a time series.
 * All points are equal — no "latest" / "opening" concept.
 *
 * v4 fixes:
 *  1. All X labels always shown (continuous, no skipping)
 *  2. Higher contrast throughout — borders, dots, lines, labels
 *  3. Column bands span exactly contract-to-contract (label-aligned)
 *  4. Zero line: thick solid accent rule with label — always prominent
 *  5. Lollipop stems are now neutral (var(--border-bright)) — no red/green colouring
 *  6. Tooltip hide delayed 300 ms — survives brief mouse gaps
 *  7. Tooltip is larger, better spaced, more readable
 *  8. Tooltip: removed HI / LO rows and sparkbar section
 *  9. Tooltip values rounded to 2 decimal places
 */

import STATE from './state.js';
import { modePoints, toY, toX, ptsToPath, getActiveStrategies } from './utils.js';
import { fmtPrice, fmtDelta, deltaClass } from './utils.js';

const overlay  = document.getElementById('focusOverlay');
const titleEl  = document.getElementById('focusTitle');
const svgEl    = document.getElementById('focusSvg');
const closeBtn = document.getElementById('focusClose');

let _tooltip        = null;
let _tooltipTimer   = null;   // fix 6: delayed hide
let _hoverResetTimer = null;
let _currentPoints  = [];
let _chartMeta      = null;
let _eventsAttached = false;

closeBtn?.addEventListener('click', closeFocus);
overlay?.addEventListener('click', e => { if (e.target === overlay) closeFocus(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !overlay?.classList.contains('hidden')) closeFocus();
});

STATE.on('viewMode',    () => { if (!overlay?.classList.contains('hidden')) _render(); });
STATE.on('curveLens',   () => { if (!overlay?.classList.contains('hidden')) _render(); });
STATE.on('curveSkip',   () => { if (!overlay?.classList.contains('hidden')) _render(); });
STATE.on('marketsData', () => {
  if (overlay?.classList.contains('hidden')) return;
  if (svgEl?.matches(':hover')) return;
  _render();
});


export function openFocus(strategyName) {
  if (!overlay) return;
  overlay.dataset.openStrategy = strategyName;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => requestAnimationFrame(() => _render()));
}

export function closeFocus() {
  overlay?.classList.add('hidden');
  if (overlay) overlay.dataset.openStrategy = '';
  document.body.style.overflow = '';
  _cancelTooltipTimer();
  _hideTooltipNow();
  _chartMeta = null;
}


// ── Main render orchestrator ───────────────────────────────────────────────────

function _render() {
  const name = overlay?.dataset.openStrategy;
  if (!name || !svgEl) return;

  const market      = STATE.get('activeMarket');
  const allChips    = STATE.get('activeChip') || {};
  const chipName    = allChips[market] || 'Default';
  const marketsData = STATE.get('marketsData');
  const mode        = STATE.get('viewMode') || 'delta';

  if (!marketsData || !market) return;

  const strategies = getActiveStrategies(market, chipName, marketsData);
  const strategy   = strategies.find(s => s.name === name);

  if (!strategy) {
    if (titleEl) titleEl.textContent = `${market}  ·  ${name}  —  not found`;
    svgEl.innerHTML = '';
    _noData();
    return;
  }

  if (titleEl) {
    const dispName = _displayName(name, market);
    const wgts     = (strategy.weights || []).join(', ');
    titleEl.textContent = `${market}  ·  ${dispName}  ·  [${wgts}]`;
  }

  _renderChart(strategy, mode);
}


// ── Chart renderer ─────────────────────────────────────────────────────────────

function _renderChart(strategy, mode) {
  if (!svgEl) return;
  svgEl.innerHTML = '';
  _cancelTooltipTimer();
  _hideTooltipNow();
  _chartMeta = null;

  const points = strategy.points || [];
  if (!points.length) { _noData(); return; }

  const pts = modePoints(points, mode);
  const n   = pts.length;

  const W = svgEl.clientWidth  || 1200;
  const H = svgEl.clientHeight || 560;
  if (W < 10 || H < 10) { setTimeout(() => _render(), 50); return; }

  // Extra bottom padding to accommodate all x-labels without skipping
  const PAD = { top: 28, right: 36, bottom: 46, left: 56 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;
  const ns  = 'http://www.w3.org/2000/svg';
  const mk  = tag => document.createElementNS(ns, tag);

  // ── Y domain ──────────────────────────────────────────────────────────────
  const allV = pts.flatMap(p => [p.live, p.settle, p.high, p.low]).filter(v => v != null);
  if (!allV.length) { _noData(); return; }

  let minV = Math.min(...allV);
  let maxV = Math.max(...allV);
  const rng = maxV - minV || 0.001;
  minV -= rng * 0.22;
  maxV += rng * 0.22;

  const yPx     = v => PAD.top  + toY(v, minV, maxV, cH, 0);
  const xPx     = i => PAD.left + toX(i, n, cW);
  const hasZero = (minV <= 0 && maxV >= 0);
  const zeroY   = hasZero ? yPx(0) : PAD.top + cH;

  _chartMeta     = { PAD, W, H, n, xPx, yPx, pts, mode, cW };
  _currentPoints = points;

  const ticks = _niceTicks(minV, maxV, 8);

  // ── Defs ──────────────────────────────────────────────────────────────────
  const defs = mk('defs');

  const gradPosId = 'fv4_grad_pos';
  const gradPos   = mk('linearGradient');
  gradPos.setAttribute('id', gradPosId);
  gradPos.setAttribute('x1', '0'); gradPos.setAttribute('y1', '0');
  gradPos.setAttribute('x2', '0'); gradPos.setAttribute('y2', '1');
  // // _addStop(mk, gradPos, '0%',   'var(--col-pos)', '0.22');
  // // _addStop(mk, gradPos, '100%', 'var(--col-pos)', '0.00');
  defs.appendChild(gradPos);

  const gradNegId = 'fv4_grad_neg';
  const gradNeg   = mk('linearGradient');
  gradNeg.setAttribute('id', gradNegId);
  gradNeg.setAttribute('x1', '0'); gradNeg.setAttribute('y1', '0');
  gradNeg.setAttribute('x2', '0'); gradNeg.setAttribute('y2', '1');
  // // _addStop(mk, gradNeg, '0%',   'var(--col-neg)', '0.00');
  // // _addStop(mk, gradNeg, '100%', 'var(--col-neg)', '0.20');
  defs.appendChild(gradNeg);

  const gradAllId = 'fv4_grad_all';
  const gradAll   = mk('linearGradient');
  gradAll.setAttribute('id', gradAllId);
  gradAll.setAttribute('x1', '0'); gradAll.setAttribute('y1', '0');
  gradAll.setAttribute('x2', '0'); gradAll.setAttribute('y2', '1');
  _addStop(mk, gradAll, '0%',   'var(--col-live)', '0.18');
  _addStop(mk, gradAll, '100%', 'var(--col-live)', '0.01');
  defs.appendChild(gradAll);

  // Glow filter — live line bloom
  const glowId = 'fv4_glow';
  const glowFilter = mk('filter');
  glowFilter.setAttribute('id', glowId);
  glowFilter.setAttribute('x', '-20%'); glowFilter.setAttribute('y', '-20%');
  glowFilter.setAttribute('width', '140%'); glowFilter.setAttribute('height', '140%');
  const feG = mk('feGaussianBlur');
  feG.setAttribute('in', 'SourceGraphic'); feG.setAttribute('stdDeviation', '2.5');
  glowFilter.appendChild(feG);
  defs.appendChild(glowFilter);

  // Glow filter — extrema dots
  const dotGlowId = 'fv4_dot_glow';
  const dotFilter = mk('filter');
  dotFilter.setAttribute('id', dotGlowId);
  dotFilter.setAttribute('x', '-60%'); dotFilter.setAttribute('y', '-60%');
  dotFilter.setAttribute('width', '220%'); dotFilter.setAttribute('height', '220%');
  const dfg = mk('feGaussianBlur');
  dfg.setAttribute('in', 'SourceGraphic'); dfg.setAttribute('stdDeviation', '3.5');
  dotFilter.appendChild(dfg);
  defs.appendChild(dotFilter);

  // Glow filter — zero line
  const zeroGlowId = 'fv4_zero_glow';
  const zeroGlowFilter = mk('filter');
  zeroGlowFilter.setAttribute('id', zeroGlowId);
  zeroGlowFilter.setAttribute('x', '-5%'); zeroGlowFilter.setAttribute('y', '-400%');
  zeroGlowFilter.setAttribute('width', '110%'); zeroGlowFilter.setAttribute('height', '900%');
  const zfg = mk('feGaussianBlur');
  zfg.setAttribute('in', 'SourceGraphic'); zfg.setAttribute('stdDeviation', '2.5');
  zeroGlowFilter.appendChild(zfg);
  defs.appendChild(zeroGlowFilter);

  svgEl.appendChild(defs);

  // ── LAYER 0: Column bands — fix 3: aligned to contract label positions ─────
  // halfGap = half the spacing between adjacent x positions
  const halfGap = n > 1 ? (xPx(1) - xPx(0)) / 2 : cW / 2;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) continue;
    const bx    = xPx(i) - halfGap;
    const bxEnd = xPx(i) + halfGap;
    const band  = mk('rect');
    band.setAttribute('x',      bx.toFixed(1));
    band.setAttribute('y',      PAD.top.toString());
    band.setAttribute('width',  (bxEnd - bx).toFixed(1));
    band.setAttribute('height', cH.toString());
    band.setAttribute('fill',   'rgba(255,255,255,0.025)');
    band.setAttribute('pointer-events', 'none');
    svgEl.appendChild(band);
  }

  // ── LAYER 1: Horizontal grid lines ────────────────────────────────────────
  ticks.forEach(t => {
    if (Math.abs(t) < 0.0001) return; // zero rendered separately
    const y  = yPx(t);
    const gl = mk('line');
    gl.setAttribute('x1', PAD.left.toString());
    gl.setAttribute('x2', (PAD.left + cW).toString());
    gl.setAttribute('y1', y.toFixed(1));
    gl.setAttribute('y2', y.toFixed(1));
    gl.setAttribute('stroke', 'var(--border-bright)');
    gl.setAttribute('stroke-width', '1');
    gl.setAttribute('opacity', '0.35');
    svgEl.appendChild(gl);
  });

  // Vertical column guides
  for (let i = 0; i < n; i++) {
    const x  = xPx(i);
    const vl = mk('line');
    vl.setAttribute('x1', x.toFixed(1)); vl.setAttribute('x2', x.toFixed(1));
    vl.setAttribute('y1', PAD.top.toString());
    vl.setAttribute('y2', (PAD.top + cH).toString());
    vl.setAttribute('stroke', 'var(--border-dim)');
    vl.setAttribute('stroke-width', '0.5');
    vl.setAttribute('opacity', '0.4');
    svgEl.appendChild(vl);
  }

  // Chart border — fix 2: brighter
  const border = mk('rect');
  border.setAttribute('x', PAD.left.toString()); border.setAttribute('y', PAD.top.toString());
  border.setAttribute('width', cW.toString());   border.setAttribute('height', cH.toString());
  border.setAttribute('fill', 'none');
  border.setAttribute('stroke', 'var(--border-bright)');
  border.setAttribute('stroke-width', '1');
  svgEl.appendChild(border);

  // ── fix 4: ZERO LINE — prominent, glowing, labelled ───────────────────────
  if (hasZero) {
    // Solid rule
    const zl = mk('line');
    zl.setAttribute('x1', PAD.left.toString());
    zl.setAttribute('x2', (PAD.left + cW).toString());
    zl.setAttribute('y1', zeroY.toFixed(1));
    zl.setAttribute('y2', zeroY.toFixed(1));
    zl.setAttribute('stroke', 'var(--col-zero)');
    zl.setAttribute('stroke-width', '2');
    zl.setAttribute('opacity', '1');
    svgEl.appendChild(zl);

    // "0" label on the left axis (replaces dim tick label)
    const zLabel = mk('text');
    zLabel.setAttribute('x', (PAD.left - 12).toFixed(1));
    zLabel.setAttribute('y', zeroY.toFixed(1));
    zLabel.setAttribute('text-anchor', 'end');
    zLabel.setAttribute('dominant-baseline', 'middle');
    zLabel.setAttribute('font-family', 'var(--font-data)');
    zLabel.setAttribute('font-size', '15');
    zLabel.setAttribute('font-weight', '800');
    zLabel.setAttribute('fill', 'var(--col-zero)');
    zLabel.setAttribute('opacity', '1');
    zLabel.textContent = '0';
    svgEl.appendChild(zLabel);
  }

  // ── LAYER 2: Y-axis labels ────────────────────────────────────────────────
  ticks.forEach(t => {
    const y      = yPx(t);
    const isNeg  = t < -0.0001;
    const isZero = Math.abs(t) < 0.0001;
    // Zero tick/label handled by the zero-line block above — skip here to avoid duplicate
    if (isZero && hasZero) return;
    const col    = isNeg ? 'var(--col-neg)' : 'var(--text-primary)';

    const tick = mk('line');
    tick.setAttribute('x1', (PAD.left - 6).toString());
    tick.setAttribute('x2', PAD.left.toString());
    tick.setAttribute('y1', y.toFixed(1)); tick.setAttribute('y2', y.toFixed(1));
    tick.setAttribute('stroke', col);
    tick.setAttribute('stroke-width', '1.2');
    tick.setAttribute('opacity', '0.90');
    svgEl.appendChild(tick);

    const lb = mk('text');
    lb.setAttribute('x', (PAD.left - 12).toString());
    lb.setAttribute('y', y.toFixed(1));
    lb.setAttribute('text-anchor', 'end');
    lb.setAttribute('dominant-baseline', 'middle');
    lb.setAttribute('font-family', 'var(--font-data)');
    lb.setAttribute('font-size', '12');
    lb.setAttribute('font-weight', '600');
    lb.setAttribute('fill', col);
    lb.setAttribute('opacity', '1');
    lb.textContent = _fmtTick(t);
    svgEl.appendChild(lb);
  });

  // ── LAYER 3: Hi/Lo range pillars ──────────────────────────────────────────
  const pillW = Math.max(4, Math.min(14, halfGap * 0.45));
  pts.forEach((p, i) => {
    if (p.high == null || p.low == null) return;
    const x   = xPx(i);
    const yHi = yPx(p.high);
    const yLo = yPx(p.low);
    const ph  = Math.max(1, Math.abs(yLo - yHi));

    const pill = mk('rect');
    pill.setAttribute('x',      (x - pillW / 2).toFixed(1));
    pill.setAttribute('y',      yHi.toFixed(1));
    pill.setAttribute('width',  pillW.toFixed(1));
    pill.setAttribute('height', ph.toFixed(1));
    pill.setAttribute('rx',     (pillW / 2).toFixed(1));
    pill.setAttribute('ry',     (pillW / 2).toFixed(1));
    pill.setAttribute('fill',   'var(--col-range)');
    pill.setAttribute('opacity', '0.60');
    pill.classList.add('focus-range-pill');
    pill.dataset.idx = i;
    svgEl.appendChild(pill);

    const hlLine = mk('line');
    hlLine.setAttribute('x1', x.toFixed(1)); hlLine.setAttribute('x2', x.toFixed(1));
    hlLine.setAttribute('y1', yHi.toFixed(1)); hlLine.setAttribute('y2', yLo.toFixed(1));
    hlLine.setAttribute('stroke', 'var(--col-range-line)');
    hlLine.setAttribute('stroke-width', '0.8');
    hlLine.setAttribute('opacity', '0.6');
    svgEl.appendChild(hlLine);
  });

  // ── LAYER 4: Lollipop stems — fix 5: neutral colour ───────────────────────
  const liveSeries = pts.map(p => p.live).filter(v => v != null);
  const maxAbs     = Math.max(...liveSeries.map(Math.abs)) || 1;

  pts.forEach((p, i) => {
    if (p.live == null) return;
    const x     = xPx(i);
    const y     = yPx(p.live);
    const stemW = 1.2 + (Math.abs(p.live) / maxAbs) * 2.8;

    const stem = mk('line');
    stem.setAttribute('x1', x.toFixed(1)); stem.setAttribute('x2', x.toFixed(1));
    stem.setAttribute('y1', zeroY.toFixed(1)); stem.setAttribute('y2', y.toFixed(1));
    stem.setAttribute('stroke', 'var(--border-bright)');  // fix 5: neutral, no red/green
    stem.setAttribute('stroke-width', stemW.toFixed(2));
    stem.setAttribute('stroke-linecap', 'round');
    stem.setAttribute('opacity', '0.32');
    stem.classList.add('focus-stem');
    stem.dataset.idx = i;
    svgEl.appendChild(stem);
  });

  // ── LAYER 5: Area fills ────────────────────────────────────────────────────
  const livePts   = pts.map((p, i) => [xPx(i), p.live != null ? yPx(p.live) : null]);
  const liveD     = ptsToPath(livePts);
  const validLive = livePts.filter(([, y]) => y != null);

  if (validLive.length > 1 && liveD) {
    const first = validLive[0];
    const last  = validLive[validLive.length - 1];

    if (hasZero) {
      const posAreaD = `${liveD} L${last[0].toFixed(1)},${zeroY.toFixed(1)} L${first[0].toFixed(1)},${zeroY.toFixed(1)} Z`;
      const posArea  = mk('path');
      posArea.setAttribute('d', posAreaD);
      posArea.setAttribute('fill', `url(#${gradPosId})`);
      posArea.setAttribute('clip-path', `inset(0 0 ${(H - zeroY).toFixed(1)}px 0)`);
      svgEl.appendChild(posArea);

      const negAreaD = `${liveD} L${last[0].toFixed(1)},${zeroY.toFixed(1)} L${first[0].toFixed(1)},${zeroY.toFixed(1)} Z`;
      const negArea  = mk('path');
      negArea.setAttribute('d', negAreaD);
      negArea.setAttribute('fill', `url(#${gradNegId})`);
      negArea.setAttribute('clip-path', `inset(${zeroY.toFixed(1)}px 0 0 0)`);
      svgEl.appendChild(negArea);
    } else {
      const areaD = `${liveD} L${last[0].toFixed(1)},${(PAD.top + cH).toFixed(1)} L${first[0].toFixed(1)},${(PAD.top + cH).toFixed(1)} Z`;
      const area  = mk('path');
      area.setAttribute('d', areaD);
      area.setAttribute('fill', `url(#${gradAllId})`);
      svgEl.appendChild(area);
    }
  }

  // ── LAYER 6: Settle line ───────────────────────────────────────────────────
  const settlePts = pts.map((p, i) => [xPx(i), p.settle != null ? yPx(p.settle) : null]);
  const settleD   = ptsToPath(settlePts);
  if (settleD) {
    const sp = mk('path');
    sp.setAttribute('d', settleD);
    sp.setAttribute('fill', 'none');
    sp.setAttribute('stroke', 'var(--col-settle)');
    sp.setAttribute('stroke-width', '1.4');
    sp.setAttribute('stroke-dasharray', '6 3');
    sp.setAttribute('stroke-linejoin', 'round');
    sp.setAttribute('opacity', '0.85');
    svgEl.appendChild(sp);

    pts.forEach((p, i) => {
      if (p.settle == null) return;
      const sa = mk('circle');
      sa.setAttribute('cx', xPx(i).toFixed(1)); sa.setAttribute('cy', yPx(p.settle).toFixed(1));
      sa.setAttribute('r', '2');
      sa.setAttribute('fill', 'var(--col-settle)');
      sa.setAttribute('opacity', '0.95');
      svgEl.appendChild(sa);
    });
  }

  // ── LAYER 7: Live line — bloom + crisp ────────────────────────────────────
  if (liveD) {
    const bloom = mk('path');
    bloom.setAttribute('d', liveD);
    bloom.setAttribute('fill', 'none');
    bloom.setAttribute('stroke', 'var(--col-live)');
    bloom.setAttribute('stroke-width', '6');
    bloom.setAttribute('stroke-linejoin', 'round');
    bloom.setAttribute('stroke-linecap', 'round');
    bloom.setAttribute('opacity', '0.22');
    bloom.setAttribute('filter', `url(#${glowId})`);
    svgEl.appendChild(bloom);

    const lp = mk('path');
    lp.setAttribute('d', liveD);
    lp.setAttribute('fill', 'none');
    lp.setAttribute('stroke', 'var(--col-live)');
    lp.setAttribute('stroke-width', '2.2');
    lp.setAttribute('stroke-linejoin', 'round');
    lp.setAttribute('stroke-linecap', 'round');
    svgEl.appendChild(lp);
  }

  // ── LAYER 8: Dots + value labels + X labels ───────────────────────────────
  const hiVal = Math.max(...liveSeries);
  const loVal = Math.min(...liveSeries);

  pts.forEach((p, i) => {
    const rawPt  = points[i];
    const x      = xPx(i);

    // fix 1: ALL x-labels always shown — no skipping
    const xLb = mk('text');
    xLb.setAttribute('x', x.toFixed(1));
    xLb.setAttribute('y', (PAD.top + cH + 30).toFixed(1));
    xLb.setAttribute('text-anchor', 'middle');
    xLb.setAttribute('font-family', 'var(--font-data)');
    xLb.setAttribute('font-size', '12');
    xLb.setAttribute('font-weight', '500');
    xLb.setAttribute('fill', 'var(--text-primary)');  // fix 2: was text-secondary
    xLb.textContent = rawPt?.label ?? `#${i}`;
    svgEl.appendChild(xLb);

    const xt = mk('line');
    xt.setAttribute('x1', x.toFixed(1)); xt.setAttribute('x2', x.toFixed(1));
    xt.setAttribute('y1', (PAD.top + cH).toString());
    xt.setAttribute('y2', (PAD.top + cH + 6).toString());
    xt.setAttribute('stroke', 'var(--border-bright)');
    xt.setAttribute('stroke-width', '1.2');
    svgEl.appendChild(xt);

    if (p.live == null) return;

    const y      = yPx(p.live);
    const val    = mode === 'delta' ? rawPt?.delta : rawPt?.live;
    const isNeg  = (val ?? 0) < 0;
    const isHiPt = Math.abs(p.live - hiVal) < 0.0001;
    const isLoPt = Math.abs(p.live - loVal) < 0.0001 && n > 1;
    const isExtr = isHiPt || isLoPt;

    const dotClr  = isNeg ? 'var(--col-neg)' : 'var(--col-pos)';
    const dotSize = 3;

    if (isExtr) {
      const halo = mk('circle');
      halo.setAttribute('cx', x.toFixed(1)); halo.setAttribute('cy', y.toFixed(1));
      halo.setAttribute('r', '10');
      halo.setAttribute('fill', dotClr);
      halo.setAttribute('opacity', '0');
      halo.setAttribute('filter', `url(#${dotGlowId})`);
      svgEl.appendChild(halo);
    }

    const dot = mk('circle');
    dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', dotSize.toString());
    dot.setAttribute('fill', isExtr ? dotClr : 'var(--bg-raised)');
    dot.setAttribute('fill-opacity', isExtr ? '0.20' : '1');
    dot.setAttribute('stroke', dotClr);
    dot.setAttribute('stroke-width', '1.5');
    dot.dataset.idx = i;
    dot.classList.add('focus-dot');
    svgEl.appendChild(dot);

    // Value label — fix 2: higher contrast
    const isUpper  = y < PAD.top + cH * 0.5;
    const labelY   = isUpper ? y - 14 : y + 16;
    const labelClr = isNeg ? 'var(--col-neg)' : isHiPt ? 'var(--col-pos)' : 'var(--text-primary)';

    const valLb = mk('text');
    valLb.setAttribute('x', x.toFixed(1));
    valLb.setAttribute('y', labelY.toFixed(1));
    valLb.setAttribute('text-anchor', 'middle');
    valLb.setAttribute('dominant-baseline', 'middle');
    valLb.setAttribute('font-family', 'var(--font-data)');
    valLb.setAttribute('font-size', isExtr ? '13' : '11');
    valLb.setAttribute('font-weight', isExtr ? '700' : '500');
    valLb.setAttribute('fill', labelClr);
    valLb.setAttribute('class', 'focus-val-label');
    valLb.textContent = mode === 'delta' ? fmtDelta(val, 2) : fmtPrice(val, 2);
    svgEl.appendChild(valLb);

    if (isExtr) {
      _drawFlagCallout(mk, svgEl, x, y, rawPt?.label ?? '', isHiPt, isUpper, PAD, cW);
    }
  });

  // ── LAYER 9: Crosshairs ────────────────────────────────────────────────────
  const crosshair = mk('line');
  crosshair.setAttribute('id', 'focusCrosshair');
  crosshair.setAttribute('x1', '0'); crosshair.setAttribute('x2', '0');
  crosshair.setAttribute('y1', PAD.top.toString());
  crosshair.setAttribute('y2', (PAD.top + cH).toString());
  crosshair.setAttribute('stroke', 'var(--accent)');
  crosshair.setAttribute('stroke-width', '1');
  crosshair.setAttribute('stroke-dasharray', '4 4');
  crosshair.setAttribute('opacity', '0');
  crosshair.setAttribute('pointer-events', 'none');
  svgEl.appendChild(crosshair);

  const crosshairH = mk('line');
  crosshairH.setAttribute('id', 'focusCrosshairH');
  crosshairH.setAttribute('x1', PAD.left.toString());
  crosshairH.setAttribute('x2', (PAD.left + cW).toString());
  crosshairH.setAttribute('y1', '0'); crosshairH.setAttribute('y2', '0');
  crosshairH.setAttribute('stroke', 'var(--accent)');
  crosshairH.setAttribute('stroke-width', '0.8');
  crosshairH.setAttribute('stroke-dasharray', '4 4');
  crosshairH.setAttribute('opacity', '0');
  crosshairH.setAttribute('pointer-events', 'none');
  svgEl.appendChild(crosshairH);

  if (!_eventsAttached) {
    svgEl.addEventListener('mousemove', _onMouseMove);
    svgEl.addEventListener('mouseleave', _onMouseLeave);
    _eventsAttached = true;
  }
}


// ── Flag callout ───────────────────────────────────────────────────────────────

function _drawFlagCallout(mk, svg, x, y, label, isHi, isUpper, PAD, cW) {
  // const arrowH   = 16;
  // const arrowDir = isHi ? -1 : 1;
  // const tipY     = y - arrowDir * arrowH;
  // const col      = isHi ? 'var(--col-pos)' : 'var(--col-neg)';
  // const tagText  = isHi ? 'HI' : 'LO';

  // const arr = mk('line');
  // arr.setAttribute('x1', x.toFixed(1)); arr.setAttribute('x2', x.toFixed(1));
  // arr.setAttribute('y1', y.toFixed(1)); arr.setAttribute('y2', tipY.toFixed(1));
  // arr.setAttribute('stroke', col); arr.setAttribute('stroke-width', '1.4');
  // arr.setAttribute('opacity', '0.75');
  // svg.appendChild(arr);

  //const aW   = 3.5, aH = 4;
  //const head = mk('polygon');
  // head.setAttribute('points',
  //   `${x.toFixed(1)},${tipY.toFixed(1)} ` +
  //   `${(x - aW).toFixed(1)},${(tipY + arrowDir * aH).toFixed(1)} ` +
  //   `${(x + aW).toFixed(1)},${(tipY + arrowDir * aH).toFixed(1)}`
  // );
  // head.setAttribute('fill', col); head.setAttribute('opacity', '0.85');
  // svg.appendChild(head);

  // const pillW  = 22, pillH = 14;
  // const pillY  = tipY - arrowDir * 12;
  // const pillX  = Math.min(Math.max(x - pillW / 2, PAD.left), PAD.left + cW - pillW);

  // const pillBg = mk('rect');
  // pillBg.setAttribute('x', pillX.toFixed(1));
  // pillBg.setAttribute('y', (pillY - pillH / 2).toFixed(1));
  // pillBg.setAttribute('width', pillW.toFixed(1)); pillBg.setAttribute('height', pillH.toFixed(1));
  // pillBg.setAttribute('rx', '3'); pillBg.setAttribute('ry', '3');
  // pillBg.setAttribute('fill', col); pillBg.setAttribute('opacity', '0.22');
  // svg.appendChild(pillBg);

  // const pillBorder = mk('rect');
  // pillBorder.setAttribute('x', pillX.toFixed(1));
  // pillBorder.setAttribute('y', (pillY - pillH / 2).toFixed(1));
  // pillBorder.setAttribute('width', pillW.toFixed(1)); pillBorder.setAttribute('height', pillH.toFixed(1));
  // pillBorder.setAttribute('rx', '3'); pillBorder.setAttribute('ry', '3');
  // pillBorder.setAttribute('fill', 'none');
  // pillBorder.setAttribute('stroke', col); pillBorder.setAttribute('stroke-width', '1');
  // pillBorder.setAttribute('opacity', '0.65');
  // svg.appendChild(pillBorder);

  // const pillLb = mk('text');
  // pillLb.setAttribute('x', (pillX + pillW / 2).toFixed(1));
  // pillLb.setAttribute('y', pillY.toFixed(1));
  // pillLb.setAttribute('text-anchor', 'middle');
  // pillLb.setAttribute('dominant-baseline', 'middle');
  // pillLb.setAttribute('font-family', 'var(--font-data)');
  // pillLb.setAttribute('font-size', '8.5');
  // pillLb.setAttribute('font-weight', '700');
  // pillLb.setAttribute('letter-spacing', '0.08em');
  // pillLb.setAttribute('fill', col);
  // pillLb.setAttribute('opacity', '0.95');
  // pillLb.textContent = tagText;
  // svg.appendChild(pillLb);
}


// ── Mouse handlers ─────────────────────────────────────────────────────────────

function _onMouseMove(e) {
  const meta = _chartMeta;
  if (!meta) return;

  // fix 6: cancel any pending hide on re-entry
  _cancelTooltipTimer();
  _cancelHoverResetTimer();

  const rect = svgEl.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const { PAD, n, xPx, yPx, pts, cW } = meta;

  if (mx < PAD.left || mx > PAD.left + cW) { _scheduleTooltipHide(); return; }

  let nearestIdx = 0, nearestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(mx - xPx(i));
    if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
  }

  const rawPt = _currentPoints[nearestIdx];
  if (!rawPt) return;

  const crosshair = svgEl.querySelector('#focusCrosshair');
  if (crosshair) {
    const cx = xPx(nearestIdx).toFixed(1);
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx);
    crosshair.setAttribute('opacity', '0.65');
  }

  const liveVal    = pts[nearestIdx]?.live;
  const crosshairH = svgEl.querySelector('#focusCrosshairH');
  if (crosshairH && liveVal != null) {
    const cy = yPx(liveVal).toFixed(1);
    crosshairH.setAttribute('y1', cy); crosshairH.setAttribute('y2', cy);
    crosshairH.setAttribute('opacity', '0.45');
  }

  svgEl.querySelectorAll('.focus-dot').forEach(d => {
    const isActive = parseInt(d.dataset.idx) === nearestIdx;
    d.setAttribute('r',            '3');
    d.setAttribute('stroke-width', '1.5');
    d.setAttribute('opacity',      isActive ? '1'   : '0.40');
  });

  svgEl.querySelectorAll('.focus-stem').forEach(s => {
    const isActive = parseInt(s.dataset.idx) === nearestIdx;
    s.setAttribute('opacity', isActive ? '0.75' : '0.12');
  });

  svgEl.querySelectorAll('.focus-range-pill').forEach(p => {
    const isActive = parseInt(p.dataset.idx) === nearestIdx;
    p.setAttribute('opacity', isActive ? '0.90' : '0.22');
  });

  svgEl.querySelectorAll('.focus-val-label').forEach((el, idx) => {
    el.setAttribute('opacity', idx === nearestIdx ? '1' : '0.10');
  });

  _showTooltip(e.clientX, e.clientY, rawPt);
}

function _onMouseLeave() {
  // fix 6: delay the hide by 300 ms — brief mouse-gap won't vanish it
  _scheduleTooltipHide();
  _scheduleHoverReset();
}

function _resetHoverState() {
  _hoverResetTimer = null;

  const crosshair  = svgEl?.querySelector('#focusCrosshair');
  const crosshairH = svgEl?.querySelector('#focusCrosshairH');
  if (crosshair)  crosshair.setAttribute('opacity', '0');
  if (crosshairH) crosshairH.setAttribute('opacity', '0');

  svgEl?.querySelectorAll('.focus-dot').forEach(d => {
    d.setAttribute('r', '3'); d.setAttribute('stroke-width', '1.5');
    d.setAttribute('opacity', '1');
  });
  svgEl?.querySelectorAll('.focus-stem').forEach(s     => s.setAttribute('opacity', '0.32'));
  svgEl?.querySelectorAll('.focus-range-pill').forEach(p => p.setAttribute('opacity', '0.60'));
  svgEl?.querySelectorAll('.focus-val-label').forEach(el => el.setAttribute('opacity', '0.85'));
}

function _scheduleHoverReset() {
  _cancelHoverResetTimer();
  _hoverResetTimer = setTimeout(_resetHoverState, 120);
}

function _cancelHoverResetTimer() {
  if (_hoverResetTimer != null) {
    clearTimeout(_hoverResetTimer);
    _hoverResetTimer = null;
  }
}


// ── Tooltip — fixes 7, 8, 9 ───────────────────────────────────────────────────

function _ensureTooltip() {
  if (_tooltip) return _tooltip;
  _tooltip = document.createElement('div');
  _tooltip.id = 'focusTooltip';
  Object.assign(_tooltip.style, {
    position:      'fixed',
    zIndex:        '9999',
    pointerEvents: 'none',
    background:    'var(--bg-void)',
    border:        '1px solid var(--border-bright)',
    borderRadius:  '8px',
    padding:       '12px 16px',
    fontFamily:    'var(--font-data)',
    fontSize:      '12px',
    color:         'var(--text-primary)',
    whiteSpace:    'nowrap',
    boxShadow:     '0 20px 56px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.05)',
    display:       'none',
    lineHeight:    '1.75',
    minWidth:      '148px',
  });
  document.body.appendChild(_tooltip);
  return _tooltip;
}

// fix 8: only LIVE / SETL / DELTA — no HI/LO, no sparkbar
// fix 9: all values at 2 decimal places
// fix 7: bigger font, better layout
function _showTooltip(cx, cy, rawPt) {
  const tip   = _ensureTooltip();
  const dCls  = deltaClass(rawPt.delta);
  const dClr  = dCls === 'pos' ? 'var(--col-pos)' : dCls === 'neg' ? 'var(--col-neg)' : 'var(--text-secondary)';
  const dSign = rawPt.delta != null && rawPt.delta >= 0 ? '+' : '';
  const liveV = rawPt.live ?? 0;
  const liveClr = liveV < 0 ? 'var(--col-neg)' : 'var(--col-pos)';

  const fmt2 = v => (v == null ? '—' : Number(v).toFixed(2));  // fix 9

  tip.innerHTML = `
    <div style="
      font-family: var(--font-ui);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent-bright);
      text-transform: uppercase;
      margin-bottom: 9px;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--border-dim);
    ">${rawPt.label ?? '—'}</div>
    <div style="
      display: grid;
      grid-template-columns: 44px 1fr;
      row-gap: 5px;
      column-gap: 16px;
      align-items: baseline;
    ">
      <span style="color:var(--text-dim);font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;">Live</span>
      <span style="color:${liveClr};font-weight:700;font-size:14px;">${fmt2(rawPt.live)}</span>

      <span style="color:var(--text-dim);font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;">Settle</span>
      <span style="color:var(--text-secondary);font-weight:500;font-size:13px;">${fmt2(rawPt.settle)}</span>

      <span style="color:var(--text-dim);font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;">Delta</span>
      <span style="color:${dClr};font-weight:700;font-size:14px;">${dSign}${fmt2(rawPt.delta)}</span>
    </div>
  `;

  tip.style.display = 'block';
  const TW = tip.offsetWidth || 160, TH = tip.offsetHeight || 100;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = cx + 20, top = cy - TH / 2;
  if (left + TW > vw - 8) left = cx - TW - 20;
  if (top < 8) top = 8;
  if (top + TH > vh - 8) top = vh - TH - 8;
  tip.style.left = `${left}px`;
  tip.style.top  = `${top}px`;
}

// fix 6: 300 ms grace period before hiding
function _scheduleTooltipHide() {
  _cancelTooltipTimer();
  _tooltipTimer = setTimeout(_hideTooltipNow, 300);
}

function _cancelTooltipTimer() {
  if (_tooltipTimer != null) { clearTimeout(_tooltipTimer); _tooltipTimer = null; }
}

function _hideTooltipNow() {
  if (_tooltip) _tooltip.style.display = 'none';
}

function _hideTooltip() { _cancelTooltipTimer(); _hideTooltipNow(); }


// ── Helpers ────────────────────────────────────────────────────────────────────

function _addStop(mk, grad, offset, color, opacity) {
  const s = mk('stop');
  s.setAttribute('offset', offset);
  s.setAttribute('stop-color', color);
  s.setAttribute('stop-opacity', opacity);
  grad.appendChild(s);
}

function _noData() {
  if (!svgEl) return;
  const ns  = 'http://www.w3.org/2000/svg';
  const txt = document.createElementNS(ns, 'text');
  const W   = svgEl.clientWidth || 910;
  const H   = svgEl.clientHeight || 350;
  txt.setAttribute('x', (W / 2).toString());
  txt.setAttribute('y', (H / 2).toString());
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('dominant-baseline', 'middle');
  txt.setAttribute('font-family', 'var(--font-data)');
  txt.setAttribute('font-size', '13');
  txt.setAttribute('fill', 'var(--text-dim)');
  txt.textContent = 'NO DATA';
  svgEl.appendChild(txt);
}

function _niceTicks(min, max, n) {
  const range = max - min;
  const raw   = range / Math.max(n - 1, 1);
  const mag   = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const steps = [1, 2, 2.5, 5, 10];
  const step  = steps.map(x => x * mag).find(x => x >= raw) || raw;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = start; t <= max + step * 0.01; t = parseFloat((t + step).toFixed(10))) {
    ticks.push(t);
    if (ticks.length > 12) break;
  }
  return ticks;
}

function _fmtTick(v) {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10)  return v.toFixed(1);
  if (a >= 1)   return v.toFixed(2);
  return v.toFixed(2);
}

const _1M_MARKETS = new Set(['EMP','MPC','SR1','ZQ','VIX','VOXX','SZI0']);

function _displayName(name, market) {
  if (typeof name !== 'string') return name;
  if (!_1M_MARKETS.has(market)) return name;
  return name.replace(/([SLDW])(\d+)/g, (_, prefix, num) =>
    prefix + Math.max(1, Math.round(parseInt(num, 10) / 3))
  );
}
