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
import { fmtPrice, fmtDelta, deltaClass, nearExtreme, getActiveStrategies } from './utils.js';

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
  _orderedStrategies(strategies).forEach(s => _createCard(s));
}

export function updateGrid() {
  if (!gridEl) return;

  const mode       = STATE.get('viewMode');
  const strategies = _currentStrategies();
  const cardMap    = _cardMap();

  strategies.forEach(s => {
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
  card.className    = 'strategy-card';
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

  //card.appendChild(header);
  card.appendChild(svg);

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
  // Re-render chart
  const svg = card.querySelector('.card-chart');
  if (!svg) return;
  const labels = STATE.get('showChartLabels') ? '1' : '0';
  if (card.matches(':hover') && svg.dataset.mode === mode && svg.dataset.labels === labels) return;
  renderMiniChart(svg, strategy, mode);
  svg.dataset.mode = mode;
  svg.dataset.labels = labels;
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
  if (!saved || !saved.length) return strategies;

  const byName  = new Map(strategies.map(s => [s.name, s]));
  const ordered = saved.map(n => byName.get(n)).filter(Boolean);
  const inOrder = new Set(saved);
  strategies.forEach(s => { if (!inOrder.has(s.name)) ordered.push(s); });
  return ordered;
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
