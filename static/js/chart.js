/**
 * static/js/chart.js — Strategy Mini-Chart Renderer  [PREMIUM v4]
 * ================================================================
 * Data clarification: each point is an equal peer (a roll-position
 * in the futures term structure), NOT a time series. The X-axis shows
 * contract labels (H6, M6, …), not dates. Connected with a line only
 * to show the shape of the curve across positions.
 *
 * Upgrades from PREMIUM v3:
 *  - X-axis ticks: continuous, fully visible — opacity floor lifted to 0.65,
 *    tick stroke upgraded to --border-bright, height increased to 6px
 *  - X-axis baseline stroke widened to 1.0 and uses --border-bright
 *  - X-axis label opacity raised to 0.90, fill uses --text-secondary (brighter)
 *  - Y-axis label opacity raised to 0.90 for consistent legibility
 *  - Grid lines: zero-line upgraded to col-zero at 1.4px, non-zero to 0.9px
 *    with increased opacity (0.80) so the horizontal scaffold is clear
 *  - Name badge: brighter text (text-primary), accent bar at full opacity
 *  - Tooltip separator and row contrast improved
 *  - Area fill: top stop opacity bumped to 0.22, mid to 0.09 for more presence
 *  - Live line glow layer opacity increased 0.07 → 0.11 for visible bloom
 *  - Dot ring on extrema: opacity raised 0.30 → 0.50, stroke-width 0.8 → 1.0
 *  - Slope annotation arrows: backing pill opacity lifted 0.90 → 1.0,
 *    arrow opacity raised to 1.0
 *  - All other features preserved (clippath, settle line, hi/lo band, etc.)
 */

import STATE from './state.js';
import { modePoints, toY, toX } from './utils.js';

const W   = 400;
const H   = 200;
const PAD = { top: 28, right: 8, bottom: 34, left: 26 };

const tooltipEl = document.getElementById('chartTooltip');

