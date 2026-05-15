/**
 * static/js/tabs.js — Market Tab Bar (Grouped) + Overview Tab
 */

import STATE from './state.js';

let _overviewMod = null;
async function _getOverview() {
  if (!_overviewMod) _overviewMod = await import('./overview.js');
  return _overviewMod;
}

const tabBarEl = document.getElementById('tabBar');

const TAB_GROUPS = [
  { label: 'Rates',     markets: ['SR3', 'ER', 'SO3', 'ER3', 'SA3', 'CRA'] },
  { label: 'Meeting',   markets: ['EMP', 'MPC'] },
  { label: 'Inter',     markets: ['SR3 vs ER', 'SR3 vs SO3', 'ER vs SO3'] },
  { label: 'Short End', markets: ['SR1', 'ZQ'] },
  { label: 'Vol',       markets: ['VIX', 'VOXX'] },
  { label: 'Other',     markets: ['SZI0'] },
];

// Keep tab highlight in sync with STATE
STATE.on('activeMarket', market => {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.market === market);
  });
});

// ── Public API ────────────────────────────────────────────────────────────────

export function buildTabs() {
  if (!tabBarEl) return;

  const markets = STATE.get('marketList');
  if (!markets || markets.length === 0) return;

  const currentMarket = STATE.get('activeMarket');

  tabBarEl.innerHTML = '';

  // Overview tab — always first
  const overviewGroup = document.createElement('div');
  overviewGroup.className = 'tab-group';
  const overviewBtn = document.createElement('button');
  overviewBtn.className = 'tab tab--overview';
  overviewBtn.dataset.market = '__OVERVIEW__';
  overviewBtn.textContent = '◈  OVERVIEW';
  overviewBtn.addEventListener('click', _switchToOverview);
  overviewGroup.appendChild(overviewBtn);
  tabBarEl.appendChild(overviewGroup);

  // Market groups
  const placed = new Set();

  TAB_GROUPS.forEach(group => {
    const groupMarkets = group.markets.filter(m => markets.includes(m));
    if (!groupMarkets.length) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'tab-group';

    groupMarkets.forEach(market => {
      groupEl.appendChild(_makeTab(market));
      placed.add(market);
    });

    tabBarEl.appendChild(groupEl);
  });

  // Orphan markets not in any group
  const orphans = markets.filter(m => !placed.has(m));
  if (orphans.length > 0) {
    const groupEl = document.createElement('div');
    groupEl.className = 'tab-group';
    orphans.forEach(market => groupEl.appendChild(_makeTab(market)));
    tabBarEl.appendChild(groupEl);
  }

  tabBarEl.appendChild(_makeLabelToggle());

  // Preserve the user's current view when tabs are rebuilt after polling.
  if (currentMarket && markets.includes(currentMarket) && !_isOverviewVisible()) {
    _switchMarket(currentMarket);
  } else {
    _switchToOverview();
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _makeTab(market) {
  const btn = document.createElement('button');
  btn.className      = 'tab';
  btn.dataset.market = market;
  btn.textContent    = market;
  btn.addEventListener('click', () => _switchMarket(market));
  return btn;
}

function _makeLabelToggle() {
  const tools = document.createElement('div');
  tools.className = 'tab-bar__tools';

  const btn = document.createElement('button');
  btn.className = 'tab-label-toggle';
  btn.type = 'button';
  btn.title = 'Show chart value labels';
  btn.textContent = 'LABELS';
  btn.classList.toggle('active', !!STATE.get('showChartLabels'));
  btn.addEventListener('click', () => {
    STATE.set('showChartLabels', !STATE.get('showChartLabels'));
    btn.classList.toggle('active', !!STATE.get('showChartLabels'));
  });

  tools.appendChild(btn);
  return tools;
}

function _isOverviewVisible() {
  const overviewEl = document.getElementById('overviewPanel');
  return overviewEl && !overviewEl.classList.contains('hidden');
}

function _switchMarket(market) {
  const currentMarket = STATE.get('activeMarket');

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.market === market);
  });

  // Hide overview, show content row
  _getOverview().then(m => m.hideOverview());
  document.getElementById('overviewPanel')?.classList.add('hidden');
  document.getElementById('contentRow')?.classList.remove('hidden');
  document.getElementById('panelLoading')?.classList.add('hidden');
  document.getElementById('chipBar')?.classList.remove('hidden');

  if (market !== currentMarket) {
    const allChips = { ...(STATE.get('activeChip') || {}) };
    if (!allChips[market]) allChips[market] = 'Default';
    STATE.set('activeChip', allChips);
  }

  STATE.set('activeMarket', market);
}

async function _switchToOverview() {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.market === '__OVERVIEW__');
  });

  document.getElementById('contentRow')?.classList.add('hidden');
  document.getElementById('panelLoading')?.classList.add('hidden');
  document.getElementById('chipBar')?.classList.add('hidden');   // ← add this

  const overviewEl = document.getElementById('overviewPanel');
  if (overviewEl) overviewEl.classList.remove('hidden');

  const mod = await _getOverview();
  mod.mountOverview(overviewEl);
  mod.showOverview();
}
