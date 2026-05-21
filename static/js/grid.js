/**
 * static/js/grid.js — Strategy Card Grid (Drag & Drop)
 * ======================================================
 * Renders one card per strategy in the active chip.
 * Grid is 3 columns; rows stretch to fill the full remaining height.
 * Each card's SVG mini-chart grows to fill available card height.
 */

import STATE from './state.js';
import { saveCardOrder } from './api.js';
import { renderMiniChart } from './chart.js';
import { fmtDelta, getActiveStrategies, modePoints } from './utils.js';

const gridEl = document.getElementById('gridContainer');
let _dragSrcName = null;

STATE.on('activeMarket',        () => buildGrid());
STATE.on('activeChip',          () => buildGrid());
STATE.on('marketsData',         () => updateGrid());
STATE.on('viewMode',            () => updateGrid());
STATE.on('showChartLabels',     () => updateGrid());
STATE.on('curveLens',           () => buildGrid());
STATE.on('curveSkip',           () => buildGrid());
STATE.on('highlightedStrategy', n  => _applyHighlight(n));


// ── Public API ────────────────────────────────────────────────────────────────

export function buildGrid() {
  if (!gridEl) return;
  gridEl.innerHTML = '';

  const strategies = _currentStrategies();
  const ordered = _orderedStrategies(strategies);
  _applyGridTopology(ordered);
  ordered.forEach(s => _createCard(s));
}

export function updateGrid() {
  if (!gridEl) return;

  const mode       = STATE.get('viewMode');
  const strategies = _currentStrategies();
  const ordered    = _orderedStrategies(strategies);
  const cardMap    = _cardMap();
  _applyGridTopology(ordered);

  ordered.forEach(s => {
    if (cardMap.has(s.name)) {
      _updateCard(cardMap.get(s.name), s, mode);
    } else {
      _createCard(s);
    }
  });

  const feedNames = new Set(strategies.map(s => s.name));
  cardMap.forEach((el, name) => { if (!feedNames.has(name)) el.remove(); });
}


// ── Card creation ─────────────────────────────────────────────────────────────

function _createCard(strategy) {
  const mode = STATE.get('viewMode');

  const card = document.createElement('div');
  card.className    = `strategy-card ${_cardTopologyClass(strategy.name)}`;
  card.dataset.name = strategy.name;
  card.draggable    = true;

  // ── Header ────────────────────────────────────────────────────────────────
  const header   = document.createElement('div');
  header.className = 'card-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.textContent = strategy.name;

  header.appendChild(nameEl);

  // ── SVG mini-chart — flex: 1 1 0 in CSS means it fills remaining height ──
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'card-chart');
  // viewBox will be set by renderMiniChart; use preserveAspectRatio=none
  // so the SVG stretches to fill the CSS-sized box
  svg.setAttribute('preserveAspectRatio', 'none');
  renderMiniChart(svg, strategy, mode);
  svg.dataset.mode = mode;
  svg.dataset.labels = STATE.get('showChartLabels') ? '1' : '0';

  const pill = document.createElement('div');
  pill.className = 'card-topology-pill';

  const metrics = document.createElement('div');
  metrics.className = 'card-metric-strip';

  //card.appendChild(header);
  card.appendChild(svg);
  card.appendChild(pill);
  card.appendChild(metrics);

  _updateCard(card, strategy, mode);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  card.addEventListener('dragstart',  _onDragStart);
  card.addEventListener('dragover',   _onDragOver);
  card.addEventListener('dragleave',  _onDragLeave);
  card.addEventListener('drop',       _onDrop);
  card.addEventListener('dragend',    _onDragEnd);

  // ── Cross-link hover → table ───────────────────────────────────────────────
  card.addEventListener('mouseenter', () => STATE.set('highlightedStrategy', strategy.name));
  card.addEventListener('mouseleave', () => STATE.set('highlightedStrategy', null));

  // ── Click → focus modal ───────────────────────────────────────────────────
  card.addEventListener('click', () => {
    import('./focus.js').then(m => m.openFocus(strategy.name));
  });

  gridEl.appendChild(card);
}


// ── Card update ───────────────────────────────────────────────────────────────