export function renderMiniChart(svgEl, strategy, mode) {
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  svgEl.innerHTML = '';
  const markerLayer = _fixedMarkerLayer(svgEl);
  if (markerLayer) markerLayer.innerHTML = '';

  const points = strategy.points || [];

  // ── Clip path so chart content never bleeds into padding ──────────────────
  const clipId = `clip_${strategy.name.replace(/\W/g,'_')}`;
  const defs0  = _el('defs');
  const clip   = _el('clipPath');
  clip.setAttribute('id', clipId);
  const clipRect = _el('rect');
  clipRect.setAttribute('x',      PAD.left.toString());
  clipRect.setAttribute('y',      PAD.top.toString());
  clipRect.setAttribute('width',  cW.toString());
  clipRect.setAttribute('height', cH.toString());
  clip.appendChild(clipRect);
  defs0.appendChild(clip);
  svgEl.appendChild(defs0);

  if (!points.length) {
    _noDataLabel(svgEl, W / 2, H / 2);
    return;
  }

  const pts = modePoints(points, mode, {
    strategyName: strategy.name,
    market: STATE.get('activeMarket'),
  });
  const n   = pts.length;

  // ── Y domain ──────────────────────────────────────────────────────────────
  const allVals = pts.flatMap(p =>
    [p.live, p.settle, p.high, p.low].filter(v => v != null)
  );
  if (!allVals.length) return;

  let minV = Math.min(...allVals);
  let maxV = Math.max(...allVals);
  const rng = maxV - minV;
  if (rng < 0.001) { minV -= 0.1; maxV += 0.1; }
  else             { minV -= rng * 0.12; maxV += rng * 0.12; }

  const yPx = v => PAD.top  + toY(v, minV, maxV, cH, 0);
  const xPx = i => PAD.left + toX(i, n, cW);

  const baseLineY = PAD.top + cH;

  // ── X-axis baseline — v4: brighter stroke, wider ─────────────────────────
  const plotBg = _el('rect');
  plotBg.setAttribute('x', PAD.left.toString());
  plotBg.setAttribute('y', PAD.top.toString());
  plotBg.setAttribute('width', cW.toString());
  plotBg.setAttribute('height', cH.toString());
  plotBg.setAttribute('rx', '3');
  plotBg.setAttribute('fill', 'rgba(255,255,255,0.010)');
  svgEl.appendChild(plotBg);

  if (mode === 'delta' && minV < 0 && maxV > 0) {
    const zeroY = yPx(0);
    const posTint = _el('rect');
    posTint.setAttribute('x', PAD.left.toString());
    posTint.setAttribute('y', PAD.top.toString());
    posTint.setAttribute('width', cW.toString());
    posTint.setAttribute('height', Math.max(0, zeroY - PAD.top).toFixed(1));
    posTint.setAttribute('fill', 'rgba(74,184,104,0.026)');
    posTint.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(posTint);

    const negTint = _el('rect');
    negTint.setAttribute('x', PAD.left.toString());
    negTint.setAttribute('y', zeroY.toFixed(1));
    negTint.setAttribute('width', cW.toString());
    negTint.setAttribute('height', Math.max(0, PAD.top + cH - zeroY).toFixed(1));
    negTint.setAttribute('fill', 'rgba(196,72,72,0.026)');
    negTint.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(negTint);
  }

  pts.forEach((p, i) => {
    const x = xPx(i);
    const vg = _el('line');
    vg.setAttribute('x1', x.toFixed(1));
    vg.setAttribute('x2', x.toFixed(1));
    vg.setAttribute('y1', PAD.top.toString());
    vg.setAttribute('y2', (PAD.top + cH).toString());
    vg.setAttribute('stroke', 'rgba(174,194,214,0.10)');
    vg.setAttribute('stroke-width', i === 0 || i === n - 1 ? '0.65' : '0.45');
    vg.setAttribute('opacity', i === 0 || i === n - 1 ? '0.58' : '0.42');
    svgEl.appendChild(vg);
  });

  const axisLine = _el('line');
  axisLine.setAttribute('x1', PAD.left.toString());
  axisLine.setAttribute('x2', (PAD.left + cW).toString());
  axisLine.setAttribute('y1', baseLineY.toFixed(1));
  axisLine.setAttribute('y2', baseLineY.toFixed(1));
  axisLine.setAttribute('stroke', 'rgba(174,194,214,0.26)');
  axisLine.setAttribute('stroke-width', '0.7');
  svgEl.appendChild(axisLine);

  // ── Subtle grid lines (horizontal only) ──────────────────────────────────
  const ticks = _niceTicks(minV, maxV, 4);
  ticks.forEach(t => {
    if (mode === 'delta' && Math.abs(t) < 0.0001) return;
    const y      = yPx(t);
    const isZero = Math.abs(t) < 0.0001;
    const gl     = _el('line');
    gl.setAttribute('x1', PAD.left.toString());
    gl.setAttribute('x2', (PAD.left + cW).toString());
    gl.setAttribute('y1', y.toFixed(1));
    gl.setAttribute('y2', y.toFixed(1));
    gl.setAttribute('stroke', isZero ? 'rgba(45,212,191,0.55)' : 'rgba(174,194,214,0.11)');
    gl.setAttribute('stroke-width', isZero ? '1.0' : '0.55');
    gl.setAttribute('opacity', isZero ? '0.56' : '0.42');
    if (isZero) gl.setAttribute('stroke-dasharray', '3 4');
    svgEl.appendChild(gl);
  });

  if (mode === 'delta' && minV < 0 && maxV > 0) {
    const zy = yPx(0);
    const zlGlow = _el('line');
    zlGlow.setAttribute('x1', PAD.left.toString());
    zlGlow.setAttribute('x2', (PAD.left + cW).toString());
    zlGlow.setAttribute('y1', zy.toFixed(1));
    zlGlow.setAttribute('y2', zy.toFixed(1));
    zlGlow.setAttribute('stroke', 'rgba(45,212,191,0.24)');
    zlGlow.setAttribute('stroke-width', '4');
    zlGlow.setAttribute('opacity', '0.16');
    zlGlow.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(zlGlow);

    const zl = _el('line');
    zl.setAttribute('x1', PAD.left.toString());
    zl.setAttribute('x2', (PAD.left + cW).toString());
    zl.setAttribute('y1', zy.toFixed(1));
    zl.setAttribute('y2', zy.toFixed(1));
    zl.setAttribute('stroke', 'rgba(126,232,225,0.58)');
    zl.setAttribute('stroke-width', '1.05');
    zl.setAttribute('stroke-dasharray', '4 4');
    zl.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(zl);
  }

  // ── Hi/Lo band ────────────────────────────────────────────────────────────
  const hasHL = pts.some(p => p.high != null && p.low != null);
  if (hasHL) {
    const top  = pts.map((p, i) => [xPx(i), p.high != null ? yPx(p.high) : null]);
    const bot  = [...pts].reverse().map((p, i) => [xPx(n-1-i), p.low != null ? yPx(p.low) : null]);
    const poly = [...top, ...bot].filter(([, y]) => y != null);
    if (poly.length > 2) {
      const pg = _el('polygon');
      pg.setAttribute('points', poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
      pg.setAttribute('fill', 'var(--col-range)');
      pg.setAttribute('opacity', '0.85');
      pg.setAttribute('clip-path', `url(#${clipId})`);
      svgEl.appendChild(pg);
    }
  }

  // ── Settle line ───────────────────────────────────────────────────────────
  const settlePts = pts.map((p, i) => [xPx(i), p.settle != null ? yPx(p.settle) : null]);
  const settleD   = _smoothPath(settlePts);
  if (mode !== 'delta' && settleD) {
    const path = _el('path');
    path.setAttribute('d', settleD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(148,163,184,0.50)');
    path.setAttribute('stroke-width', '0.85');
    path.setAttribute('stroke-dasharray', '4 5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', '0.54');
    path.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(path);
  }

  // ── Area fill under live curve ────────────────────────────────────────────
  const livePts = pts.map((p, i) => [xPx(i), p.live != null ? yPx(p.live) : null]);
  const liveD   = _smoothPath(livePts);

  if (liveD) {
    const baseY      = (mode === 'delta' && minV <= 0 && maxV >= 0) ? yPx(0) : baseLineY;
    const validLive  = livePts.filter(([, y]) => y != null);
    if (validLive.length > 1) {
      const first = validLive[0];
      const last  = validLive[validLive.length - 1];
      const areaD = `${liveD} L${last[0].toFixed(1)},${baseY.toFixed(1)} L${first[0].toFixed(1)},${baseY.toFixed(1)} Z`;

      // 3-stop gradient for richer fill depth — v4: brighter stops
      const gradId = `lg_${strategy.name.replace(/\W/g,'_')}`;
      const defs   = _el('defs');
      const grad   = _el('linearGradient');
      grad.setAttribute('id', gradId);
      grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
      const s1 = _el('stop'); s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', 'var(--col-live)'); s1.setAttribute('stop-opacity', mode === 'delta' ? '0.070' : '0.050');
      const s2 = _el('stop'); s2.setAttribute('offset', '45%');  s2.setAttribute('stop-color', 'var(--col-live)'); s2.setAttribute('stop-opacity', mode === 'delta' ? '0.030' : '0.020');
      const s3 = _el('stop'); s3.setAttribute('offset', '100%'); s3.setAttribute('stop-color', 'var(--col-live)'); s3.setAttribute('stop-opacity', '0.00');
      grad.appendChild(s1); grad.appendChild(s2); grad.appendChild(s3);
      defs.appendChild(grad);
      svgEl.appendChild(defs);

      const area = _el('path');
      area.setAttribute('d', areaD);
      area.setAttribute('fill', `url(#${gradId})`);
      area.setAttribute('clip-path', `url(#${clipId})`);
      svgEl.appendChild(area);
    }

    // BACK GLOW LINE (soft ambient) — v4: more bloom
    const glow = _el('path');
    glow.setAttribute('d', liveD);
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', 'var(--col-live)');
    glow.setAttribute('stroke-width', '2.4');
    glow.setAttribute('opacity', '0.075');
    glow.setAttribute('stroke-linecap', 'round');
    glow.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(glow);

    // Crisp live line
    const path = _el('path');
    path.setAttribute('d', liveD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(224,246,255,0.96)');
    path.setAttribute('stroke-width', '1.35');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(path);

    // Inner aliased crisp overlay at 1px for sharpness
    const sharp = _el('path');
    sharp.setAttribute('d', liveD);
    sharp.setAttribute('fill', 'none');
    sharp.setAttribute('stroke', 'rgba(126,232,225,0.72)');
    sharp.setAttribute('stroke-width', '0.5');
    sharp.setAttribute('opacity', '0.40');
    sharp.setAttribute('stroke-linejoin', 'round');
    sharp.setAttribute('stroke-linecap', 'round');
    sharp.setAttribute('clip-path', `url(#${clipId})`);
    svgEl.appendChild(sharp);
  }

  // ── Dots + hit circles ────────────────────────────────────────────────────
  const liveSeries = pts.map(p => p.live);
  const hiVal = Math.max(...liveSeries.filter(v => v != null));
  const loVal = Math.min(...liveSeries.filter(v => v != null));

  pts.forEach((p, i) => {
    if (p.live == null) return;

    const x    = xPx(i);
    const y    = yPx(p.live);
    const raw  = points[i];
    const isHi = Math.abs(p.live - hiVal) < 0.0001;
    const isLo = Math.abs(p.live - loVal) < 0.0001 && n > 1;
    const isLatest = i === n - 1;
    const prevLive = i > 0 ? pts[i - 1]?.live : null;
    const nextLive = i < n - 1 ? pts[i + 1]?.live : null;
    const isPeak = prevLive != null && nextLive != null && p.live > prevLive && p.live > nextLive;
    const isTrough = prevLive != null && nextLive != null && p.live < prevLive && p.live < nextLive;
    const markerStroke = isHi || isPeak ? 'var(--col-pos)' : isLo || isTrough ? 'var(--col-neg)' : 'var(--col-live)';
    const markerFill = isHi || isLo || isPeak || isTrough ? markerStroke : 'var(--bg-raised)';
    _addFixedMarker(markerLayer, x, y, W, H, markerStroke, markerFill, {
      pivot: isHi || isLo || isPeak || isTrough,
      latest: isLatest,
    });

    // Outer glow ring on extrema — v4: more prominent
    if (isHi || isLo || isPeak || isTrough) {
      const ring = _el('circle');
      ring.setAttribute('cx', x.toFixed(1));
      ring.setAttribute('cy', y.toFixed(1));
      ring.setAttribute('r', '4.5');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', isHi || isPeak ? 'var(--col-pos)' : 'var(--col-neg)');
      ring.setAttribute('stroke-width', '1.0');     // v4: was 0.8
      ring.setAttribute('opacity', '0');
      svgEl.appendChild(ring);
    }

    // Dot — filled ring style
    const dot = _el('circle');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill',   isHi || isPeak ? 'var(--col-pos)' : isLo || isTrough ? 'var(--col-neg)' : 'var(--bg-raised)');
    dot.setAttribute('stroke', isHi || isPeak ? 'var(--col-pos)' : isLo || isTrough ? 'var(--col-neg)' : 'var(--col-live)');
    dot.setAttribute('stroke-width', '1.5');
    dot.setAttribute('opacity', '0');
    svgEl.appendChild(dot);

    if (isLatest) {
      const latest = _el('circle');
      latest.setAttribute('cx', x.toFixed(1));
      latest.setAttribute('cy', y.toFixed(1));
      latest.setAttribute('r', '5.2');
      latest.setAttribute('fill', 'none');
      latest.setAttribute('stroke', 'var(--col-live)');
      latest.setAttribute('stroke-width', '1.1');
      latest.setAttribute('opacity', '0');
      latest.style.filter = 'drop-shadow(0 0 4px rgba(184,208,232,0.45))';
      latest.style.pointerEvents = 'none';
      svgEl.appendChild(latest);
    }

// ── Single mousemove overlay — snaps tooltip to nearest point ─────────────
  });

  const hoverMarker = _addFixedMarker(markerLayer, 0, 0, W, H, 'var(--col-live)', 'var(--bg-raised)', {
    hover: true,
  });

  const overlay = _el('rect');
  overlay.setAttribute('x',      PAD.left.toString());
  overlay.setAttribute('y',      PAD.top.toString());
  overlay.setAttribute('width',  cW.toString());
  overlay.setAttribute('height', cH.toString());
  overlay.setAttribute('fill',   'transparent');
  overlay.style.pointerEvents = 'all';
  overlay.style.cursor = 'crosshair';
  svgEl.appendChild(overlay);

  // Crosshair vertical line — shown on hover
  const crosshair = _el('line');
  crosshair.setAttribute('y1',           PAD.top.toString());
  crosshair.setAttribute('y2',           (PAD.top + cH).toString());
  crosshair.setAttribute('stroke',       'var(--border-bright)');
  crosshair.setAttribute('stroke-width', '0.8');
  crosshair.setAttribute('stroke-dasharray', '3 3');
  crosshair.setAttribute('opacity',      '0');
  crosshair.style.pointerEvents = 'none';
  svgEl.appendChild(crosshair);

  // Active dot — snaps to nearest point
  const snapDot = _el('circle');
  snapDot.setAttribute('r',            '3.5');
  snapDot.setAttribute('fill',         'var(--bg-raised)');
  snapDot.setAttribute('stroke',       'var(--col-live)');
  snapDot.setAttribute('stroke-width', '1.8');
  snapDot.setAttribute('opacity',      '0');
  snapDot.style.pointerEvents = 'none';
  svgEl.appendChild(snapDot);

  // Build lookup array: [{x, y, index}]
  const pointsXY = pts.map((p, i) => ({
    i,
    x: xPx(i),
    y: p.live != null ? yPx(p.live) : null,
    raw: points[i],
    live: p.live,
    settle: p.settle,
  })).filter(p => p.y != null);

  function _getNearestByX(mouseX) {
    let best = null, bestDist = Infinity;
    for (const pt of pointsXY) {
      const d = Math.abs(pt.x - mouseX);
      if (d < bestDist) { bestDist = d; best = pt; }
    }
    return best;
  }

  // Convert mouse event → SVG coordinate space
  function _svgX(e) {
    const rect = svgEl.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    return frac * W;
  }

  overlay.addEventListener('mousemove', (e) => {
    const mx  = _svgX(e);
    const pt  = _getNearestByX(mx);
    if (!pt) return;

    // Snap crosshair + dot
    crosshair.setAttribute('x1',      pt.x.toFixed(1));
    crosshair.setAttribute('x2',      pt.x.toFixed(1));
    crosshair.setAttribute('opacity', '0.6');

    snapDot.setAttribute('opacity', '0');
    if (hoverMarker) {
      hoverMarker.style.left = `${(pt.x / W) * 100}%`;
      hoverMarker.style.top = `${(pt.y / H) * 100}%`;
      hoverMarker.style.opacity = '1';
    }

    const rawLive   = pt.raw?.live;
    const rawSettle = pt.raw?.settle;
    _showTooltip(e, `
<b>${pt.raw?.label ?? ''}</b>
<div>Live&nbsp;&nbsp;${rawLive   != null ? rawLive.toFixed(2)   : '—'}</div>
<div>Setl&nbsp;&nbsp;${rawSettle != null ? rawSettle.toFixed(2) : '—'}</div>
<div>Val&nbsp;&nbsp;&nbsp;${pt.live   != null ? pt.live.toFixed(2)   : '—'}</div>
`);
  });

  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', '0');
    snapDot.setAttribute('opacity',   '0');
    if (hoverMarker) hoverMarker.style.opacity = '0';
    _hideTooltip();
  });

if (STATE.get('showChartLabels')) {
    _drawValueLabels(svgEl, pts, xPx, yPx, cH);
  } else {
    // Default (labels OFF): show extremes only — first, last, hi, lo
    const n2 = pts.length;
    pts.forEach((p, i) => {
      if (p.live == null) return;
      const isLast  = i === n2 - 1;
      const isHi    = Math.abs(p.live - hiVal) < 0.0001;
      const isLo    = Math.abs(p.live - loVal) < 0.0001 && n2 > 1;
      const prev = i > 0 ? pts[i - 1]?.live : null;
      const next = i < n2 - 1 ? pts[i + 1]?.live : null;
      const isPeak = prev != null && next != null && p.live > prev && p.live > next;
      const isTrough = prev != null && next != null && p.live < prev && p.live < next;
      if (i > 0 && prev != null && Math.abs(p.live - prev) < 0.0001) return;
      if (!isLast && !isHi && !isLo && !isPeak && !isTrough) return;

      const x   = xPx(i);
      const y   = yPx(p.live);
      const forceAbove = isPeak || isHi;
      const forceBelow = isTrough || isLo;
      const isUpper = y < PAD.top + cH * 0.5;
      const ly  = forceAbove ? y - 9 : forceBelow ? y + 9 : isUpper ? y + 8 : y - 8;
      const lx  = isLast ? x - 2 : x;
      const anchor = isLast ? 'end' : 'middle';
      const col = isHi || isPeak ? 'var(--col-pos)' : isLo || isTrough ? 'var(--col-neg)' : 'var(--text-secondary)';

      const lbl = _el('text');
      lbl.setAttribute('x', lx.toFixed(1));
      lbl.setAttribute('y', ly.toFixed(1));
      lbl.setAttribute('text-anchor', anchor);
      lbl.setAttribute('dominant-baseline', 'middle');
      lbl.setAttribute('font-family', 'var(--font-data)');
      lbl.setAttribute('font-size', '8.5');
      lbl.setAttribute('font-weight', isHi || isLo ? '500' : '350');
      lbl.setAttribute('fill', col);
      lbl.style.pointerEvents = 'none';
      lbl.textContent = Math.abs(p.live).toFixed(1);
      svgEl.appendChild(lbl);
    });
  }

  // ── Y-axis tick labels — v4: brighter ────────────────────────────────────
  ticks.forEach(t => {
    if (mode === 'delta' && Math.abs(t) < 0.0001) return;
    const y     = yPx(t);
    const isNeg = t < -0.0001;
    const col   = isNeg ? 'var(--col-neg)' : 'var(--text-secondary)';

    const txt = _el('text');
    txt.setAttribute('x', (PAD.left - 4).toString());   // v4: +1px more left room
    txt.setAttribute('y', (y + 1).toFixed(1));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('font-family', 'var(--font-data)');
    txt.setAttribute('font-size', '7.5');
    txt.setAttribute('fill', col);
    txt.setAttribute('opacity', '0.52');
    txt.textContent = Math.abs(_fmtTick(t));
    svgEl.appendChild(txt);
  });

  // ── X-axis ticks — continuous at every point ──────────────────────────────
  // v4: opacity floor raised, stroke upgraded, tick height increased
  pts.forEach((p, i) => {
    const x = xPx(i);

    // Tick mark — every point gets one
    const tick = _el('line');
    tick.setAttribute('x1', x.toFixed(1));
    tick.setAttribute('x2', x.toFixed(1));
    tick.setAttribute('y1', (baseLineY + 0.5).toFixed(1));
    tick.setAttribute('y2', (baseLineY + 6.5).toFixed(1));  // v4: taller (was +5.5)
    // v4: opacity range lifted — floor 0.65, edge peaks at 1.0
    const centerDist   = Math.abs(i - (n - 1) / 2) / Math.max(n / 2, 1);
    const tickOpacity  = 0.38 + 0.26 * (1 - centerDist * 0.5);
    tick.setAttribute('stroke', 'rgba(174,194,214,0.42)');
    tick.setAttribute('stroke-width', '0.7');
    tick.setAttribute('opacity', tickOpacity.toFixed(2));
    svgEl.appendChild(tick);
  });

  // ── X-axis contract labels — skip-based for density control ──────────────
  const xLabelStep = n <= 6 ? 1 : n <= 12 ? 2 : Math.ceil(n / 8);
  let lastXLabelX  = -Infinity;
  const minGap     = 20;
  pts.forEach((p, i) => {
    const isFirst = i === 0;
    const isLast  = i === n - 1;
    if (i % xLabelStep !== 0 && !isLast) return;
    const x = xPx(i);
    if (Math.abs(x - lastXLabelX) < minGap && !isFirst && !isLast) return;
    lastXLabelX = x;

    const txt = _el('text');
    txt.setAttribute('x', x.toFixed(1));
    txt.setAttribute('y', (baseLineY + 11).toFixed(1));  // v4: shifted down to match taller ticks
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('font-family', 'var(--font-data)');
    txt.setAttribute('font-size', '7.5');
    txt.setAttribute('fill', 'var(--text-secondary)');   // v4: was text-secondary at 0.75
    txt.setAttribute('opacity', '0.72');
    txt.textContent = points[i]?.label ?? `#${i}`;
    svgEl.appendChild(txt);
  });

  // ── Slope annotation ──────────────────────────────────────────────────────
  _nameOverlay(svgEl, _displayName(strategy.name));
  _drawSlopeAnnotation(svgEl, pts, points, xPx, yPx, n);

}


// ── Name badge — pill-backed, accent-left-border, uppercase ─────────────────
function _nameOverlay(svgEl, name) {
  if (!name) return;

  const rawText = name.toUpperCase();
  const text = rawText.length > 18 ? `${rawText.slice(0, 15)}...` : rawText;
  const tw = Math.min(120, text.length * 5.5 + 14);

  // Pill background
  const pill = _el('rect');
  pill.setAttribute('x', '0');
  pill.setAttribute('y', '0');
  pill.setAttribute('width',  tw.toFixed(1));
  pill.setAttribute('height', '17');
  pill.setAttribute('rx', '7');
  pill.setAttribute('fill', 'rgba(11,18,32,0.82)');
  pill.setAttribute('stroke', 'rgba(126,232,225,0.16)');
  pill.setAttribute('stroke-width', '0.8');
  pill.setAttribute('opacity', '0.96');
  svgEl.appendChild(pill);

  // Accent left border bar
  const bar = _el('rect');
  bar.setAttribute('x', '0');
  bar.setAttribute('y', '3');
  bar.setAttribute('width', '1.5');
  bar.setAttribute('height', '11');
  bar.setAttribute('fill', 'rgba(126,232,225,0.78)');
  bar.setAttribute('opacity', '1.0');            // v4: was 0.85 — full saturation
  svgEl.appendChild(bar);

  // Text
  const txt = _el('text');
  txt.setAttribute('x', '8');
  txt.setAttribute('y', '9');
  txt.setAttribute('text-anchor', 'start');
  txt.setAttribute('dominant-baseline', 'middle');
  txt.setAttribute('font-family', 'var(--font-ui)');
  txt.setAttribute('font-size', rawText.length > 14 ? '8.4' : '9.2');
  txt.setAttribute('font-weight', '700');
  txt.setAttribute('letter-spacing', '0.09em');
  txt.setAttribute('fill', 'rgba(232,244,255,0.94)');
  txt.setAttribute('opacity', '0.96');               // v4: was 0.92
  txt.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))';
  txt.textContent = text;
  svgEl.appendChild(txt);
}


