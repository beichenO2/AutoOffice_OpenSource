/**
 * AOIDE · theme controller
 * Tri-state theme (auto → light → dark) persisted to localStorage, plus a
 * manual reduce-transparency switch that layers on top of the OS preference.
 */
import { $, icon } from './dom.js';

const THEME_KEY = 'aoide.theme';
const RT_KEY = 'aoide.reduceTransparency';
const ORDER = ['auto', 'light', 'dark'];
const LABEL = { auto: '自动', light: '亮色', dark: '暗色' };
const ICON = { auto: 'theme', light: 'theme', dark: 'theme' };

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function initTheme() {
  const root = document.documentElement;
  const btn = $('#theme-toggle');
  const rtBtn = $('#transparency-toggle');

  // ----- theme -----
  let theme = localStorage.getItem(THEME_KEY) || 'auto';
  if (!ORDER.includes(theme)) theme = 'auto';
  apply(theme);

  const syncBtn = () => {
    if (!btn) return;
    btn.title = `主题：${LABEL[theme]}`;
    btn.setAttribute('aria-label', `切换主题，当前：${LABEL[theme]}`);
    const lbl = $('#theme-label');
    if (lbl) lbl.textContent = LABEL[theme];
    const old = btn.querySelector('.ao-icon');
    if (old) old.replaceWith(icon(ICON[theme]));
    // rotate the sun/moon feel via a data flag components can key off
    btn.dataset.theme = theme;
  };
  syncBtn();

  btn?.addEventListener('click', () => {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    localStorage.setItem(THEME_KEY, theme);
    apply(theme);
    syncBtn();
  });

  // ----- reduce transparency -----
  let reduced = localStorage.getItem(RT_KEY) === '1';
  const syncRT = () => {
    root.toggleAttribute('data-reduce-transparency', reduced);
    if (!rtBtn) return;
    rtBtn.setAttribute('aria-pressed', String(reduced));
    rtBtn.classList.toggle('is-active', reduced);
    rtBtn.title = reduced ? '减少透明度：开（玻璃已降级实色）' : '减少透明度：关';
  };
  syncRT();
  rtBtn?.addEventListener('click', () => {
    reduced = !reduced;
    localStorage.setItem(RT_KEY, reduced ? '1' : '0');
    syncRT();
  });

  return {
    get theme() { return theme; },
    get reduced() { return reduced; },
  };
}
