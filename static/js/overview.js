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
 *   Rates      → Out, S12
 *   Meeting    → Out, S3
 *   Inter      → S12, L12
 *   Short End  → Out, S3  (1m → S1)
 *   Vol        → Out, S3
 *   Other      → Out, S3
 */

import STATE from './state.js';
import { applyCurveWindow } from './utils.js';

// ── Group config ──────────────────────────────────────────────────────────────

const TAB_GROUPS = [
  { label: 'Rates',     color: '#4a9eff', markets: ['SR3', 'ER', 'SO3', 'ER3', 'SA3', 'CRA'],
    strategies: ['Out', 'S12'] },
  { label: 'Meeting',   color: '#f0a828', markets: ['EMP', 'MPC'],
    strategies: ['Out', 'S3'] },
  { label: 'Inter',     color: '#a78bfa', markets: ['SR3 vs ER', 'SR3 vs SO3', 'ER vs SO3'],
    strategies: ['S12', 'L12'] },
  { label: 'Short End', color: '#34d399', markets: ['SR1', 'ZQ'],
    strategies: ['Out', 'S3'] },
  { label: 'Vol',       color: '#f87171', markets: ['VIX', 'VOXX'],
    strategies: ['Out', 'S3'] },
  { label: 'Other',     color: '#94a3b8', markets: ['SZI0'],
    strategies: ['Out', 'S3'] },
];

const _1M = new Set(['EMP', 'MPC', 'SR1', 'ZQ', 'VIX', 'VOXX', 'SZI0', 'SZIO']);
const _INTER_MARKETS = new Set(['SR3 vs ER', 'SR3 vs SO3', 'ER vs SO3']);

// ── State ─────────────────────────────────────────────────────────────────────
let _mountEl = null;
let _visible = false;
let _hoveringSpark = false;

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

STATE.on('showChartLabels', () => { if (_visible) _render(); });
STATE.on('marketsData', () => { if (_visible && !_hoveringSpark) _render(); });
STATE.on('viewMode',    () => { if (_visible) _render(); });
STATE.on('curveLens',   () => { if (_visible) _render(); });
STATE.on('curveSkip',   () => { if (_visible) _render(); });

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

  // Group analytics
  if (group.label === 'Rates') {
    const dd = _buildRatesDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  } else if (group.label === 'Meeting') {
    const dd = _buildMeetingDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  } else if (group.label === 'Inter') {
    const dd = _buildInterDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  } else if (group.label === 'Short End') {
    const dd = _buildShortEndDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  } else if (group.label === 'Vol') {
    const dd = _buildVolDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  } else if (group.label === 'Other') {
    const dd = _buildOtherDeepDive(group, marketsData);
    if (dd) wrap.appendChild(dd);
  }

  // Cards
  const cards = _div('ov-cards');
  group.markets.forEach(mkt => {
    cards.appendChild(_buildCard(mkt, marketsData[mkt], group));
  });
  wrap.appendChild(cards);

  return wrap;
}

// ── Analytics strip ───────────────────────────────────────────────────────────