// ── Slope annotation ──────────────────────────────────────────────────────────
function _drawSlopeAnnotation(svgEl, pts, rawPts, xPx, yPx, n) {
  if (n < 2) return;

  let maxUpSlope   = 0, maxUpIdx   = -1;
  let maxDownSlope = 0, maxDownIdx = -1;

  for (let i = 0; i < n - 1; i++) {
    const a = pts[i].live, b = pts[i+1].live;
    if (a == null || b == null) continue;

    const slope = b - a;

    if (slope > 0 && slope > maxUpSlope) {
      maxUpSlope = slope;
      maxUpIdx   = i;
    }
    if (slope < 0 && Math.abs(slope) > maxDownSlope) {
      maxDownSlope = Math.abs(slope);
      maxDownIdx   = i;
    }
  }

  const threshold = 0.005;

  // Helper: draw arrow with subtle backing pill — v4: full opacity
  function drawArrow(idx, dir) {
    const mx   = (xPx(idx) + xPx(idx + 1)) / 2;
    const my   = (yPx(pts[idx].live) + yPx(pts[idx+1].live)) / 2;
    const col  = dir > 0 ? 'var(--col-pos)' : 'var(--col-neg)';
    const colD = dir > 0 ? 'var(--col-pos-dim)' : 'var(--col-neg-dim)';


    const arrow = _el('text');
    arrow.setAttribute('x', (mx + 7).toFixed(1));
    arrow.setAttribute('y', (my + 1.5).toFixed(1));
    arrow.setAttribute('text-anchor', 'middle');
    arrow.setAttribute('font-family', 'var(--font-data)');
    arrow.setAttribute('font-size', '8');
    arrow.setAttribute('fill', col);
    arrow.setAttribute('opacity', '1.0');  // v4: was 0.90
    arrow.textContent = dir > 0 ? '▲' : '▼';
    svgEl.appendChild(arrow);
  }

  if (maxUpIdx >= 0 && maxUpSlope >= threshold) {
    drawArrow(maxUpIdx, 1);
  }
  if (maxDownIdx >= 0 && maxDownSlope >= threshold) {
    drawArrow(maxDownIdx, -1);
  }
}

