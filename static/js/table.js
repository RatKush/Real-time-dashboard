/**
 * static/js/table.js — Contract Chain Table
 * ===========================================
 * Shows the FULL futures contract chain (all roll positions) for the
 * currently hovered strategy card.  Falls back to the 4th strategy in
 * the active chip when nothing is hovered.
 *
 * Columns: CONTRACT | LIVE | SETTLE | Δ
 *
 * The table is sortable by clicking any column header.
 * Delta values are coloured red (negative) / green (positive).
 *
 * Cross-linking: hover card → table updates to show that strategy's chain.
 */

import STATE from './state.js';
import { fmtPrice, fmtDelta, deltaClass, getActiveStrategies } from './utils.js';

const tbodyEl  = document.getElementById('ratioTableBody');
const tableEl  = document.getElementById('ratioTable');

// Sort state
let _sortCol = 'contract';  // 'contract' | 'live' | 'settle' | 'delta'
let _sortDir = 1;           // 1 = asc, -1 = desc
let _pinnedStrategy = null; // null = auto (hovered or default), string = locked name

STATE.on('activeMarket',        () => { _pinnedStrategy = null; buildTable(); });
STATE.on('activeChip',          () => { _pinnedStrategy = null; buildTable(); });
STATE.on('marketsData',         () => updateTable());
STATE.on('viewMode',            () => updateTable());
STATE.on('curveLens',           () => updateTable());
STATE.on('curveSkip',           () => updateTable());
STATE.on('highlightedStrategy', n  => _onHover(n));

// ── Build sortable header ─────────────────────────────────────────────────────
function _buildHeader() {
  const thead = tableEl?.querySelector('thead tr');
  if (!thead) return;

  const cols = [
    { key: 'contract', label: 'CONT' },
    { key: 'live',     label: 'LIVE'     },
    { key: 'settle',   label: 'SETTLE'   },   
    { key: 'delta',    label: 'Δ'        },
  ];

  thead.innerHTML = '';
  cols.forEach(({ key, label }) => {
    const th = document.createElement('th');
    th.dataset.col = key;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.innerHTML = `${label} <span class="sort-arrow" data-col="${key}"></span>`;
    th.addEventListener('click', () => _onSortClick(key));
    thead.appendChild(th);
  });

  _updateSortArrows();
}

function _onSortClick(col) {
  if (_sortCol === col) {
    _sortDir *= -1;
  } else {
    _sortCol = col;
    _sortDir = col === 'delta' ? -1 : 1;
  }
  _updateSortArrows();
  updateTable();
}

function _updateSortArrows() {
  if (!tableEl) return;
  tableEl.querySelectorAll('.sort-arrow').forEach(el => {
    const col = el.dataset.col;
    if (col === _sortCol) {
      el.textContent = _sortDir === 1 ? ' ↑' : ' ↓';
      el.style.color = 'var(--accent)';
    } else {
      el.textContent = '';
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildTable() {
  if (!tbodyEl) return;
  _buildHeader();
  tbodyEl.innerHTML = '';
  _renderForStrategy(_resolveStrategy());
}

export function updateTable() {
  if (!tbodyEl) return;
  _renderForStrategy(_resolveStrategy());
}


// ── Hover handler ─────────────────────────────────────────────────────────────

function _onHover(name) {
  // When a card is hovered, show that strategy's chain
  // When hover ends (null), revert to default
  updateTable();
}


// ── Strategy resolver ─────────────────────────────────────────────────────────

function _resolveStrategy() {
  const market      = STATE.get('activeMarket');
  const allChips    = STATE.get('activeChip') || {};
  const chipName    = allChips[market] || 'Default';
  const marketsData = STATE.get('marketsData');
  const strategies  = getActiveStrategies(market, chipName, marketsData);

  if (!strategies.length) return null;

  // Priority: hovered strategy → pinned → 4th (index 3) → first
  const hovered = STATE.get('highlightedStrategy');
  if (hovered) {
    const s = strategies.find(s => s.name === hovered);
    if (s) return s;
  }

  if (_pinnedStrategy) {
    const s = strategies.find(s => s.name === _pinnedStrategy);
    if (s) return s;
  }

  // Default: 4th strategy (index 3) or last available
  return strategies[Math.min(3, strategies.length - 1)];
}


// ── Render contract chain ─────────────────────────────────────────────────────

function _renderForStrategy(strategy) {
  if (!tbodyEl) return;
  tbodyEl.innerHTML = '';

  if (!strategy) return;

  // Update the section label to show which strategy we're viewing
  const sectionLabel = document.querySelector('.table-section .section-label');
  if (sectionLabel) {
    //sectionLabel.textContent = `${strategy.name}  ·  CONT CHAIN`;
    sectionLabel.textContent = `${_displayName(strategy.name)}  ·  CONT CHAIN`;
  }

  const points = (strategy.points || []).slice();

  // Sort the points
  const sorted = _sortPoints(points);

  sorted.forEach((pt, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;

    const dCls = deltaClass(pt.delta);
    const dClr = dCls === 'pos'
      ? 'var(--col-pos)'
      : dCls === 'neg'
        ? 'var(--col-neg)'
        : 'var(--text-secondary)';
    const dSign = pt.delta != null && pt.delta >= 0 ? '+' : '';

    tr.innerHTML = `
      <td style="font-family:var(--font-ui);font-weight:600;letter-spacing:0.06em;color:var(--text-primary)">
        ${pt.label ?? '—'}
      </td>
      <td style="color:${pt.live < -0.0001 ? 'var(--col-neg)' : 'var(--col-live)'};font-weight:500">
        ${pt.live != null ? fmtPrice(Math.abs(pt.live), 2) : '—'}
      </td>
      <td style="color:${pt.settle < -0.0001? 'var(--col-neg)' : 'var(--text-secondary)'}">
        ${pt.settle != null ? fmtPrice(Math.abs(pt.settle), 2) : '—'}
      </td>
      <td style="color:${dClr};font-weight:500">${pt.delta != null ? dSign + fmtPrice(pt.delta, 2) : '—'}</td>
    `;

    // Bar behind delta cell to visualise magnitude
    const deltaCell = tr.querySelector('td:last-child');
    if (pt.delta != null) {
      deltaCell.style.position = 'relative';
    }

    tbodyEl.appendChild(tr);
  });
}

function _sortPoints(points) {
  const arr = [...points];
  if (_sortCol === 'contract') {
    return _sortDir === 1 ? arr : arr.reverse();
  }
  const key = _sortCol; // 'live' | 'settle' | 'delta'
  return arr.sort((a, b) => {
    const av = a[key] ?? -Infinity;
    const bv = b[key] ?? -Infinity;
    return (av - bv) * _sortDir;
  });
}


//helper function to display 1 month products as 1m instead of 3m
//#1 month markets 1m products 1month
const _1M_MARKETS = new Set(['EMP','MPC','SR1','ZQ','VIX','VOXX','SZI0']);

function _displayName(name) {
  const market = STATE.get('activeMarket');
  if (typeof name !== "string") return name;
  if (!_1M_MARKETS.has(market)) return name;

  return name.replace(/([SLDW])(\d+)/g, (_, prefix, num) => {
    return prefix + Math.max(1, Math.round(parseInt(num, 10) / 3));
  });
}