function _buildStrip(group, marketsData) {
  return null;

  // Only Rates group gets the rich analytics strip
  if (group.label !== 'Rates') return null;

  // ── Collect per-market stats for strip ──────────────────────────────────
  const stats = [];
  group.markets.forEach(mkt => {
    const md = marketsData[mkt];
    if (!md) return;
    const chip = _chip(md, 'Default');
    if (!chip) return;

    const out = _findStrat(chip, 'Out',  mkt);
    const s12 = _findStrat(chip, 'S12',  mkt);
    const outPts = out?.points ?? [];
    const s12Pts = s12?.points ?? [];

    // Max-move = contract with largest |delta| across ALL points in this market's strategy.
    // Returns { label, val (multiplied), absVal, arrow }
    const _maxMove = (pts, mult = 1) => {
      let best = null, bestAbs = -Infinity;
      pts.forEach(p => {
        if (p.delta == null) return;
        const abs = Math.abs(p.delta);
        if (abs > bestAbs) { bestAbs = abs; best = { label: p.label, val: p.delta * mult, absVal: abs * mult }; }
      });
      if (best) best.arrow = best.val >= 0 ? '▲' : '▼';
      return best;
    };

    // Curve shape from today's OUT delta profile
    // bull/bear: median outright delta direction
    // steep/flat: compare front-half median vs back-half median of s12 deltas
    let shape = '—';
    if (outPts.length && s12Pts.length >= 2) {
      const outDeltas = outPts.map(p => p.delta ?? 0).filter(v => v !== 0);
      const isBull = outDeltas.length
        ? outDeltas.reduce((a, b) => a + b, 0) / outDeltas.length > 0
        : false;

      const mid = Math.floor(s12Pts.length / 2);
      const frontAvg = s12Pts.slice(0, mid || 1).reduce((a, p) => a + (p.delta ?? 0), 0) / (mid || 1);
      const backAvg  = s12Pts.slice(mid).reduce((a, p) => a + (p.delta ?? 0), 0) / (s12Pts.length - mid || 1);
      // Steepening = front spreads rallying more than back (frontAvg > backAvg in bull; reverse in bear)
      const isSteep  = isBull ? frontAvg > backAvg : frontAvg < backAvg;

      shape = (isBull ? 'BULL' : 'BEAR') + (isSteep ? ' STEEP' : ' FLAT');
    }

    // Absolute-price similarity uses live prices; delta similarity uses delta arrays
    stats.push({
      mkt,
      outMaxMove: _maxMove(outPts, 100),   // OUT ×100
      s12MaxMove: _maxMove(s12Pts, 1),
      outAvgDelta: _avgDelta(outPts),
      outLive:    outPts.map(p => p.live  ?? 0),  // for absolute similarity
      outDeltas:  outPts.map(p => p.delta ?? 0),  // for delta similarity
      shape,
    });
  });

  if (!stats.length) return null;

  // Lead with the headline impact: average selloff/buying across the OUT curve.
  const stripImpactOut = stats.filter(s => s.outAvgDelta != null).sort((a, b) => a.outAvgDelta - b.outAvgDelta);
  if (stripImpactOut.length >= 2) {
    const hawk = stripImpactOut[0];
    const dove = stripImpactOut[stripImpactOut.length - 1];
    const hdPanel = _div('ov-dp ov-dp--wide ov-dp--impact');
    hdPanel.innerHTML = `
      <div class="ov-dp-title">HAWKISH / DOVISH Â· AVG OUT Î”</div>
      <div class="ov-hd">
        <div class="ov-hd-side ov-hd-hawk">
          <div class="ov-hd-arrow">â–¼</div>
          <div class="ov-hd-ttl">MOST HAWKISH</div>
          <div class="ov-hd-mkt">${hawk.mkt}</div>
          <div class="ov-hd-val neg">${_fd1(hawk.outAvgDelta * 100)}</div>
        </div>
        <div class="ov-hd-rule"></div>
        <div class="ov-hd-side ov-hd-dove">
          <div class="ov-hd-arrow">â–²</div>
          <div class="ov-hd-ttl">MOST DOVISH</div>
          <div class="ov-hd-mkt">${dove.mkt}</div>
          <div class="ov-hd-val pos">${_fd1(dove.outAvgDelta * 100)}</div>
        </div>
      </div>
    `;
    panels.appendChild(hdPanel);
  }

  // ── 1. OUT max move (×100) ──────────────────────────────────────────────
  const outMoves = stats
    .filter(s => s.outMaxMove)
    .sort((a, b) => Math.abs(b.outMaxMove.val) - Math.abs(a.outMaxMove.val));
  const topOut = outMoves[0];

  // ── 2. S12 max move ─────────────────────────────────────────────────────
  const s12Moves = stats
    .filter(s => s.s12MaxMove)
    .sort((a, b) => Math.abs(b.s12MaxMove.val) - Math.abs(a.s12MaxMove.val));
  const topS12 = s12Moves[0];

  // ── 5. Hawk / Dove ──────────────────────────────────────────────────────
  const validOut = stats.filter(s => s.outAvgDelta != null).sort((a, b) => a.outAvgDelta - b.outAvgDelta);
  const hawk = validOut[0];
  const dove = validOut[validOut.length - 1];

  // ── 6. Similarity by absolute live prices (Pearson on live array) ───────
  const _simPair = (arr, key) => {
    const mkts = arr.filter(s => s[key]?.length >= 2);
    let bestSim = null, bestR = -Infinity;
    for (let i = 0; i < mkts.length; i++) {
      for (let j = i + 1; j < mkts.length; j++) {
        const a = mkts[i][key], b = mkts[j][key];
        const len = Math.min(a.length, b.length);
        if (len < 2) continue;
        const r = _pearson(a.slice(0, len), b.slice(0, len));
        if (r > bestR) { bestR = r; bestSim = [mkts[i].mkt, mkts[j].mkt, r]; }
      }
    }
    return bestSim;
  };

  const simAbs   = _simPair(stats, 'outLive');    // by absolute price level
  const simDelta = _simPair(stats, 'outDeltas');  // by today's change

  // ── Build pills ──────────────────────────────────────────────────────────
  const pills = [];

  if (topOut) {
    const m = topOut.outMaxMove;
    pills.push({ l: `OUT MAX MOVE`, mkt: topOut.mkt, contract: m.label,
      arrow: m.arrow, v: _fd1(m.absVal), c: m.val >= 0 ? 'pos' : 'neg' });
  }
  if (topS12) {
    const m = topS12.s12MaxMove;
    pills.push({ l: `S12 MAX MOVE`, mkt: topS12.mkt, contract: m.label,
      arrow: m.arrow, v: _fd(m.absVal), c: m.val >= 0 ? 'pos' : 'neg' });
  }
  if (hawk && dove && hawk.mkt !== dove.mkt) {
    pills.push({ l: 'MOST HAWKISH', mkt: hawk.mkt, contract: 'AVG OUT Δ',
      arrow: '▼', v: _fd1(hawk.outAvgDelta * 100), c: 'neg' });
    pills.push({ l: 'MOST DOVISH', mkt: dove.mkt, contract: 'AVG OUT Δ',
      arrow: '▲', v: _fd1(dove.outAvgDelta * 100), c: 'pos' });
  }
  if (simAbs) {
    pills.push({ l: 'SIM · ABS PRICE', mkt: null, contract: `${simAbs[0]} ↔ ${simAbs[1]}`,
      arrow: null, v: `ρ ${simAbs[2].toFixed(2)}`, c: 'neu' });
  }
  if (simDelta) {
    pills.push({ l: 'SIM · TODAY Δ', mkt: null, contract: `${simDelta[0]} ↔ ${simDelta[1]}`,
      arrow: null, v: `ρ ${simDelta[2].toFixed(2)}`, c: 'neu' });
  }

  if (!pills.length) return null;

  const strip = _div('ov-strip');
  pills.forEach(p => {
    const pill = _div('ov-pill');
    // label line: static label
    // value line: arrow + value (large, colored) + inline contract/mkt annotation
    const annotation = p.contract
      ? `<span class="ov-pill-ann">${p.contract}</span>`
      : '';
    const mktBadge = p.mkt
      ? `<span class="ov-pill-mkt">${p.mkt}</span>`
      : '';
    pill.innerHTML = `
      <span class="ov-pill-l">${p.l}</span>
      <span class="ov-pill-val-row">
        ${p.arrow ? `<span class="ov-pill-arrow ${p.c}">${p.arrow}</span>` : ''}
        <span class="ov-pill-v ${p.c}">${p.v}</span>
        ${mktBadge}${annotation}
      </span>
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
    document.getElementById('overviewPanel')?.classList.add('hidden');
    document.getElementById('contentRow')?.classList.remove('hidden');
    document.getElementById('panelLoading')?.classList.add('hidden');
    document.getElementById('chipBar')?.classList.remove('hidden');
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

    const strat = { ...applyCurveWindow(rawstrat, mkt), market: mkt };

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
    //if (!showLabels) return;
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

    // ── Value labels along series line (toggle-gated) ─────────────────────────
  if (STATE.get('showChartLabels')) {
    const boxes = [];  // collision registry [{x1,x2,y1,y2}]
    const mult = isOut && mode === 'delta' ? 100 : 1;

    pts.forEach((p, i) => {
      const v = vals[i];
      if (v == null) return;

      const px = xp(i);
      const py = yp(v);
      const displayVal = (v * mult).toFixed(isOut && mode === 'delta' ? 1 : 2);
      const text = (v * mult >= 0 ? '+' : '') + displayVal;

      // Estimated label size at font-size 6
      const tw = text.length * 3.6 + 2;
      const th = 7;

      // Try above then below the point; clamp to SVG bounds
      const offsets = py > SPARK_H * 0.5
        ? [[-th - 2], [th + 2]]   // prefer above when point is in lower half
        : [[th + 2], [-th - 2]];  // prefer below when point is in upper half

      let placed = null;
      for (const [dy] of offsets) {
        const cy = py + dy;
        if (cy - th / 2 < PAD.t || cy + th / 2 > SPARK_H - 2) continue;  // out of bounds

        // anchor: left edge if near left, right edge if near right, else middle
        const anchor = px < W * 0.15 ? 'start' : px > W * 0.85 ? 'end' : 'middle';
        const lx = anchor === 'start' ? px : anchor === 'end' ? px : px;
        const bx1 = anchor === 'start' ? lx : anchor === 'end' ? lx - tw : lx - tw / 2;
        const bx2 = bx1 + tw;
        const by1 = cy - th / 2;
        const by2 = cy + th / 2;

        // Check no overlap with already-placed labels
        const clear = boxes.every(b =>
          bx2 < b.x1 - 1 || bx1 > b.x2 + 1 || by2 < b.y1 - 1 || by1 > b.y2 + 1
        );
        // Also ensure label doesn't sit on the line itself (vertical gap from line)
        const lineGap = Math.abs(cy - py) >= 5;
        if (clear && lineGap) {
          placed = { lx, cy, anchor, bx1, bx2, by1, by2 };
          break;
        }
      }

      if (!placed) return;
      boxes.push({ x1: placed.bx1, x2: placed.bx2, y1: placed.by1, y2: placed.by2 });

      const t = mk('text');
      t.setAttribute('x', placed.lx.toFixed(1));
      t.setAttribute('y', placed.cy.toFixed(1));
      t.setAttribute('text-anchor', placed.anchor);
      t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('font-family', 'var(--font-data)');
      t.setAttribute('font-size', '5');
      t.setAttribute('font-weight', '300');
      t.setAttribute('fill', color);          // same color as series line
      t.setAttribute('opacity', '0.92');
      t.style.pointerEvents = 'none';
      t.textContent = Number(text).toFixed(1);
      svg.appendChild(t);
    });
  }
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
  overlay.style.pointerEvents = 'all';

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

  let hideTimer = null;
  const cancelHide = () => {
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  overlay.addEventListener('mouseenter', () => {
    cancelHide();
    _hoveringSpark = true;
    _TIP_SVG = svg;
  });

  overlay.addEventListener('mousemove', e => {
    cancelHide();
    _hoveringSpark = true;
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

  overlay.addEventListener('mouseleave', () => {
    cancelHide();
    hideTimer = setTimeout(() => {
      if (_TIP_SVG !== svg) return;
      hide();
      _hoveringSpark = false;
      if (_visible) _render();
    }, 120);
  });

  // Move the hover surface back to the top after adding crosshair layers.
  svg.appendChild(overlay);
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

  const panels = _div('ov-dd-panels');

  // Collect per-market stats
  const stats = [];
  const shapeColors = {
    'BULL STEEP': '#4ab868', 'BULL FLAT': '#f0a828',
    'BEAR STEEP': '#f87171', 'BEAR FLAT': '#c44848',
  };

  group.markets.forEach(mkt => {
    const md = marketsData[mkt];
    if (!md) return;
    const chip = _chip(md, 'Default');
    if (!chip) return;

    const out  = _findStrat(chip, 'Out',  mkt);
    const s12  = _findStrat(chip, 'S12',  mkt);
    const outPts    = out?.points ?? [];
    const s12Pts    = s12?.points ?? [];

    // Curve shape driven by today's delta profile across the whole OUT and S12 curves
    // bull/bear  → median of all OUT point deltas
    // steep/flat → compare front-half vs back-half mean of S12 deltas
    //              steep: front spreads move more than back (bull) or less (bear)
    let shape = '—';
    if (outPts.length && s12Pts.length >= 2) {
      const outDeltas = outPts.map(p => p.delta ?? 0);
      const meanOut   = outDeltas.reduce((a, b) => a + b, 0) / outDeltas.length;
      const isBull    = meanOut > 0;

      const mid      = Math.floor(s12Pts.length / 2) || 1;
      const frontAvg = s12Pts.slice(0, mid).reduce((a, p) => a + (p.delta ?? 0), 0) / mid;
      const backAvg  = s12Pts.slice(mid).reduce((a, p) => a + (p.delta ?? 0), 0) / Math.max(1, s12Pts.length - mid);
      const isSteep  = isBull ? frontAvg > backAvg : frontAvg < backAvg;
      shape = (isBull ? 'BULL' : 'BEAR') + (isSteep ? ' STEEP' : ' FLAT');
    }

    stats.push({
      mkt,
      outDelta:   _maxAbsDelta(outPts),
      outAvgDelta: _avgDelta(outPts),
      s12Delta:   _maxAbsDelta(s12Pts),
      s12RollDn:  _bestRoll(s12Pts, 'down'),
      s12RollUp:  _bestRoll(s12Pts, 'up'),
      outPts,
      s12Pts,
      // arrays for similarity panels
      outLive:    outPts.map(p => p.live  ?? 0),
      outDeltas:  outPts.map(p => p.delta ?? 0),
      shape,
    });
  });

  if (!stats.length) return null;

  // Panel 1: OUT Δ ranking — values ×100 (tick-value convention)
  panels.appendChild(_rankPanel('OUT MAX Δ RANKING', stats, 'outDelta', group.color, 100));
  // Panel 2: S12 Δ ranking
  panels.appendChild(_rankPanel('S12 MAX Δ RANKING', stats, 's12Delta', '#a78bfa', 1));
  // Panel 3: S12 roll opportunity rankings
  panels.appendChild(_rollRankPanel('S12 ROLL DN', stats, 's12RollDn', '#f87171'));
  panels.appendChild(_rollRankPanel('S12 ROLL UP', stats, 's12RollUp', '#34d399'));
  // Panel 4: Curve shape (today's delta profile — all markets)
  const shapePanel = _div('ov-dp');
  shapePanel.innerHTML = `<div class="ov-dp-title">CURVE SHAPE · TODAY Δ</div>`;
  const shapeBody = _div('ov-dp-body');
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

  // Panel 5: Hawkish / Dovish — average OUT delta ×100
  const validOut = stats.filter(s => s.outAvgDelta != null).sort((a, b) => a.outAvgDelta - b.outAvgDelta);
  if (validOut.length >= 2) {
    const hawk = validOut[0];
    const dove = validOut[validOut.length - 1];
    const hdPanel = _div('ov-dp ov-dp--wide ov-dp--impact');
    hdPanel.innerHTML = `
      <div class="ov-dp-title">HAWKISH / DOVISH · AVG OUT Δ</div>
      <div class="ov-hd">
        <div class="ov-hd-side ov-hd-hawk">
          <div class="ov-hd-arrow">▼</div>
          <div class="ov-hd-ttl">MOST HAWKISH</div>
          <div class="ov-hd-mkt">${hawk.mkt}</div>
          <div class="ov-hd-val neg">${_fd1(hawk.outAvgDelta * 100)}</div>
        </div>
        <div class="ov-hd-rule"></div>
        <div class="ov-hd-side ov-hd-dove">
          <div class="ov-hd-arrow">▲</div>
          <div class="ov-hd-ttl">MOST DOVISH</div>
          <div class="ov-hd-mkt">${dove.mkt}</div>
          <div class="ov-hd-val pos">${_fd1(dove.outAvgDelta * 100)}</div>
        </div>
      </div>
    `;
    panels.appendChild(hdPanel);
  }

  // Panel 6: Similarity by absolute OUT price level (Pearson on live arrays)
  const simAbsPanel = _buildSimilarityPanel(stats, 'outLive', 'MOST SIMILAR · ABS PRICE LEVEL');
  if (simAbsPanel) panels.appendChild(simAbsPanel);

  // Panel 7: Similarity by today's OUT delta change
  const simDeltaPanel = _buildSimilarityPanel(stats, 'outDeltas', 'MOST SIMILAR · DELTA CHANGE');
  if (simDeltaPanel) panels.appendChild(simDeltaPanel);

  wrap.appendChild(panels);
  return wrap;
}

function _buildMeetingDeepDive(group, marketsData) {
  const stats = _collectOutS1Stats(group, marketsData);
  if (!stats.length) return null;

  const wrap = _div('ov-dd ov-dd--meeting');
  const panels = _div('ov-dd-panels');

  const totalPanel = _buildTotalMovePanel('TOTAL EASES / HIKES - OUT', stats, 'outAbsMove', group.color, {
    mult: 100,
    posLabel: 'HIKES',
    negLabel: 'EASES',
  });
  if (totalPanel) panels.appendChild(totalPanel);
  panels.appendChild(_rankPanel('OUT MAX DELTA RANKING', stats, 'outDelta', group.color, 100, 5));
  panels.appendChild(_rankPanel('S1 MAX DELTA RANKING', stats, 's1Delta', '#a78bfa', 1));
  panels.appendChild(_rollRankPanel('S1 ROLL DN', stats, 's1RollDn', '#f87171'));
  panels.appendChild(_rollRankPanel('S1 ROLL UP', stats, 's1RollUp', '#34d399'));
  panels.appendChild(_metricRowsPanel('QUARTERLY PREMIUM', stats
    .filter(s => s.quarterlyPremium != null)
    .map(s => ({ mkt: s.mkt, contract: s.quarterlyPremiumContract, value: s.quarterlyPremium })),
    '#f0a828', 1));

  wrap.appendChild(panels);
  return wrap;
}

function _buildInterDeepDive(group, marketsData) {
  const stats = [];

  group.markets.forEach(mkt => {
    const chip = _chip(marketsData[mkt], 'Default');
    if (!chip) return;

    const s12Pts = _findStrat(chip, 'S12', mkt)?.points ?? [];
    const l12Pts = _findStrat(chip, 'L12', mkt)?.points ?? [];
    stats.push({
      mkt,
      s12Delta: _maxAbsDelta(s12Pts),
      l12Delta: _maxAbsDelta(l12Pts),
      s12RollDn: _bestRoll(s12Pts, 'down'),
      s12RollUp: _bestRoll(s12Pts, 'up'),
      l12RollDn: _bestRoll(l12Pts, 'down'),
      l12RollUp: _bestRoll(l12Pts, 'up'),
    });
  });

  if (!stats.length) return null;

  const wrap = _div('ov-dd ov-dd--inter');
  const panels = _div('ov-dd-panels');
  panels.appendChild(_rankPanel('S12 VS S12 Δ RANKING', stats, 's12Delta', '#a78bfa', 1));
  panels.appendChild(_rankPanel('L12 VS L12 Δ RANKING', stats, 'l12Delta', group.color, 1));
  panels.appendChild(_rollRankPanel('S12 VS S12 ROLL DN', stats, 's12RollDn', '#f87171'));
  panels.appendChild(_rollRankPanel('S12 VS S12 ROLL UP', stats, 's12RollUp', '#34d399'));
  panels.appendChild(_rollRankPanel('L12 VS L12 ROLL DN', stats, 'l12RollDn', '#f87171'));
  panels.appendChild(_rollRankPanel('L12 VS L12 ROLL UP', stats, 'l12RollUp', '#34d399'));

  wrap.appendChild(panels);
  return wrap;
}

function _buildShortEndDeepDive(group, marketsData) {
  const stats = _collectOutS1Stats(group, marketsData);
  if (!stats.length) return null;

  const wrap = _div('ov-dd ov-dd--short-end');
  const panels = _div('ov-dd-panels');

  const totalPanel = _buildTotalMovePanel('TOTAL S1+ MOVE', stats, 's1Total', group.color, {
    mult: 100,
    posLabel: 'UP',
    negLabel: 'DOWN',
  });
  if (totalPanel) panels.appendChild(totalPanel);

  panels.appendChild(_rankPanel('OUT DELTA RANKING', stats, 'outDelta', group.color, 100));
  panels.appendChild(_rankPanel('S1+ MAX DELTA RANKING', stats, 's1Delta', '#a78bfa', 1));
  panels.appendChild(_rollRankPanel('S1+ ROLL DN', stats, 's1RollDn', '#f87171'));
  panels.appendChild(_rollRankPanel('S1+ ROLL UP', stats, 's1RollUp', '#34d399'));

  const divergence = _buildOutDivergencePanel(group, marketsData);
  if (divergence) panels.appendChild(divergence);

  wrap.appendChild(panels);
  return wrap;
}

function _buildVolDeepDive(group, marketsData) {
  const stats = [];

  group.markets.forEach(mkt => {
    const chip = _chip(marketsData[mkt], 'Default');
    if (!chip) return;

    const outPts = _findStrat(chip, 'Out', mkt)?.points ?? [];
    const frontOut = outPts[0]?.live;
    if (frontOut != null && !isNaN(frontOut)) {
      stats.push({
        mkt,
        frontOutAbs: Math.abs(frontOut),
      });
    }
  });

  const wrap = _div('ov-dd ov-dd--vol');
  const panels = _div('ov-dd-panels');

  const frontOutPanel = _buildVolFrontOutPanel(stats, group.color);
  if (frontOutPanel) panels.appendChild(frontOutPanel);

  ['VIX', 'VOXX'].forEach((mkt, idx) => {
    const chip = _chip(marketsData[mkt], 'Default');
    const s1Pts = _findStrat(chip, 'S3', mkt)?.points ?? [];
    if (!s1Pts.length) return;

    const color = idx === 0 ? '#a78bfa' : group.color;
    panels.appendChild(_contractRankPanel(`${mkt} S1 MAX DELTA`, s1Pts, p => p?.delta, color, 1, false, 5));
    panels.appendChild(_contractRankPanel(`${mkt} S1 MAX ABS VALUE`, s1Pts, p => p?.live, color, 1, true, 5));
  });

  if (!panels.children.length) return null;
  wrap.appendChild(panels);
  return wrap;
}

function _buildOtherDeepDive(group, marketsData) {
  const mkt = group.markets[0];
  const chip = _chip(marketsData[mkt], 'Default');
  if (!chip) return null;

  const outPts = _findStrat(chip, 'Out', mkt)?.points ?? [];
  const s1Pts = _findStrat(chip, 'S3', mkt)?.points ?? [];
  if (!outPts.length && !s1Pts.length) return null;

  const wrap = _div('ov-dd ov-dd--other');
  const panels = _div('ov-dd-panels');

  panels.appendChild(_contractRollPanel('OUT ROLL DN RANKING', outPts, 'down', '#f87171', 5));
  panels.appendChild(_contractRollPanel('OUT ROLL UP RANKING', outPts, 'up', '#34d399', 5));
  panels.appendChild(_contractRankPanel('OUT MAX MOVE RANKING', outPts, p => p?.delta, group.color, 100, false, 5));
  panels.appendChild(_contractRankPanel('S1 ABS VALUE RANKING', s1Pts, p => p?.live, '#a78bfa', 1, true, 5));
  panels.appendChild(_nStepDiffPanel('OUT - OUT(N+2) ABS RANKING', outPts, 2, '#f0a828', 5));

  wrap.appendChild(panels);
  return wrap;
}

function _collectOutS1Stats(group, marketsData) {
  const stats = [];

  group.markets.forEach(mkt => {
    const chip = _chip(marketsData[mkt], 'Default');
    if (!chip) return;

    const outPts = _findStrat(chip, 'Out', mkt)?.points ?? [];
    const s1Pts = _findStrat(chip, 'S3', mkt)?.points ?? [];
    const qp = _quarterlyPremium(s1Pts);

    stats.push({
      mkt,
      outDelta: _maxAbsDelta(outPts),
      outAbsMove: _edgeAbsMove(outPts),
      s1Total: _sumDelta(s1Pts),
      s1Delta: _maxAbsDelta(s1Pts),
      s1RollDn: _bestRoll(s1Pts, 'down'),
      s1RollUp: _bestRoll(s1Pts, 'up'),
      quarterlyPremium: qp?.value ?? null,
      quarterlyPremiumContract: qp ? `${qp.from}->${qp.to}` : '',
    });
  });

  return stats;
}

function _buildVolFrontOutPanel(stats, color) {
  const sorted = [...(stats ?? [])]
    .filter(s => s.frontOutAbs != null && !isNaN(s.frontOutAbs))
    .sort((a, b) => b.frontOutAbs - a.frontOutAbs);
  if (!sorted.length) return null;

  const panel = _div('ov-dp ov-dp--wide ov-dp--impact ov-dp--meeting-total');
  panel.innerHTML = `<div class="ov-dp-title">FIRST OUT ABS VALUE</div>`;

  const body = _div('ov-total-rank');
  sorted.forEach((s, idx) => {
    const item = _div('ov-total-item neu');
    item.style.setProperty('--total-color', color);
    item.innerHTML = `
      <span class="ov-total-rankno">#${idx + 1}</span>
      <span class="ov-total-mkt">${s.mkt}</span>
      <span class="ov-total-val neu">${Math.abs(s.frontOutAbs) >= 10 ? _fd1(s.frontOutAbs) : _fd(s.frontOutAbs)}</span>
      <span class="ov-total-label">OUT</span>
    `;
    body.appendChild(item);
  });

  panel.appendChild(body);
  return panel;
}

function _buildTotalMovePanel(title, stats, key, color, opts = {}) {
  const mult = opts.mult ?? 1;
  const sorted = [...stats]
    .filter(s => s[key] != null)
    .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]));
  if (!sorted.length) return null;

  const panel = _div('ov-dp ov-dp--wide ov-dp--impact ov-dp--meeting-total');
  panel.innerHTML = `<div class="ov-dp-title">${title}</div>`;

  const body = _div('ov-total-rank');
  sorted.slice(0, 3).forEach((s, idx) => {
    const v = s[key] * mult;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
    const label = v > 0 ? (opts.posLabel ?? 'UP') : v < 0 ? (opts.negLabel ?? 'DOWN') : 'FLAT';
    const item = _div(`ov-total-item ${cls}`);
    item.style.setProperty('--total-color', color);
    item.innerHTML = `
      <span class="ov-total-rankno">#${idx + 1}</span>
      <span class="ov-total-mkt">${s.mkt}</span>
      <span class="ov-total-val ${cls}">${mult === 100 ? _fd1(v) : _fd(v)}</span>
      <span class="ov-total-label">${label}</span>
    `;
    body.appendChild(item);
  });

  panel.appendChild(body);
  return panel;
}

function _buildOutDivergencePanel(group, marketsData) {
  if (group.markets.length < 2) return null;

  const aMkt = group.markets[0], bMkt = group.markets[1];
  const aPts = _findStrat(_chip(marketsData[aMkt], 'Default'), 'Out', aMkt)?.points ?? [];
  const bPts = _findStrat(_chip(marketsData[bMkt], 'Default'), 'Out', bMkt)?.points ?? [];
  const len = Math.min(aPts.length, bPts.length);
  if (!len) return null;

  const rows = [];
  for (let i = 0; i < len; i++) {
    const a = aPts[i]?.live, b = bPts[i]?.live;
    if (a == null || b == null || isNaN(a) || isNaN(b)) continue;
    rows.push({
      mkt: aPts[i]?.label ?? bPts[i]?.label ?? `#${i + 1}`,
      contract: `${aMkt}-${bMkt}`,
      value: (a - b) * 100,
    });
  }

  return _metricRowsPanel('MAXIMUM DIVERGENCE', rows, '#f0a828', 1, 5);
}