function _drawValueLabels(svgEl, pts, xPx, yPx, cH) {
  const boxes = [];
  const minX = PAD.left + 2;
  const maxX = W - PAD.right - 2;
  const minY = PAD.top + 5;
  const maxY = PAD.top + cH - 5;

  // Identify high and low values once before looping
  const validVals = pts.map(p => p.live).filter(v => v != null && !isNaN(v));
  const hiVal = Math.max(...validVals);
  const loVal = Math.min(...validVals);

  pts.forEach((p, i) => {
    if (p.live == null || isNaN(p.live)) return;
    const prev = i > 0 ? pts[i - 1]?.live : null;
    if (prev != null && !isNaN(prev) && Math.abs(p.live - prev) < 0.0001) return;

    // Filter for first, last, high, low, and alternating points
    const isFirst = i === 0;
    const isLast  = i === pts.length - 1;
    const isHi    = Math.abs(p.live - hiVal) < 0.0001;
    const isLo    = Math.abs(p.live - loVal) < 0.0001;
    // 2. Local Maxima / Minima (Peaks and Valleys)
    // Safely check neighbors to see if current point is higher or lower than both
    const next = !isLast  ? pts[i + 1]?.live : null;
    
    const isLocalMax = prev !== null && next !== null && p.live > prev && p.live > next;
    const isLocalMin = prev !== null && next !== null && p.live < prev && p.live < next;

    // Keep labels sparse: latest point, extrema, and local pivots only.
    if (!isLast && !isHi && !isLo && !isLocalMax && !isLocalMin) return;
   
    const x = xPx(i);
    const y = yPx(p.live);
    const text = p.live.toFixed(1);
    const width = Math.max(18, text.length * 5.3 + 4);
    const height = 9;
    const forceAbove = isLocalMax || isHi;
    const forceBelow = isLocalMin || isLo;
    const preferAbove = forceAbove ? true : forceBelow ? false : y > PAD.top + cH * 0.42;
    const offsets = preferAbove
      ? [[0, -11], [-10, -13], [10, -13], [0, 12], [-10, 14], [10, 14]]
      : [[0, 11], [-10, 13], [10, 13], [0, -12], [-10, -14], [10, -14]];

    let placed = null;
    for (const [dx, dy] of offsets) {
      const anchor = x + dx < minX + width / 2 ? 'start'
        : x + dx > maxX - width / 2 ? 'end'
          : 'middle';
      const lx = anchor === 'start' ? minX : anchor === 'end' ? maxX : x + dx;
      const ly = Math.max(minY, Math.min(maxY, y + dy));
      const left = anchor === 'start' ? lx : anchor === 'end' ? lx - width : lx - width / 2;
      const box = { left, right: left + width, top: ly - height / 2, bottom: ly + height / 2 };

      const clearOfLabels = boxes.every(b =>
        box.right < b.left || box.left > b.right || box.bottom < b.top || box.top > b.bottom
      );
      const clearOfLine = Math.abs(ly - y) >= 8;
      if (clearOfLabels && clearOfLine) {
        placed = { lx, ly, anchor, box };
        break;
      }
    }

    if (!placed) return;
    boxes.push(placed.box);

    const lbl = _el('text');
    lbl.setAttribute('x', placed.lx.toFixed(1));
    lbl.setAttribute('y', placed.ly.toFixed(1));
    lbl.setAttribute('text-anchor', placed.anchor);
    lbl.setAttribute('dominant-baseline', 'middle');
    lbl.setAttribute('font-family', 'var(--font-data)');
    lbl.setAttribute('font-size', '7');
    lbl.setAttribute('font-weight', '300');
    lbl.setAttribute('fill', 'var(--col-live)');
    lbl.setAttribute('opacity', '0.96');
    lbl.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.95))';
    lbl.style.pointerEvents = 'none';
    lbl.textContent = Number(text).toFixed(1);
    svgEl.appendChild(lbl);
  });
}


