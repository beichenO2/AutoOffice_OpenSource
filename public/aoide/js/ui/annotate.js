/**
 * AOIDE · box-select annotation.
 *
 * Drag a rectangle over the rendered artefact; while dragging we rank the
 * revision's box map locally and show *what the system thinks you circled*.
 * Nothing is applied until the instruction is submitted, and the same ranking
 * runs server-side, so the preview and the result agree.
 */
import { $, el } from './dom.js';
import { pointsToNormRect, normToStyle, rankByRect } from '../geom.js';

const MIN_DRAG_PX = 6;

export function initAnnotate({ render, onSubmit, onCancel } = {}) {
  const overlay = $('#ao-overlay');
  const boxEl = el('div', { class: 'ao-box ao-hidden', 'data-testid': 'selection-box' });
  const hintEl = el('div', { class: 'ao-box-hint ao-hidden', 'data-testid': 'selection-hint' });
  const form = $('#ao-annotate-form');
  const input = $('#ao-annotate-input');
  const target = $('#ao-annotate-target');
  overlay.append(boxEl, hintEl);

  let boxes = [];
  let page = 1;
  let enabled = false;
  let drag = null;
  let pending = null;

  function setBoxes(next, currentPage = 1) {
    boxes = Array.isArray(next) ? next : [];
    page = currentPage;
  }

  function setEnabled(on) {
    enabled = !!on;
    overlay.classList.toggle('is-active', enabled);
    document.querySelector('.ao-app')?.classList.toggle('is-annotating', enabled);
    if (!enabled) reset();
  }

  function reset() {
    drag = null;
    pending = null;
    boxEl.classList.add('ao-hidden');
    hintEl.classList.add('ao-hidden');
    form.classList.add('ao-hidden');
    input.value = '';
  }

  function paint(rect, top) {
    const surface = render.surfaceRect();
    const overlayBox = overlay.getBoundingClientRect();
    const style = normToStyle(surface, rect);
    boxEl.style.left = `${parseFloat(style.left) + surface.left - overlayBox.left}px`;
    boxEl.style.top = `${parseFloat(style.top) + surface.top - overlayBox.top}px`;
    boxEl.style.width = style.width;
    boxEl.style.height = style.height;
    boxEl.classList.remove('ao-hidden');

    hintEl.textContent = top ? `你框住的是 ${top.label}` : '这里没有可编辑的对象';
    hintEl.classList.toggle('is-empty', !top);
    hintEl.style.left = boxEl.style.left;
    hintEl.style.top = `${parseFloat(boxEl.style.top) - 26}px`;
    hintEl.classList.remove('ao-hidden');
  }

  function resolve(rect, clientX, clientY) {
    const domNodeId = render.nodeAtPoint?.(clientX, clientY) || null;
    const ranked = rankByRect(rect, boxes, page);
    if (domNodeId) {
      const exact = boxes.find((b) => b.nodeId === domNodeId && b.page === page);
      if (exact) {
        return { top: { nodeId: domNodeId, label: exact.label || domNodeId, score: 0.95 }, ranked, domNodeId };
      }
      return { top: { nodeId: domNodeId, label: domNodeId, score: 0.95 }, ranked, domNodeId };
    }
    return { top: ranked[0] || null, ranked, domNodeId: null };
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (!enabled || e.button !== 0) return;
    overlay.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    form.classList.add('ao-hidden');
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!enabled || !drag) return;
    const rect = pointsToNormRect(render.surfaceRect(), drag.x, drag.y, e.clientX, e.clientY);
    const mid = { x: (drag.x + e.clientX) / 2, y: (drag.y + e.clientY) / 2 };
    paint(rect, resolve(rect, mid.x, mid.y).top);
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!enabled || !drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (moved < MIN_DRAG_PX) { reset(); drag = null; return; }
    const rect = pointsToNormRect(render.surfaceRect(), drag.x, drag.y, e.clientX, e.clientY);
    const mid = { x: (drag.x + e.clientX) / 2, y: (drag.y + e.clientY) / 2 };
    const hit = resolve(rect, mid.x, mid.y);
    drag = null;
    paint(rect, hit.top);

    pending = { rectNorm: rect, page, ...hit };
    target.textContent = hit.top ? hit.top.label : '未命中任何对象——可以换个框选范围，或直接说明你想改哪里';
    form.classList.remove('ao-hidden');
    input.focus();
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const instruction = input.value.trim();
    if (!instruction || !pending) return;
    const surface = render.surfaceRect();
    onSubmit?.({
      page: pending.page,
      rectNorm: pending.rectNorm,
      viewport: {
        zoom: 1,
        rotation: 0,
        dpr: window.devicePixelRatio || 1,
        pageWidthPx: Math.round(surface.width),
        pageHeightPx: Math.round(surface.height),
      },
      instruction,
      ...(pending.domNodeId ? { domNodeId: pending.domNodeId } : {}),
    });
    reset();
  });

  $('#ao-annotate-cancel')?.addEventListener('click', () => { reset(); onCancel?.(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && enabled) reset(); });

  return { setBoxes, setEnabled, reset, get pending() { return pending; } };
}
