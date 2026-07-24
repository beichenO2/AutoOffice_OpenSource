/**
 * AOIDE · pane controller
 * - Pointer-drag resize with clamped ranges (persisted to localStorage)
 * - Collapse to a 48px icon rail (desktop) / off-canvas drawer (≤980px)
 * - Keyboard resize on the separators (Arrow keys), double-click to reset
 * The center pane is always the protagonist: on narrow screens side panes
 * become overlay drawers so the document keeps full width.
 */
import { $ } from './dom.js';

const RANGE = { left: [200, 400], right: [300, 480] };
const DEFAULT = { left: 280, right: 360 };
const COLLAPSED = 48;
const WKEY = (side) => `aoide.pane.${side}.w`;
const NARROW = 980;

export function initPanels() {
  const app = $('#ao-app');

  const state = {
    left: clampW('left', +(localStorage.getItem(WKEY('left')) || DEFAULT.left)),
    right: clampW('right', +(localStorage.getItem(WKEY('right')) || DEFAULT.right)),
    collapsed: { left: false, right: false },
  };

  function clampW(side, w) {
    const [min, max] = RANGE[side];
    return Math.min(max, Math.max(min, Math.round(w)));
  }
  function cssVar(side) { return side === 'left' ? '--ao-pane-left-w' : '--ao-pane-right-w'; }

  function applyWidth(side) {
    const w = state.collapsed[side] ? COLLAPSED : state[side];
    app.style.setProperty(cssVar(side), `${w}px`);
  }

  function setCollapsed(side, collapsed) {
    state.collapsed[side] = collapsed;
    app.classList.toggle(`is-${side}-collapsed`, collapsed);
    const toggle = $(`#pane-${side}-toggle`);
    if (toggle) toggle.setAttribute('aria-pressed', String(!collapsed)); // pressed = expanded/active
    applyWidth(side);
    updateDrawerScrim();
  }
  function toggle(side) { setCollapsed(side, !state.collapsed[side]); }

  // ----- initial widths & responsive default -----
  applyWidth('left');
  applyWidth('right');
  if (window.innerWidth <= NARROW) { setCollapsed('left', true); setCollapsed('right', true); }

  // ----- toggle buttons -----
  $('#pane-left-toggle')?.addEventListener('click', () => toggle('left'));
  $('#pane-right-toggle')?.addEventListener('click', () => toggle('right'));

  // rail / scrim actions (event delegation)
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (!act) return;
    if (act === 'expand-left') setCollapsed('left', false);
    else if (act === 'expand-right') setCollapsed('right', false);
    else if (act === 'close-drawers') { setCollapsed('left', true); setCollapsed('right', true); }
  });

  // ----- drag to resize -----
  document.querySelectorAll('.ao-resizer').forEach((rz) => {
    const side = rz.dataset.resizer;
    let startX = 0, startW = 0;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const raw = side === 'left' ? startW + dx : startW - dx;
      state[side] = clampW(side, raw);
      applyWidth(side);
    };
    const onUp = () => {
      rz.classList.remove('is-dragging');
      document.body.classList.remove('ao-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      localStorage.setItem(WKEY(side), String(state[side]));
    };

    rz.addEventListener('pointerdown', (e) => {
      if (state.collapsed[side]) return;
      e.preventDefault();
      startX = e.clientX; startW = state[side];
      rz.classList.add('is-dragging');
      document.body.classList.add('ao-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });

    rz.addEventListener('dblclick', () => {
      state[side] = DEFAULT[side]; applyWidth(side);
      localStorage.setItem(WKEY(side), String(state[side]));
    });

    // keyboard resize
    rz.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 32 : 12;
      let handled = true;
      if (e.key === 'ArrowLeft') state[side] = clampW(side, state[side] + (side === 'left' ? -step : step));
      else if (e.key === 'ArrowRight') state[side] = clampW(side, state[side] + (side === 'left' ? step : -step));
      else if (e.key === 'Enter' || e.key === ' ') toggle(side);
      else handled = false;
      if (handled) { e.preventDefault(); applyWidth(side); localStorage.setItem(WKEY(side), String(state[side])); }
    });
  });

  // ----- drawer scrim (narrow) -----
  function updateDrawerScrim() {
    const narrow = window.innerWidth <= NARROW;
    const open = narrow && (!state.collapsed.left || !state.collapsed.right);
    app.classList.toggle('is-drawer-open', open);
  }
  let wasNarrow = window.innerWidth <= NARROW;
  window.addEventListener('resize', () => {
    const narrow = window.innerWidth <= NARROW;
    if (narrow && !wasNarrow) { setCollapsed('left', true); setCollapsed('right', true); }
    wasNarrow = narrow;
    updateDrawerScrim();
  });
  updateDrawerScrim();

  return { toggle, setCollapsed, state };
}