// ── SVG helpers ───────────────────────────────────────────────────────────────
function _el(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function _smoothPath(pts) {
  const valid = pts.filter(([, y]) => y != null && !isNaN(y));
  if (!valid.length) return '';
  if (valid.length < 3) {
    return valid
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
  }

  let d = `M${valid[0][0].toFixed(1)},${valid[0][1].toFixed(1)}`;
  for (let i = 0; i < valid.length - 1; i++) {
    const p0 = valid[Math.max(0, i - 1)];
    const p1 = valid[i];
    const p2 = valid[i + 1];
    const p3 = valid[Math.min(valid.length - 1, i + 2)];
    const tension = 0.22;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function _fixedMarkerLayer(svgEl) {
  const parent = svgEl.parentElement;
  if (!parent) return null;

  let layer = parent.querySelector(':scope > .chart-fixed-markers');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'chart-fixed-markers';
    parent.appendChild(layer);
  }
  return layer;
}

function _addFixedMarker(layer, x, y, w, h, stroke, fill, opts = {}) {
  if (!layer) return null;
  const marker = document.createElement('span');
  marker.className = 'chart-fixed-marker';
  if (opts.pivot) marker.classList.add('chart-fixed-marker--pivot');
  if (opts.latest) marker.classList.add('chart-fixed-marker--latest');
  if (opts.hover) marker.classList.add('chart-fixed-marker--hover');
  marker.style.setProperty('--marker-stroke', stroke);
  marker.style.setProperty('--marker-fill', fill);
  marker.style.left = `${(x / w) * 100}%`;
  marker.style.top = `${(y / h) * 100}%`;
  layer.appendChild(marker);
  return marker;
}

function _noDataLabel(svgEl, x, y) {
  const t = _el('text');
  t.setAttribute('x', x.toString());
  t.setAttribute('y', y.toString());
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'middle');
  t.setAttribute('font-family', 'var(--font-data)');
  t.setAttribute('font-size', '9');
  t.setAttribute('fill', 'var(--text-dim)');
  t.textContent = 'NO DATA';
  svgEl.appendChild(t);
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
    if (ticks.length > 8) break;
  }
  return ticks;
}

function _fmtTick(v) {
  const a = Math.abs(v);
  if (a === 0)  return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10)  return v.toFixed(0);
  if (a >= 1)   return v.toFixed(1);
  return v.toFixed(1);
}


// ── Tooltip ───────────────────────────────────────────────────────────────────
function _showTooltip(e, html) {
  if (!tooltipEl) return;
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = 'block';
  _moveTooltip(e);
}

function _moveTooltip(e) {
  if (!tooltipEl) return;
  tooltipEl.style.left = e.clientX + 'px';
  tooltipEl.style.top  = e.clientY + 'px';
}

function _hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.style.display = 'none';
}


// ── 1-month market name transform ─────────────────────────────────────────────
const _1M_MARKETS = new Set(['EMP','MPC','SR1','ZQ','VIX','VOXX','SZI0']);

function _displayName(name) {
  const market = STATE.get('activeMarket');
  if (!_1M_MARKETS.has(market)) return name;
  if (typeof name !== 'string') return name;
  return name.replace(/([SLDW])(\d+)/g, (_, prefix, num) =>
    prefix + Math.max(1, Math.round(parseInt(num, 10) / 3))
  );
}