function _rankPanel(title, stats, key, color, mult = 1, limit = Infinity) {
  const panel = _div('ov-dp');
  panel.innerHTML = `<div class="ov-dp-title">${title}</div>`;
  const body = _div('ov-dp-body');

  const sorted = [...stats]
    .filter(s => s[key] != null)
    .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]));
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s[key])), 0.001);

  sorted.slice(0, limit).forEach(s => {
    const raw = s[key];
    const v = raw * mult;
    const pct = Math.min(100, (Math.abs(raw) / maxAbs) * 100);
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
    const barColor = v > 0 ? 'var(--col-pos)' : 'var(--col-neg)';
    const row = _div('ov-dp-row');
    row.innerHTML = `
      <span class="ov-dp-mkt">${s.mkt}</span>
      <div class="ov-dp-barwrap">
        <div class="ov-dp-bar" style="width:${pct.toFixed(1)}%;background:${barColor};opacity:0.45"></div>
      </div>
      <span class="ov-dp-val ${cls}">${mult === 100 ? _fd1(v) : _fd(v)}</span>
    `;
    body.appendChild(row);
  });

  panel.appendChild(body);
  return panel;
}

function _rollRankPanel(title, stats, key, color) {
  const panel = _div('ov-dp ov-dp--roll');
  panel.innerHTML = `<div class="ov-dp-title">${title}</div>`;
  const body = _div('ov-dp-body');

  const sorted = [...stats]
    .filter(s => s[key]?.value != null)
    .sort((a, b) => Math.abs(b[key].value) - Math.abs(a[key].value));
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s[key].value)), 0.001);

  sorted.forEach(s => {
    const roll = s[key];
    const v = roll.value;
    const pct = Math.min(100, (Math.abs(v) / maxAbs) * 100);
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
    const row = _div('ov-dp-row ov-dp-row--roll');
    row.innerHTML = `
      <span class="ov-dp-mkt">${s.mkt}</span>
      <span class="ov-dp-contract">${roll.from}→${roll.to}</span>
      <div class="ov-dp-barwrap">
        <div class="ov-dp-bar" style="width:${pct.toFixed(1)}%;background:${color};opacity:0.62"></div>
      </div>
      <span class="ov-dp-val ${cls}">${_fd(v)}</span>
    `;
    body.appendChild(row);
  });

  panel.appendChild(body);
  return panel;
}