function _updateCard(card, strategy, mode) {
  card.className = `strategy-card ${_cardTopologyClass(strategy.name)}`;

  // Re-render chart
  const svg = card.querySelector('.card-chart');
  if (!svg) return;
  const labels = STATE.get('showChartLabels') ? '1' : '0';
  if (card.matches(':hover') && svg.dataset.mode === mode && svg.dataset.labels === labels) return;
  renderMiniChart(svg, strategy, mode);
  svg.dataset.mode = mode;
  svg.dataset.labels = labels;

  _updateCardChrome(card, strategy, mode);
}


// ── Drag & drop ───────────────────────────────────────────────────────────────

function _onDragStart(e) {
  _dragSrcName = e.currentTarget.dataset.name;
  e.currentTarget.classList.add('strategy-card--dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function _onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const t = e.currentTarget;
  if (t.dataset.name !== _dragSrcName) t.classList.add('strategy-card--drag-over');
}

function _onDragLeave(e) {
  e.currentTarget.classList.remove('strategy-card--drag-over');
}

function _onDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove('strategy-card--drag-over');
  const srcName = _dragSrcName;
  const dstName = target.dataset.name;
  if (!srcName || srcName === dstName) return;

  const srcCard = gridEl.querySelector(`[data-name="${srcName}"]`);
  if (!srcCard) return;
  const cards  = [...gridEl.children];
  const srcIdx = cards.indexOf(srcCard);
  const dstIdx = cards.indexOf(target);
  if (srcIdx < dstIdx) gridEl.insertBefore(srcCard, target.nextSibling);
  else                 gridEl.insertBefore(srcCard, target);
  _saveCurrentOrder();
}

