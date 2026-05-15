import STATE, { saveTheme } from './state.js';

const THEMES = [
  { id: 'classic', icon: 'C', title: 'Classic dark theme' },
  { id: 'dark',    icon: 'D', title: 'Deep dark theme' },
  { id: 'light',   icon: 'L', title: 'Light theme' },
  { id: 'mint',    icon: 'M', title: 'Mint slate theme' },
];

let themeBtn = document.getElementById('themeToggle');

if (!themeBtn) {
  const statusPill = document.getElementById('statusPill');
  themeBtn = document.createElement('button');
  themeBtn.className = 'theme-toggle';
  themeBtn.id = 'themeToggle';
  themeBtn.type = 'button';
  themeBtn.innerHTML = `
    <span class="theme-toggle__icon">C</span>
    <span class="theme-toggle__label">CLASSIC</span>
  `;
  statusPill?.insertAdjacentElement('afterend', themeBtn);
}

function _applyTheme(themeId) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;

  if (themeBtn) {
    themeBtn.dataset.theme = theme.id;
    themeBtn.title = theme.title;
    const icon = themeBtn.querySelector('.theme-toggle__icon');
    const label = themeBtn.querySelector('.theme-toggle__label');
    if (icon) icon.textContent = theme.icon;
    if (label) label.textContent = theme.id.toUpperCase();
  }
}

themeBtn?.addEventListener('click', () => {
  const current = STATE.get('theme') || THEMES[0].id;
  const idx = THEMES.findIndex(t => t.id === current);
  const next = THEMES[(idx + 1) % THEMES.length].id;
  saveTheme(next);
  STATE.set('theme', next);
});

STATE.on('theme', theme => _applyTheme(theme));
_applyTheme(STATE.get('theme'));