function _buildSimilarityPanel(stats, arrKey, title = 'CURVE SIMILARITY') {
  const mkts = stats.filter(s => Array.isArray(s[arrKey]) && s[arrKey].length >= 2);
  if (mkts.length < 2) return null;

  const pairs = [];

  for (let i = 0; i < mkts.length; i++) {
    for (let j = i + 1; j < mkts.length; j++) {
      const a = mkts[i][arrKey], b = mkts[j][arrKey];
      const len = Math.min(a.length, b.length);
      if (len < 2) continue;
      const r = _pearson(a.slice(0, len), b.slice(0, len));
      pairs.push([mkts[i].mkt, mkts[j].mkt, r]);
    }
  }

  const topPairs = pairs.sort((a, b) => b[2] - a[2]).slice(0, 2);
  if (!topPairs.length) return null;

  const panel = _div('ov-dp ov-dp--sim');
  const mostSim = topPairs[0] ?? null, mostDiff = topPairs[1] ?? null;
  panel.innerHTML = `
    <div class="ov-dp-title">${title}</div>
    ${mostSim  ? `<div class="ov-sim-row"><span class="ov-sim-lbl">MOST SIMILAR</span><span class="ov-sim-pair pos">${mostSim[0]} ↔ ${mostSim[1]}</span><span class="ov-sim-rho">ρ ${mostSim[2].toFixed(2)}</span></div>` : ''}
    ${mostDiff ? `<div class="ov-sim-row"><span class="ov-sim-lbl">MOST SIMILAR</span><span class="ov-sim-pair neg">${mostDiff[0]} ↔ ${mostDiff[1]}</span><span class="ov-sim-rho">ρ ${mostDiff[2].toFixed(2)}</span></div>` : ''}
  `;
  return panel;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function _contractRankPanel(title, points, valueFn, color, mult = 1, absOnly = false, limit = 8) {
  const rows = (points ?? [])
    .map((p, idx) => {
      const raw = valueFn(p, idx, points);
      if (raw == null || isNaN(raw)) return null;
      return {
        mkt: p?.label ?? `#${idx + 1}`,
        value: absOnly ? Math.abs(raw) : raw * mult,
      };
    })
    .filter(Boolean);

  return _metricRowsPanel(title, rows, color, 1, limit);
}

function _contractRollPanel(title, points, direction, color, limit = 8) {
  const rows = [];
  const pts = points ?? [];

  for (let i = 0; i < pts.length - 1; i++) {
    const cur = pts[i]?.live;
    const next = pts[i + 1]?.live;
    if (cur == null || next == null || isNaN(cur) || isNaN(next)) continue;

    const curLabel = pts[i]?.label ?? `#${i + 1}`;
    const nextLabel = pts[i + 1]?.label ?? `#${i + 2}`;
    const from = direction === 'down' ? nextLabel : curLabel;
    const to = direction === 'down' ? curLabel : nextLabel;

    rows.push({
      mkt: `${from}->${to}`,
      value: Math.abs(next - cur),
    });
  }

  return _metricRowsPanel(title, rows, color, 1, limit);
}

function _nStepDiffPanel(title, points, step, color, limit = 8) {
  const rows = [];
  const pts = points ?? [];

  for (let i = 0; i < pts.length - step; i++) {
    const cur = pts[i]?.live;
    const next = pts[i + step]?.live;
    if (cur == null || next == null || isNaN(cur) || isNaN(next)) continue;

    rows.push({
      mkt: `${pts[i]?.label ?? `#${i + 1}`}->${pts[i + step]?.label ?? `#${i + step + 1}`}`,
      value: Math.abs(cur - next),
    });
  }

  return _metricRowsPanel(title, rows, color, 1, limit);
}

function _metricRowsPanel(title, rows, color, mult = 1, limit = 8) {
  const panel = _div('ov-dp');
  panel.innerHTML = `<div class="ov-dp-title">${title}</div>`;
  const body = _div('ov-dp-body');

  const sorted = [...(rows ?? [])]
    .filter(r => r.value != null && !isNaN(r.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
  const maxAbs = Math.max(...sorted.map(r => Math.abs(r.value)), 0.001);

  sorted.forEach(r => {
    const v = r.value * mult;
    const pct = Math.min(100, (Math.abs(r.value) / maxAbs) * 100);
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
    const row = _div('ov-dp-row ov-dp-row--roll');
    row.innerHTML = `
      <span class="ov-dp-mkt">${r.mkt}</span>
      ${r.contract ? `<span class="ov-dp-contract">${r.contract}</span>` : ''}
      <div class="ov-dp-barwrap">
        <div class="ov-dp-bar" style="width:${pct.toFixed(1)}%;background:${color};opacity:0.62"></div>
      </div>
      <span class="ov-dp-val ${cls}">${Math.abs(v) >= 10 ? _fd1(v) : _fd(v)}</span>
    `;
    body.appendChild(row);
  });

  if (!sorted.length) {
    const row = _div('ov-dp-row');
    row.innerHTML = `<span class="ov-dp-mkt">-</span><span class="ov-dp-val neu">-</span>`;
    body.appendChild(row);
  }

  panel.appendChild(body);
  return panel;
}

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

function _avgDelta(points) {
  const vals = (points ?? [])
    .map(p => p?.delta)
    .filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function _sumDelta(points) {
  const vals = (points ?? [])
    .map(p => p?.delta)
    .filter(v => v != null && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0);
}

function _edgeAbsMove(points) {
  const vals = (points ?? [])
    .map(p => p?.live)
    .filter(v => v != null && !isNaN(v));
  if (vals.length < 2) return null;
  return Math.abs(vals[0]) - Math.abs(vals[vals.length - 1]);
}

function _maxAbsDelta(points) {
  let best = null;
  let bestAbs = -Infinity;
  (points ?? []).forEach(p => {
    const v = p?.delta;
    if (v == null || isNaN(v)) return;
    const abs = Math.abs(v);
    if (abs > bestAbs) {
      best = v;
      bestAbs = abs;
    }
  });
  return best;
}

function _quarterlyPremium(points) {
  let best = null;
  let bestAbs = -Infinity;
  const pts = points ?? [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const live = p?.live;
    if (live == null || isNaN(live) || !_isQuarterlyContract(p?.label)) continue;

    const neighbors = [pts[i - 1], pts[i + 1]].filter(Boolean);
    neighbors.forEach(n => {
      const nv = n?.live;
      if (nv == null || isNaN(nv)) return;
      const diff = live - nv;
      const abs = Math.abs(diff);
      if (abs > bestAbs) {
        bestAbs = abs;
        best = {
          value: diff,
          from: p?.label ?? `#${i + 1}`,
          to: n?.label ?? '',
        };
      }
    });
  }

  return best;
}

function _isQuarterlyContract(label) {
  const s = String(label ?? '').toUpperCase();
  if (!s) return false;
  if (/(MAR|JUN|SEP|DEC)/.test(s)) return true;
  return /(^|[^A-Z])(H|M|U|Z)\d/.test(s);
}

function _bestRoll(points, direction) {
  let best = null;
  let bestAbs = -Infinity;
  const pts = points ?? [];

  for (let i = 0; i < pts.length - 1; i++) {
    const near = pts[i];
    const far = pts[i + 1];
    
    const curVal = near?.live;
    const nextVal = far?.live;

    if (curVal == null || nextVal == null || isNaN(curVal) || isNaN(nextVal)) continue;

    const diff = nextVal - curVal;

    // Guard clauses for direction
    if (direction === 'up' && diff <= 0) continue;
    if (direction === 'down' && diff >= 0) continue;

    const abs = Math.abs(diff);
    if (abs > bestAbs) {
      bestAbs = abs;
      
      // If 'down', we swap 'from' and 'to' to show the decay from Far to Near
      const isDown = direction === 'down';
      
      best = {
        value: abs,
        from: isDown ? (far.label ?? `#${i + 2}`) : (near.label ?? `#${i + 1}`),
        to: isDown ? (near.label ?? `#${i + 1}`) : (far.label ?? `#${i + 2}`)
      };
    }
  }
  return best;
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