function _onDragEnd(e) {
  e.currentTarget.classList.remove('strategy-card--dragging');
  document.querySelectorAll('.strategy-card--drag-over')
    .forEach(el => el.classList.remove('strategy-card--drag-over'));
  _dragSrcName = null;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function _applyHighlight(name) {
  document.querySelectorAll('.strategy-card').forEach(card => {
    card.classList.toggle('strategy-card--highlighted', card.dataset.name === name);
  });
}

function _currentStrategies() {
  const market      = STATE.get('activeMarket');
  const allChips    = STATE.get('activeChip') || {};
  const chipName    = allChips[market] || 'Default';
  const marketsData = STATE.get('marketsData');
  return getActiveStrategies(market, chipName, marketsData);
}

function _orderedStrategies(strategies) {
  const market     = STATE.get('activeMarket');
  const allChips   = STATE.get('activeChip') || {};
  const chipName   = allChips[market] || 'Default';
  const key        = `${market}::${chipName}`;
  const cardOrders = STATE.get('cardOrders') || {};
  const saved      = cardOrders[key];
  const topology = _topologyOrdered(strategies);
  if (topology) return topology;
  if (!saved || !saved.length) return strategies;

  const byName  = new Map(strategies.map(s => [s.name, s]));
  const ordered = saved.map(n => byName.get(n)).filter(Boolean);
  const inOrder = new Set(saved);
  strategies.forEach(s => { if (!inOrder.has(s.name)) ordered.push(s); });
  return ordered;
}

const TOPOLOGY_CONFIGS = {
  rates: {
    rows: [['Out', 'S12'], ['S6', 'L6', 'D6'], ['S3', 'L3', 'D3', 'L12']],
  },
  inter: {
    rows: [['S12', 'L12'], ['S3', 'S6', 'L6']],
  },
  b1: {
    rows: [
      ['Out', 'S3'],
      ['L3', 'S6', 'L6'],
      ['1xS1-2xS1(n+1)', '2xS1-1xS1(n+1)', '2xS1-3xS1(n+1)', '3xS1-2xS1(n+1)'],
    ],
  },
  b2: {
    rows: [
      ['Out', 'S3'],
      ['L3', '1xS1-2xS1(n+1)', '2xS1-3xS1(n+1)'],
      ['D3', '2xS1-1xS1(n+1)', '3xS1-2xS1(n+1)'],
    ],
  },
  a: {
    rows: [
      ['Out', 'S6'],
      ['S3', 'L3', '1xO-2xO(n+1)'],
      ['2xO-1xO(n+1)', '2xO-3xO(n+1)', '3xO-2xO(n+1)'],
    ],
  },
};

function _topologyConfig() {
  const market = String(STATE.get('activeMarket') || '').toUpperCase();
  if (['SR3 VS ER', 'ER VS SO3', 'SR3 VS SO3'].includes(market)) return TOPOLOGY_CONFIGS.inter;
  if (['SR1', 'ZQ'].includes(market)) return TOPOLOGY_CONFIGS.b1;
  if (['VIX', 'VOXX'].includes(market)) return TOPOLOGY_CONFIGS.b2;
  if (['EMP', 'MPC', 'SZI0'].includes(market)) return TOPOLOGY_CONFIGS.a;
  return TOPOLOGY_CONFIGS.rates;
}

function _topologyKeys() {
  return _topologyConfig().rows.flat();
}

function _structureKey(name) {
  const s = _normName(name);
  const hit = _topologyKeys().find(k => {
    const nk = _normName(k);
    return s === nk || s.startsWith(`${nk}VS`);
  });
  return hit || null;
}

function _topologyOrdered(strategies) {
  const byKey = new Map();
  const rest = [];
  strategies.forEach(s => {
    const key = _structureKey(s.name);
    if (key && !byKey.has(key)) byKey.set(key, s);
    else rest.push(s);
  });

  if (!byKey.size) return null;
  const ordered = _topologyKeys().map(k => byKey.get(k)).filter(Boolean);
  if (ordered.length >= Math.min(strategies.length, 5)) return [...ordered, ...rest];
  return null;
}

function _applyGridTopology(strategies) {
  gridEl.classList.remove('grid-container--topology', 'grid-container--topology-2row', 'grid-container--topology-3x3', 'grid-container--topology-3x2');

  const config = _topologyConfig();
  const keys = new Set(strategies.map(s => _structureKey(s.name)).filter(Boolean));
  const full = _topologyKeys().every(k => keys.has(k));
  gridEl.classList.toggle('grid-container--topology', full);
  if (full) {
    const rowSizes = config.rows.map(r => r.length).join('-');
    if (config.rows.length === 2) gridEl.classList.add('grid-container--topology-2row');
    if (rowSizes === '2-3-3') gridEl.classList.add('grid-container--topology-3x2');
    if (rowSizes === '2-3-4') gridEl.classList.add('grid-container--topology-3x3');
  }
}

function _cardTopologyClass(name) {
  const key = _structureKey(name);
  if (!key) return '';
  const slot = _topologyKeys().indexOf(key) + 1;
  const base = _safeClass(key);
  return `strategy-card--${base} strategy-card--slot-${slot} strategy-card--topology`;
}

function _normName(name) {
  return String(name || '')
    .trim()
    .replace(/Ã—|×/g, 'x')
    .replace(/âˆ’|−|–|—/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function _safeClass(name) {
  return _normName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function _updateCardChrome(card, strategy, mode) {
  const pill = card.querySelector('.card-topology-pill');
  const strip = card.querySelector('.card-metric-strip');
  const topo = _topologySummary(strategy, mode);

  if (pill) {
    pill.textContent = topo.label;
    pill.dataset.tone = topo.tone;
  }

  if (strip) {
    strip.innerHTML = '';
    _metricItems(strategy, mode).forEach(item => {
      const el = document.createElement('span');
      el.className = 'card-metric';
      el.dataset.tone = item.tone || 'neu';
      el.innerHTML = `<span>${item.k}</span><b>${item.v}</b>`;
      strip.appendChild(el);
    });
  }
}

function _modeVals(strategy, mode) {
  const pts = modePoints(strategy.points || [], mode, {
    strategyName: strategy.name,
    market: STATE.get('activeMarket'),
  });
  return pts.map(p => p.live).filter(v => v != null && !isNaN(v));
}

function _topologySummary(strategy, mode) {
  const vals = _modeVals(strategy, mode);
  if (vals.length < 2) return { label: 'BALANCED', tone: 'neu' };

  const key = _structureKey(strategy.name);
  const first = vals[0];
  const last = vals[vals.length - 1];
  const range = Math.max(...vals) - Math.min(...vals);
  const slope = last - first;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const mid = vals[Math.floor(vals.length / 2)];
  const wings = (first + last) / 2;
  const belly = mid - wings;
  const eps = Math.max(range * 0.18, 0.01);

  if (mode !== 'delta') {
    if (key === 'Out') {
      if (slope < -eps) return { label: 'INVERTED CURVE', tone: 'neg' };
      if (Math.abs(slope) <= eps) return { label: 'FLAT CURVE', tone: 'neu' };
      if (slope > range * 0.55) return { label: 'STEEP CURVE', tone: 'pos' };
      return { label: 'NORMAL CURVE', tone: 'neu' };
    }
    if (Math.abs(belly) <= eps * 0.45 && range <= eps * 2) return { label: 'SYMMETRIC', tone: 'neu' };
    if (range <= eps) return { label: 'COMPRESSED', tone: 'neu' };
    if (Math.abs(belly) > range * 0.45) return { label: belly > 0 ? 'BELLY CHEAP' : 'BELLY RICH', tone: belly > 0 ? 'neg' : 'pos' };
    if (Math.sign(vals[1] - first) !== Math.sign(last - vals[vals.length - 2])) return { label: 'TWISTED', tone: 'neu' };
    return { label: range > eps * 3 ? 'WIDE' : 'PINCHED', tone: range > eps * 3 ? 'neg' : 'neu' };
  }

  if (key === 'Out') {
    const bullBear = avg < 0 ? 'BULL' : avg > 0 ? 'BEAR' : 'BALANCED';
    const steepFlat = slope > eps ? 'STEEPENING' : slope < -eps ? 'FLATTENING' : 'PARALLEL';
    return { label: bullBear === 'BALANCED' || steepFlat === 'PARALLEL' ? 'BALANCED' : `${bullBear} ${steepFlat}`, tone: avg < 0 ? 'pos' : avg > 0 ? 'neg' : 'neu' };
  }

  if (range <= eps) return { label: 'COMPRESSED', tone: 'neu' };
  if (Math.abs(belly) > range * 0.42) return { label: 'BELLY PRESSURE', tone: belly > 0 ? 'neg' : 'pos' };
  if (Math.abs(first - last) <= eps * 0.7) return { label: 'BALANCED', tone: 'neu' };
  if (first - last > eps) return { label: 'FRONT HEAVY', tone: 'neg' };
  if (last - first > eps) return { label: 'BACK HEAVY', tone: 'pos' };
  return { label: range > eps * 3 ? 'DISLOCATED' : 'MIXED', tone: 'neu' };
}

function _metricItems(strategy, mode) {
  const vals = _modeVals(strategy, mode);
  if (!vals.length) return [{ k: 'RANGE', v: '--', tone: 'neu' }];

  const high = Math.max(...vals);
  const low = Math.min(...vals);
  const range = high - low;
  const rolls = [];
  for (let i = 0; i < vals.length - 1; i++) rolls.push(vals[i + 1] - vals[i]);
  const ru = rolls.length ? Math.max(...rolls) : null;
  const rd = rolls.length ? Math.min(...rolls) : null;
  const fmt = v => fmtDelta(v, Math.abs(v) >= 10 ? 1 : 2);
  const items = [
    { k: 'HIGH', v: fmt(high), tone: high > 0 ? 'pos' : high < 0 ? 'neg' : 'neu' },
    { k: 'LOW', v: fmt(low), tone: low > 0 ? 'pos' : low < 0 ? 'neg' : 'neu' },
    { k: 'RANGE', v: range.toFixed(range >= 10 ? 1 : 2), tone: 'neu' },
    { k: 'RU', v: ru == null ? '--' : fmt(ru), tone: ru > 0 ? 'pos' : ru < 0 ? 'neg' : 'neu' },
    { k: 'RD', v: rd == null ? '--' : fmt(rd), tone: rd > 0 ? 'pos' : rd < 0 ? 'neg' : 'neu' },
  ];

  if (_structureKey(strategy.name) === 'Out') {
    const slope = vals[vals.length - 1] - vals[0];
    items[2] = { k: slope >= 0 ? 'STEEPENING' : 'FLATTENING', v: fmt(slope), tone: slope > 0 ? 'pos' : slope < 0 ? 'neg' : 'neu' };
  }
  return items;
}

function _cardMap() {
  const map = new Map();
  gridEl?.querySelectorAll('.strategy-card')
    .forEach(el => map.set(el.dataset.name, el));
  return map;
}

async function _saveCurrentOrder() {
  const market     = STATE.get('activeMarket');
  const allChips   = STATE.get('activeChip') || {};
  const chipName   = allChips[market] || 'Default';
  const key        = `${market}::${chipName}`;

  const order = [...gridEl.querySelectorAll('.strategy-card')]
    .map(el => el.dataset.name);

  const cardOrders = { ...(STATE.get('cardOrders') || {}) };
  cardOrders[key]  = order;
  STATE.set('cardOrders', cardOrders);

  await saveCardOrder(`${market}__${chipName}`, order);
}
