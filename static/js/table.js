/**
 * static/js/table.js - Institutional signal engine sidebar
 * Replaces the old right-hand table section with live-vs-settle curve analytics.
 */

import STATE from './state.js';
import { fmtPrice, fmtDelta, deltaClass } from './utils.js';

const sectionEl = document.getElementById('tableSection');
const wrapEl = document.querySelector('.ratio-table-wrap');
const RESIZER_KEY = 'rtd.signalPanelWidth';
const MIN_PANEL_W = 280;
const MAX_PANEL_W = 640;

_initResizer();

STATE.on('activeMarket', () => buildTable());
STATE.on('activeChip', () => updateTable());
STATE.on('marketsData', () => updateTable());
STATE.on('curveLens', () => updateTable());
STATE.on('curveSkip', () => updateTable());
STATE.on('highlightedStrategy', () => updateTable());

export function buildTable() {
  updateTable();
}

export function updateTable() {
  if (!wrapEl) return;

  const market = STATE.get('activeMarket');
  const marketsData = STATE.get('marketsData') || {};
  const marketData = marketsData[market];

  const label = sectionEl?.querySelector('.section-label');
  if (label) label.textContent = `${market || 'MARKET'} SIGNAL ENGINE`;

  if (!marketData) {
    wrapEl.innerHTML = '<div class="sig-empty">NO MARKET DATA</div>';
    return;
  }

  const model = _buildSignalModel(market, marketData);
  wrapEl.innerHTML = _renderEngine(model);
  _bindTradeCards();
}

function _buildSignalModel(market, marketData) {
  const outrights = _windowPoints(_contractsToPoints(marketData.contracts || []), market);
  const strategies = _collectStrategies(marketData, market);
  const stats = _curveStats(outrights);
  const regime = _detectCurveRegime(stats);
  const risk = _detectRiskRegime(stats);
  const structures = _detectStructures(stats, outrights);
  const stress = _stressGauge(stats);
  const trades = _scoreTrades(strategies, stats, regime, risk).slice(0, 10);

  return {
    market,
    outrights,
    strategies,
    stats,
    regime,
    risk,
    structures,
    stress,
    trades,
    state: _marketState(stats, regime, risk, structures, stress, trades),
  };
}

