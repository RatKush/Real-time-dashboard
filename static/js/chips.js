/**
 * static/js/chips.js - Group Chip Bar + Curve Window Controllers
 */

import STATE, { saveLens, saveSkip, CURVE_LENS_DEFAULTS, CURVE_SKIP_DEFAULTS } from './state.js';
import { getChipNames, getLensForMarket, getSkipForMarket } from './utils.js';

const chipBarEl = document.getElementById('chipBar');

STATE.on('activeMarket', () => buildChips());
STATE.on('marketsData',  () => buildChips());

STATE.on('activeChip', chips => {
  const market = STATE.get('activeMarket');
  _applyActiveChip(chips[market] || 'Default');
});

STATE.on('curveLens', () => _updateLensDisplay());
STATE.on('curveSkip', () => _updateSkipDisplay());

export function buildChips() {
  if (!chipBarEl) return;

  const market      = STATE.get('activeMarket');
  const marketsData = STATE.get('marketsData');
  const chipNames   = getChipNames(market, marketsData);

  chipBarEl.innerHTML = '';

  if (!chipNames.length) return;

  chipNames.forEach(name => {
    const btn = document.createElement('button');
    btn.className    = 'chip';
    btn.dataset.chip = name;
    btn.textContent  = name;
    btn.addEventListener('click', () => _selectChip(name));
    chipBarEl.appendChild(btn);
  });

  chipBarEl.appendChild(_makeCounterControl({
    id: 'curveLenCtrl',
    label: 'CURVE LEN',
    valueId: 'curveLenVal',
    decTitle: 'Show fewer points',
    incTitle: 'Show more points',
    onDec: () => _adjustLens(-1),
    onInc: () => _adjustLens(+1),
  }));

  chipBarEl.appendChild(_makeCounterControl({
    id: 'curveSkipCtrl',
    className: 'curve-skip-ctrl',
    label: 'CURVE SKIP',
    valueId: 'curveSkipVal',
    decTitle: 'Skip fewer front contracts',
    incTitle: 'Skip more front contracts',
    onDec: () => _adjustSkip(-1),
    onInc: () => _adjustSkip(+1),
  }));

  _updateLensDisplay();
  _updateSkipDisplay();

  const allChips    = STATE.get('activeChip') || {};
  const currentChip = allChips[market] || chipNames[0] || 'Default';
  _selectChip(currentChip, false);
}

function _selectChip(chipName, notify = true) {
  _applyActiveChip(chipName);

  if (notify) {
    const market   = STATE.get('activeMarket');
    const allChips = { ...(STATE.get('activeChip') || {}) };
    allChips[market] = chipName;
    STATE.set('activeChip', allChips);
  }
}

function _applyActiveChip(chipName) {
  if (!chipBarEl) return;
  chipBarEl.querySelectorAll('.chip').forEach(btn => {
    btn.classList.toggle('chip--active', btn.dataset.chip === chipName);
  });
}

function _makeCounterControl({ id, className = '', label, valueId, decTitle, incTitle, onDec, onInc }) {
  const ctrl = document.createElement('div');
  ctrl.className = `curve-len-ctrl ${className}`.trim();
  ctrl.id = id;

  const labelEl = document.createElement('span');
  labelEl.className = 'curve-len-ctrl__label';
  labelEl.textContent = label;

  const decBtn = document.createElement('button');
  decBtn.className = 'curve-len-ctrl__btn';
  decBtn.textContent = '-';
  decBtn.title = decTitle;

  const valEl = document.createElement('span');
  valEl.className = 'curve-len-ctrl__val';
  valEl.id = valueId;

  const incBtn = document.createElement('button');
  incBtn.className = 'curve-len-ctrl__btn';
  incBtn.textContent = '+';
  incBtn.title = incTitle;

  ctrl.appendChild(labelEl);
  ctrl.appendChild(decBtn);
  ctrl.appendChild(valEl);
  ctrl.appendChild(incBtn);

  decBtn.addEventListener('click', onDec);
  incBtn.addEventListener('click', onInc);

  return ctrl;
}

function _updateLensDisplay() {
  const valEl = document.getElementById('curveLenVal');
  if (!valEl) return;
  const market = STATE.get('activeMarket');
  const val    = getLensForMarket(market);
  valEl.textContent = isFinite(val) ? val : 'all';
}

function _updateSkipDisplay() {
  const valEl = document.getElementById('curveSkipVal');
  if (!valEl) return;
  const market = STATE.get('activeMarket');
  valEl.textContent = getSkipForMarket(market);
}

function _adjustLens(delta) {
  const market = STATE.get('activeMarket');
  if (!market) return;

  const lens    = { ...(STATE.get('curveLens') || {}) };
  const current = isFinite(getLensForMarket(market))
    ? getLensForMarket(market)
    : (CURVE_LENS_DEFAULTS[market] ?? 12);
  const next    = Math.max(1, Math.min(99, current + delta));
  lens[market]  = next;

  saveLens(lens);
  STATE.set('curveLens', lens);
  _rerenderActiveChip();
}

function _adjustSkip(delta) {
  const market = STATE.get('activeMarket');
  if (!market) return;

  const skip    = { ...(STATE.get('curveSkip') || {}) };
  const current = getSkipForMarket(market) ?? (CURVE_SKIP_DEFAULTS[market] ?? 0);
  const next    = Math.max(0, Math.min(99, current + delta));
  skip[market]  = next;

  saveSkip(skip);
  STATE.set('curveSkip', skip);
  _rerenderActiveChip();
}

function _rerenderActiveChip() {
  const allChips = STATE.get('activeChip') || {};
  STATE.set('activeChip', { ...allChips });
}
