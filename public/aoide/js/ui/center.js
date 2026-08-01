/**
 * AOIDE · center pane controller.
 * Owns the document toolbar and the stage state machine. The actual page
 * bitmap render + box-select coordinate math is the engine owner's job — we
 * provide the toolbar, indicators, zoom, annotate mode and the .ao-page-overlay
 * containers, plus deterministic empty/loading/error states.
 */
import { $, $$, showOnly } from './dom.js';

const STATES = ['center-pdf', 'center-deck', 'center-loading', 'center-empty', 'center-error'];
const RENDER_TEXT = { rendered: '已渲染', pending: '渲染中…', failed: '渲染失败' };

export function initCenter(handlers = {}) {
  const app = $('#ao-app');
  const zoomValue = $('#zoom-value');
  const pageInd = $('#page-indicator');
  const renderStatus = $('#render-status');
  const renderText = $('#render-status-text');
  const annotateBtn = $('#annotate-toggle');
  const exportBtn = $('#export-menu');
  const exportList = $('#export-list');

  const s = { zoom: 100, annotating: false, page: 1, pages: 1 };

  function setState(name) {
    const id = name === 'pdf' ? 'center-pdf' : name === 'deck' ? 'center-deck'
      : name === 'loading' ? 'center-loading' : name === 'error' ? 'center-error' : 'center-empty';
    showOnly(id, STATES);
  }

  function setMode(kind) {
    app.dataset.mode = kind === 'presentation' ? 'ppt' : 'pdf';
    setState(kind === 'presentation' ? 'deck' : 'pdf');
  }

  function setDoc({ name, sub, page, pages } = {}) {
    if (name != null) $('#doc-name').textContent = name;
    if (sub != null) $('#doc-sub').textContent = sub;
    if (page != null) s.page = page;
    if (pages != null) s.pages = pages;
    pageInd.textContent = s.pages ? `${s.page} / ${s.pages}` : '— / —';
  }

  function setRenderStatus(status) {
    renderStatus.classList.remove('is-rendered', 'is-pending', 'is-failed');
    renderStatus.classList.add(`is-${status}`);
    renderText.textContent = RENDER_TEXT[status] || status;
  }

  function applyZoom() {
    zoomValue.textContent = `${s.zoom}%`;
    // Only the document stages scale. The error panel is also a
    // `.ao-stage__inner`, and zooming an alert box was never intended.
    $$('#center-pdf, #center-deck').forEach((n) => {
      n.style.transformOrigin = 'top center';
      n.style.transform = `scale(${s.zoom / 100})`;
    });
    handlers.onZoom?.(s.zoom);
  }
  function setZoom(z) { s.zoom = Math.min(200, Math.max(50, Math.round(z))); applyZoom(); }

  // ---- toolbar wiring ----
  $('#zoom-in')?.addEventListener('click', () => setZoom(s.zoom + 10));
  $('#zoom-out')?.addEventListener('click', () => setZoom(s.zoom - 10));
  $('#fit-width')?.addEventListener('click', () => { setZoom(120); handlers.onFit?.('width'); });
  $('#fit-page')?.addEventListener('click', () => { setZoom(90); handlers.onFit?.('page'); });

  annotateBtn?.addEventListener('click', () => {
    s.annotating = !s.annotating;
    annotateBtn.setAttribute('aria-pressed', String(s.annotating));
    annotateBtn.classList.toggle('is-active', s.annotating);
    app.classList.toggle('is-annotating', s.annotating);
    handlers.onAnnotateToggle?.(s.annotating);
  });

  // export menu (popover)
  function closeMenu() { exportList.classList.remove('is-open'); exportBtn.setAttribute('aria-expanded', 'false'); }
  exportBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportList.classList.toggle('is-open');
    exportBtn.setAttribute('aria-expanded', String(open));
  });
  exportList?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-export]');
    if (item) { handlers.onExport?.(item.dataset.export, item.dataset.clicks === '1'); closeMenu(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#export-menu, #export-list')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // insert / reference image (popover + hidden file input)
  const insertBtn = $('#insert-image');
  const insertList = $('#insert-list');
  const insertFile = $('#insert-file');
  function closeInsert() { insertList?.classList.remove('is-open'); insertBtn?.setAttribute('aria-expanded', 'false'); }
  insertBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = insertList.classList.toggle('is-open');
    insertBtn.setAttribute('aria-expanded', String(open));
  });
  insertList?.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-insert]')?.dataset.insert;
    if (!kind) return;
    closeInsert();
    if (kind === 'file') { insertFile.value = ''; insertFile.click(); return; }
    handlers.onInsertImage?.(kind);
  });
  insertFile?.addEventListener('change', () => {
    const file = insertFile.files?.[0];
    if (file) handlers.onInsertImage?.('file', file);
    insertFile.value = '';
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#insert-image-wrap')) closeInsert(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInsert(); });

  // retry render / close compare (delegated)
  $('#retry-render')?.addEventListener('click', () => handlers.onRetry?.());
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-compare"]')) $('#compare-bar')?.classList.add('ao-hidden');
  });

  applyZoom();

  return { setState, setMode, setDoc, setRenderStatus, setZoom, showCompare: (on = true) => $('#compare-bar')?.classList.toggle('ao-hidden', !on), get annotating() { return s.annotating; }, get page() { return s.page; } };
}