function _initResizer() {
  if (!sectionEl || sectionEl.dataset.resizerReady === '1') return;
  sectionEl.dataset.resizerReady = '1';

  const savedWidth = _num(localStorage.getItem(RESIZER_KEY));
  if (savedWidth) sectionEl.style.width = `${_clampPanelWidth(savedWidth)}px`;

  const handle = document.createElement('div');
  handle.className = 'table-resizer';
  handle.title = 'Drag to resize signal panel';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  sectionEl.parentNode?.insertBefore(handle, sectionEl);

  let startX = 0;
  let startW = 0;

  handle.addEventListener('pointerdown', event => {
    startX = event.clientX;
    startW = sectionEl.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-table');
  });

  handle.addEventListener('pointermove', event => {
    if (!document.body.classList.contains('resizing-table')) return;
    const next = _clampPanelWidth(startW - (event.clientX - startX));
    sectionEl.style.width = `${next}px`;
  });

  const finish = event => {
    if (!document.body.classList.contains('resizing-table')) return;
    document.body.classList.remove('resizing-table');
    try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
    localStorage.setItem(RESIZER_KEY, String(Math.round(sectionEl.getBoundingClientRect().width)));
  };

  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

function _contractsToPoints(contracts) {
  return contracts.map(c => ({
    label: c.name,
    live: _num(c.live),
    settle: _num(c.settle),
    delta: _num(c.delta ?? (c.live != null && c.settle != null ? c.live - c.settle : null)),
    kind: 'OUT',
  }));
}

function _collectStrategies(marketData, market) {
  const seen = new Map();
  (marketData.chips || []).forEach(chip => {
    (chip.strategies || []).forEach(s => {
      if (!s?.points?.length) return;
      const key = `${s.group || ''}|${s.name}`;
      const existing = seen.get(key);
      const item = {
        ...s,
        group: s.group || chip.chip || 'RV',
        chipName: chip.chip || 'Default',
        displayName: _displayName(s.name, market),
        points: _windowPoints(s.points, market),
      };
      if (!existing || item.points.length > existing.points.length) seen.set(key, item);
    });
  });
  return Array.from(seen.values()).filter(s => s.points.length);
}

function _windowPoints(points, market) {
  const skip = Math.max(0, Number((STATE.get('curveSkip') || {})[market] || 0));
  const lens = Number((STATE.get('curveLens') || {})[market] || 0);
  const sliced = skip > 0 ? points.slice(skip) : points.slice();
  return lens > 0 ? sliced.slice(0, lens) : sliced;
}

function _curveStats(outrights) {
  const deltas = outrights.map(p => _num(p.delta)).filter(v => v != null);
  const n = deltas.length;
  const thirds = _thirds(deltas);
  const frontAvg = _avg(thirds.front);
  const bellyAvg = _avg(thirds.belly);
  const backAvg = _avg(thirds.back);
  const avgDelta = _avg(deltas);
  const dispersion = _std(deltas);
  const slopeChange = (backAvg ?? 0) - (frontAvg ?? 0);
  const convexity = (bellyAvg ?? 0) - (((frontAvg ?? 0) + (backAvg ?? 0)) / 2);
  const local = _localDislocations(outrights, dispersion);

  return {
    n,
    deltas,
    frontAvg,
    bellyAvg,
    backAvg,
    avgDelta,
    dispersion,
    slopeChange,
    convexity,
    local,
    strongest: [...outrights].filter(p => p.delta != null)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null,
  };
}

function _detectCurveRegime(s) {
  if (s.n < 3) return { label: 'Insufficient Strip', tone: 'neu', detail: 'Need more outrights' };
  const mag = Math.max(0.01, s.dispersion * 0.55);
  const avgAbs = Math.abs(s.avgDelta || 0);
  const slopeAbs = Math.abs(s.slopeChange || 0);
  const convAbs = Math.abs(s.convexity || 0);

  if (s.frontAvg * s.backAvg < 0 && slopeAbs > mag) {
    return { label: 'Twist', tone: s.slopeChange > 0 ? 'pos' : 'neg', detail: 'Front/back moving opposite' };
  }
  if (convAbs > Math.max(mag, avgAbs * 0.75) && convAbs >= slopeAbs * 0.75) {
    return { label: 'Belly-led Repricing', tone: s.convexity > 0 ? 'pos' : 'neg', detail: 'Belly dominates curve move' };
  }
  if (s.avgDelta > mag && s.slopeChange > mag * 0.75) {
    return { label: 'Bull Steepener', tone: 'pos', detail: 'Front rallies vs back' };
  }
  if (s.avgDelta < -mag && s.slopeChange < -mag * 0.75) {
    return { label: 'Bear Flattener', tone: 'neg', detail: 'Front sells off vs back' };
  }
  if (avgAbs > mag && slopeAbs < mag * 0.65 && convAbs < mag * 0.65) {
    return { label: 'Parallel Shift', tone: s.avgDelta > 0 ? 'pos' : 'neg', detail: 'Low shape change' };
  }
  return { label: 'Mixed Curve', tone: 'neu', detail: 'No clean dominant regime' };
}

function _detectRiskRegime(s) {
  let off = 0;
  let on = 0;
  if ((s.frontAvg || 0) > 0) off += 2;
  if ((s.slopeChange || 0) > 0) off += 1.5;
  if ((s.convexity || 0) > 0) off += 1;
  if ((s.dispersion || 0) > Math.max(0.015, Math.abs(s.avgDelta || 0) * 0.8)) off += 1;
  if ((s.frontAvg || 0) < 0) on += 2;
  if ((s.slopeChange || 0) < 0) on += 1.2;
  if ((s.backAvg || 0) > 0) on += 1;
  if (off >= on + 1) return { label: 'Risk-Off', tone: 'pos', score: off };
  if (on >= off + 1) return { label: 'Risk-On', tone: 'neg', score: on };
  return { label: 'Neutral', tone: 'neu', score: Math.max(off, on) };
}

function _detectStructures(s, outrights) {
  const items = [];
  const z = _zScore(s.convexity, s.dispersion);
  if (z > 0.75) items.push({ label: 'Belly Rich', tone: 'pos', value: s.convexity });
  if (z < -0.75) items.push({ label: 'Belly Cheap', tone: 'neg', value: s.convexity });
  if (Math.abs(s.frontAvg || 0) > Math.max(0.015, s.dispersion * 0.9)) items.push({ label: 'Front-End Stress', tone: s.frontAvg > 0 ? 'pos' : 'neg', value: s.frontAvg });
  const wing = (((s.frontAvg || 0) + (s.backAvg || 0)) / 2) - (s.bellyAvg || 0);
  if (Math.abs(wing) > Math.max(0.01, s.dispersion * 0.6)) items.push({ label: 'Wing Cheap', tone: wing > 0 ? 'pos' : 'neg', value: wing });
  if (s.dispersion < Math.max(0.006, Math.abs(s.avgDelta || 0) * 0.25)) items.push({ label: 'Curve Compression', tone: 'neu', value: s.dispersion });
  if (s.dispersion > Math.max(0.02, Math.abs(s.avgDelta || 0) * 0.9)) items.push({ label: 'Curve Dispersion', tone: 'neg', value: s.dispersion });
  s.local.slice(0, 2).forEach(x => items.push({ label: `Local ${x.label}`, tone: x.delta > 0 ? 'pos' : 'neg', value: x.delta }));
  return items.length ? items : [{ label: 'Clean Curve', tone: 'neu', value: s.avgDelta }];
}

function _stressGauge(s) {
  const d = Math.abs(s.dispersion || 0);
  const local = s.local.length;
  if (d >= 0.06 || local >= 4) return { label: 'Event Repricing', tone: 'neg', pct: 100 };
  if (d >= 0.035 || local >= 3) return { label: 'High Stress', tone: 'neg', pct: 78 };
  if (d >= 0.015 || local >= 1) return { label: 'Moderate Stress', tone: 'neu', pct: 48 };
  return { label: 'Low Stress', tone: 'pos', pct: 18 };
}

function _scoreTrades(strategies, stats, regime, risk) {
  const candidates = [];
  strategies.forEach(s => {
    const pts = (s.points || []).filter(p => p.delta != null && p.live != null && p.settle != null);
    if (!pts.length) return;
    const deltas = pts.map(p => p.delta);
    const strongest = [...pts].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const roll = _rollValue(pts);
    const move = Math.abs(strongest.delta);
    const dispersionQuality = _std(deltas);
    const convexity = _strategyConvexity(pts);
    const rollDown = Math.max(roll, 0);
    const rollUp = Math.max(-roll, 0);
    const riskReward = _riskReward(move, rollDown, rollUp, dispersionQuality);
    const carryQuality = rollDown > 0 ? 1 : rollUp > 0 ? -0.6 : 0;
    const clean = Math.max(0, 1 - (dispersionQuality / Math.max(0.02, Math.abs(_avg(deltas) || 0) * 1.7)));
    const align = _alignmentScore(strongest.delta, stats, regime, risk, s);
    const score = (
      move * 42 +
      rollDown * 20 +
      align * 16 +
      clean * 14 +
      Math.abs(convexity) * 8 +
      carryQuality * 7 -
      rollUp * 18 +
      Math.min(8, riskReward)
    );
    if (score <= 0) return;
    candidates.push({
      name: _tradeName(s, strongest),
      direction: _tradeDirection(strongest.delta),
      strategyName: s.name,
      chipName: s.chipName || 'Default',
      strategy: s.displayName || s.name,
      pointLabel: strongest.label,
      group: _groupLabel(s),
      live: strongest.live,
      settle: strongest.settle,
      delta: strongest.delta,
      roll,
      rollDown,
      rollUp,
      riskReward,
      score,
      alignment: align > 0.7 ? regime.label : risk.label,
      rationale: _rationale(s, strongest, roll, align, clean, stats),
    });
  });
  return candidates.sort((a, b) => b.score - a.score);
}

function _renderEngine(m) {
  return `
    <div class="sig-engine">
      <section class="sig-panel">
        <div class="sig-panel-h">MARKET STATE</div>
        <div class="sig-state-grid">
          ${m.state.map(x => `<div class="sig-row ${x.em ? 'sig-row--em' : ''}"><span>${x.k}</span><b class="${x.tone || 'neu'}">${x.v}</b></div>`).join('')}
        </div>
        <div class="sig-gauge"><i style="width:${m.stress.pct}%"></i></div>
      </section>

      <section class="sig-panel">
        <div class="sig-panel-h">TOP 10 TRADE SIGNALS</div>
        <div class="sig-trades">
          ${m.trades.length ? m.trades.map(_renderTrade).join('') : '<div class="sig-empty">NO CLEAN RV SIGNAL</div>'}
        </div>
      </section>

    </div>
  `;
}

function _renderTrade(t, i) {
  return `
    <article class="sig-trade" data-strategy="${_escAttr(t.strategyName)}" data-chip="${_escAttr(t.chipName)}" tabindex="0" role="button" aria-label="Open ${_escAttr(t.strategy)} chart">
      <div class="trade-head">
        <b class="trade-dir">${t.direction}</b>
        <div class="trade-name">${t.name}</div>
      </div>
      <div class="trade-metrics trade-metrics--pricing">
        <span>L: ${_fmtPlain(t.live)}</span>
        <span>S: ${_fmtPlain(t.settle)}</span>
        <span class="${deltaClass(t.delta)}">&Delta;: ${fmtDelta(t.delta, 1)}</span>
      </div>
      <div class="trade-metrics">
        <span class="${deltaClass(t.rollDown)}">RD: ${fmtDelta(t.rollDown, 1)}</span>
        <span>RU: ${_fmtRollUp(t.rollUp)}</span>
        <span class="${_rrClass(t.riskReward)}">R/R: ${_fmtRatio(t.riskReward)}</span>
      </div>
      <div class="trade-why">${t.rationale}</div>
    </article>
  `;
}

function _bindTradeCards() {
  wrapEl.querySelectorAll('.sig-trade[data-strategy]').forEach(card => {
    const strategyName = card.dataset.strategy;
    const chipName = card.dataset.chip || 'Default';
    card.addEventListener('mouseenter', () => STATE.set('highlightedStrategy', strategyName));
    card.addEventListener('mouseleave', () => STATE.set('highlightedStrategy', null));
    card.addEventListener('click', () => _openFocus(strategyName, chipName));
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      _openFocus(strategyName, chipName);
    });
  });
}

