/**
 * AOIDE · box-select annotation.
 *
 * Two ways to pick what to edit, both driven by the *same* box map so the
 * preview never disagrees with the result:
 *   1. Click-to-select — every selectable component is pre-outlined with a
 *      faint liquid-glass border; hover intensifies it, a single click selects
 *      it. This is the primary path (you can only ever pick a known component).
 *   2. Drag-marquee — draw a rectangle; we rank the box map locally and show
 *      "你框住的是 …". Kept as a fallback for spanning / fuzzy selections.
 * Nothing is applied until the instruction is submitted, and the same ranking
 * runs server-side.
 */
import { $, el } from './dom.js';
import { pointsToNormRect, normToStyle, rankByRect } from '../geom.js';

const MIN_DRAG_PX = 6;

export function initAnnotate({ render, onSubmit, onCancel } = {}) {
  const overlay = $('#ao-overlay');
  const hotspotsEl = el('div', { class: 'ao-hotspots', 'data-testid': 'selection-hotspots' });
  const boxEl = el('div', { class: 'ao-box ao-hidden', 'data-testid': 'selection-box' });
  const hintEl = el('div', { class: 'ao-box-hint ao-hidden', 'data-testid': 'selection-hint' });
  const form = $('#ao-annotate-form');
  const input = $('#ao-annotate-input');
  const target = $('#ao-annotate-target');
  overlay.append(hotspotsEl, boxEl, hintEl);

  let boxes = [];
  let page = 1;
  let enabled = false;
  let drag = null;
  let downHotspotId = null;
  let pending = null;

  function setBoxes(next, currentPage = 1) {
    boxes = Array.isArray(next) ? next : [];
    page = currentPage;
    renderHotspots();
  }

  function setEnabled(on) {
    enabled = !!on;
    overlay.classList.toggle('is-active', enabled);
    document.querySelector('.ao-app')?.classList.toggle('is-annotating', enabled);
    if (!enabled) { reset(); clearHotspots(); }
    else { renderHotspots(); requestAnimationFrame(repositionHotspots); }
  }

  function reset() {
    drag = null;
    downHotspotId = null;
    pending = null;
    boxEl.classList.add('ao-hidden');
    hintEl.classList.add('ao-hidden');
    form.classList.add('ao-hidden');
    input.value = '';
    hotspotsEl.classList.remove('is-dragging');
    for (const h of hotspotsEl.children) h.classList.remove('is-selected');
  }

  // ---- click-to-select: pre-outline every selectable component ------------
  function clearHotspots() {
    hotspotsEl.replaceChildren();
  }

  function placeHotspot(node, box) {
    const surface = render.surfaceRect();
    const overlayBox = overlay.getBoundingClientRect();
    const style = normToStyle(surface, { x: box.x, y: box.y, w: box.w, h: box.h });
    node.style.left = `${parseFloat(style.left) + surface.left - overlayBox.left}px`;
    node.style.top = `${parseFloat(style.top) + surface.top - overlayBox.top}px`;
    node.style.width = style.width;
    node.style.height = style.height;
  }

  function renderHotspots() {
    clearHotspots();
    if (!enabled) return;
    for (const box of boxes) {
      if (box.page !== page) continue;
      const node = el('button', {
        type: 'button',
        class: 'ao-hotspot',
        'data-testid': 'selection-hotspot',
        'data-node-id': box.nodeId,
        title: box.label || box.nodeId,
      }, [el('span', { class: 'ao-hotspot__tag' }, box.label || box.nodeId)]);
      placeHotspot(node, box);
      hotspotsEl.append(node);
    }
  }

  function repositionHotspots() {
    if (!enabled || hotspotsEl.childElementCount === 0) return;
    for (const node of hotspotsEl.children) {
      const id = node.getAttribute('data-node-id');
      const box = boxes.find((b) => b.nodeId === id && b.page === page);
      if (box) placeHotspot(node, box);
    }
  }

  function selectBox(nodeId) {
    const box = boxes.find((b) => b.nodeId === nodeId && b.page === page);
    if (!box) return;
    const rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    paint(rect, { nodeId: box.nodeId, label: box.label || box.nodeId, score: 1 });
    for (const h of hotspotsEl.children) {
      h.classList.toggle('is-selected', h.getAttribute('data-node-id') === nodeId);
    }
    pending = {
      rectNorm: rect,
      page,
      top: { nodeId: box.nodeId, label: box.label || box.nodeId, score: 1 },
      ranked: [{ nodeId: box.nodeId, label: box.label || box.nodeId, rect, score: 1 }],
      domNodeId: render.kind === 'presentation' ? box.nodeId : null,
    };
    target.textContent = box.label || box.nodeId;
    form.classList.remove('ao-hidden');
    input.focus();
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => repositionHotspots()).observe(overlay);
  }
  window.addEventListener('resize', repositionHotspots);

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
    downHotspotId = e.target?.closest?.('.ao-hotspot')?.getAttribute('data-node-id') || null;
    form.classList.add('ao-hidden');
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!enabled || !drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (moved < MIN_DRAG_PX) return; // below threshold: treat as a pending click
    hotspotsEl.classList.add('is-dragging'); // a real drag → get outlines out of the way
    const rect = pointsToNormRect(render.surfaceRect(), drag.x, drag.y, e.clientX, e.clientY);
    const mid = { x: (drag.x + e.clientX) / 2, y: (drag.y + e.clientY) / 2 };
    paint(rect, resolve(rect, mid.x, mid.y).top);
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!enabled || !drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    hotspotsEl.classList.remove('is-dragging');

    // A near-stationary press = a click. If it landed on a pre-outlined
    // component, select it directly (the primary click-to-select path).
    if (moved < MIN_DRAG_PX) {
      const id = downHotspotId;
      drag = null;
      downHotspotId = null;
      if (id) selectBox(id);
      else reset();
      return;
    }

    const rect = pointsToNormRect(render.surfaceRect(), drag.x, drag.y, e.clientX, e.clientY);
    const mid = { x: (drag.x + e.clientX) / 2, y: (drag.y + e.clientY) / 2 };
    const hit = resolve(rect, mid.x, mid.y);
    drag = null;
    downHotspotId = null;
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

  function setPage(n) {
    if (!Number.isFinite(n) || n === page) return;
    page = n;
    reset();
    renderHotspots();
    requestAnimationFrame(repositionHotspots);
  }

  return {
    setBoxes,
    setEnabled,
    setPage,
    reposition: repositionHotspots,
    reset,
    get pending() { return pending; },
  };
}