function _openFocus(strategyName, chipName) {
  if (!strategyName) return;
  const market = STATE.get('activeMarket');
  if (market && chipName) {
    const activeChip = { ...(STATE.get('activeChip') || {}) };
    activeChip[market] = chipName;
    STATE.set('activeChip', activeChip);
  }
  import('./focus.js').then(m => m.openFocus(strategyName));
}

function _marketState(stats, regime, risk, structures, stress, trades) {
  return [
    { k: 'Curve', v: _curveDisplay(regime), tone: regime.tone, em: true },
    { k: 'Risk', v: risk.label, tone: risk.tone },
    { k: 'Structure', v: _structureBehavior(stats), tone: _structureTone(stats), em: true },
    { k: 'Stress', v: _stressDisplay(stress), tone: stress.tone },
    { k: 'Best RV', v: _bestRvZone(trades[0], stats), tone: trades[0] ? 'pos' : 'neu', em: true },
  ];
}

function _thirds(arr) {
  const n = arr.length;
  const a = Math.max(1, Math.ceil(n / 3));
  const b = Math.max(a + 1, Math.ceil((n * 2) / 3));
  return { front: arr.slice(0, a), belly: arr.slice(a, b), back: arr.slice(b) };
}

function _localDislocations(points, dispersion) {
  const ds = points.map(p => p.delta);
  const threshold = Math.max(0.012, dispersion * 1.15);
  const out = [];
  for (let i = 1; i < ds.length - 1; i += 1) {
    if (ds[i] == null || ds[i - 1] == null || ds[i + 1] == null) continue;
    const local = ds[i] - ((ds[i - 1] + ds[i + 1]) / 2);
    if (Math.abs(local) >= threshold) out.push({ label: points[i].label, delta: local });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function _rollValue(points) {
  if (points.length < 2 || points[0].live == null || points[1].live == null) return 0;
  return points[0].live - points[1].live;
}

function _riskReward(move, rollDown, rollUp, noise) {
  const reward = Math.max(0.0001, move + rollDown);
  const risk = Math.max(0.0001, rollUp + noise);
  return reward / risk;
}

function _strategyConvexity(points) {
  if (points.length < 3) return 0;
  const front = points[0].delta ?? 0;
  const mid = points[Math.floor(points.length / 2)].delta ?? 0;
  const back = points[points.length - 1].delta ?? 0;
  return mid - ((front + back) / 2);
}

function _alignmentScore(delta, stats, regime, risk, strategy) {
  let score = 0.35;
  if (Math.sign(delta) === Math.sign(stats.avgDelta || 0)) score += 0.18;
  if (regime.label.includes('Belly') && /fly|l3|s1/i.test(strategy.name)) score += 0.25;
  if (regime.label.includes('Steepener') && /spread|s\d+/i.test(strategy.group + strategy.name)) score += 0.2;
  if (risk.label === 'Risk-Off' && delta > 0) score += 0.15;
  if (risk.label === 'Risk-On' && delta < 0) score += 0.12;
  return Math.min(1, score);
}

function _rationale(strategy, point, roll, align, clean, stats) {
  const sector = _dominantSector(stats);
  const action = (point.delta ?? 0) < 0 ? 'selloff' : 'rally';
  const drift = sector === 'Back' ? 'long-end' : sector.toLowerCase();
  if (/fly|l\d/i.test(strategy.name || strategy.group || '')) {
    return `${_cap(drift)} ${action} extending through fly sector`;
  }
  if (/spread|s\d/i.test(strategy.name || strategy.group || '')) {
    return `${_cap(drift)} ${action} driving spread curve`;
  }
  if (roll > 0) return `${_cap(drift)} ${action} with roll-down support`;
  return `${_cap(drift)} ${action} creating RV dislocation`;
}

function _tradeName(strategy, point) {
  return `${point.label} ${strategy.displayName || strategy.name}`;
}

function _tradeDirection(delta) {
  return delta > 0 ? 'FADE' : 'RECEIVE';
}

function _curveDisplay(regime) {
  if (['Bear Flattener', 'Bull Steepener', 'Parallel Shift', 'Twist'].includes(regime.label)) return regime.label;
  if (regime.label === 'Belly-led Repricing') return 'Parallel Shift';
  return 'Parallel Shift';
}

function _dominantSector(stats) {
  const sectors = [
    ['Front', Math.abs(stats.frontAvg || 0)],
    ['Belly', Math.abs(stats.bellyAvg || 0)],
    ['Back', Math.abs(stats.backAvg || 0)],
  ];
  return sectors.sort((a, b) => b[1] - a[1])[0]?.[0] || 'Mixed';
}

function _structureBehavior(stats) {
  const sector = _dominantSector(stats);
  const val = sector === 'Front' ? stats.frontAvg : sector === 'Belly' ? stats.bellyAvg : stats.backAvg;
  const move = (val ?? 0) < 0 ? 'Selloff' : 'Rally';
  if (sector === 'Back') return `Back-End Leading ${move}`;
  return `${sector} Leading ${move}`;
}

function _structureTone(stats) {
  const sector = _dominantSector(stats);
  const val = sector === 'Front' ? stats.frontAvg : sector === 'Belly' ? stats.bellyAvg : stats.backAvg;
  return deltaClass(val);
}

function _stressDisplay(stress) {
  if (stress.label.includes('Low')) return 'Low';
  if (stress.label.includes('Moderate')) return 'Moderate';
  return 'High';
}

function _bestRvZone(trade, stats) {
  if (!trade) return `${_dominantSector(stats)} Curve`;
  const name = String(trade.strategy || trade.strategyName || '');
  const group = String(trade.group || '');
  if (/L6/i.test(name)) return 'L6 Flys';
  if (/L3/i.test(name)) return 'L3 Flys';
  if (/fly/i.test(name) || /FLY/i.test(group)) {
    const sector = _dominantSector(stats);
    return sector === 'Back' ? 'Long-End Flys' : `${sector} Flies`;
  }
  if (/spread/i.test(group) || /^S\d/i.test(name)) {
    const sector = _dominantSector(stats);
    return sector === 'Back' ? 'Long-End Curve' : `${sector} Spreads`;
  }
  return group && group !== 'RV' ? group : `${_dominantSector(stats)} Curve`;
}

function _groupLabel(s) {
  const g = String(s.group || '').toUpperCase();
  const n = String(s.name || '').toUpperCase();
  if (g.includes('FLY') || n.includes('FLY') || /^L\d/.test(n)) return 'FLY';
  if (g.includes('SPREAD') || /^S\d/.test(n)) return 'SPREAD';
  if (n.includes('L3')) return 'L3';
  if (n.includes('S1')) return 'S1';
  return g || 'RV';
}

function _displayName(name, market) {
  if (typeof name !== 'string') return name;
  const oneMonth = new Set(['EMP', 'MPC', 'SR1', 'ZQ', 'VIX', 'VOXX', 'SZI0']);
  if (!oneMonth.has(market)) return name;
  return name.replace(/([SLDW])(\d+)/g, (_, prefix, num) => prefix + Math.max(1, Math.round(parseInt(num, 10) / 3)));
}

function _fmtRatio(v) {
  if (v == null || !Number.isFinite(v)) return '--';
  if (v > 99) return '>99';
  return `${v.toFixed(1)}x`;
}

function _fmtPlain(v) {
  if (v == null || !Number.isFinite(v)) return '--';
  return v.toFixed(1);
}

function _fmtRollUp(v) {
  if (v == null || !Number.isFinite(v)) return '--';
  return `${v > 0 ? '-' : ''}${v.toFixed(1)}`;
}

function _rrClass(v) {
  if (v == null || !Number.isFinite(v)) return 'neu';
  if (v >= 2.5) return 'pos';
  if (v < 1) return 'neg';
  return 'neu';
}

function _cap(s) {
  s = String(s || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function _escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _clampPanelWidth(width) {
  const maxByViewport = Math.max(MIN_PANEL_W, Math.min(MAX_PANEL_W, Math.round(window.innerWidth * 0.55)));
  return Math.min(maxByViewport, Math.max(MIN_PANEL_W, Math.round(width)));
}

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _avg(arr) {
  const vals = arr.filter(v => v != null && Number.isFinite(v));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function _std(arr) {
  const vals = arr.filter(v => v != null && Number.isFinite(v));
  if (vals.length < 2) return 0;
  const avg = _avg(vals);
  return Math.sqrt(_avg(vals.map(v => (v - avg) ** 2)));
}

function _zScore(v, dispersion) {
  return (v || 0) / Math.max(0.0001, dispersion || 0);
}
