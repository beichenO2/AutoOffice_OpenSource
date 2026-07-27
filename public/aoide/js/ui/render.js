/**
 * AOIDE · real render surface.
 *
 * The centre pane shows the *actual* rendered artefact for the current
 * revision — never a screenshot, never hard-coded markup.
 *
 *   presentation  same-origin <iframe sandbox="allow-same-origin"> over the
 *                 deck HTML. Scripts stay blocked (untrusted document), but we
 *                 can still read layout, so the annotation overlay sits exactly
 *                 on the slide box and pointer hits resolve to a real
 *                 `data-ao-id` via elementFromPoint.
 *   pdf           <iframe> on the render endpoint, fitted to one page with the
 *                 viewer chrome hidden. Overlay coordinates are normalized
 *                 against the fitted page box; this is close but not
 *                 pixel-exact, so PDF selections are always re-ranked
 *                 server-side against the SyncTeX box map.
 *
 * Lifecycle: mount → loading → loaded | failed (15 s timeout). A failed load
 * never replaces a previously good frame.
 */
import { $ } from './dom.js';

const PDF_VIEWER_HINT = '#toolbar=0&navpanes=0&scrollbar=0&view=Fit';
export const DEFAULT_LOAD_TIMEOUT_MS = 15000;

export function initRender() {
  const host = $('#ao-render');
  const surface = $('#ao-render-surface');
  const overlay = $('#ao-overlay');
  const note = $('#ao-render-note');
  let kind = 'pdf';
  let page = 1;
  /** @type {'loading'|'loaded'|'failed'} */
  let status = 'loaded';
  let loadToken = 0;
  let loadTimer = null;
  let stagingEl = null;
  /** @type {HTMLIFrameElement|null} */
  let lastGoodFrame = null;
  let pendingRevisionId = null;
  const statusListeners = new Set();

  function emitStatus(next, detail = {}) {
    status = next;
    for (const cb of statusListeners) cb(next, detail);
  }

  function clearLoadTimer() {
    if (loadTimer != null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
  }

  function clearStaging() {
    stagingEl?.remove();
    stagingEl = null;
  }

  function commitFrame(frame) {
    frame.id = 'ao-render-frame';
    surface.replaceChildren(frame, overlay);
    lastGoodFrame = frame;
  }

  function restoreGoodFrame() {
    if (lastGoodFrame) commitFrame(lastGoodFrame);
    else surface.replaceChildren(overlay);
  }

  function validateLoad(frame) {
    if (kind === 'presentation') {
      try {
        const doc = frame.contentDocument;
        if (!doc) return false;
        return !!doc.querySelector('[data-ao-type="slide"], .ao-slide');
      } catch {
        return false;
      }
    }
    // PDF viewer: load event is the best signal we get cross-browser.
    return true;
  }

  function failLoad(revisionId, reason) {
    clearLoadTimer();
    clearStaging();
    restoreGoodFrame();
    note.textContent =
      reason === 'timeout'
        ? '渲染超时，已保留上一版可用文档'
        : '渲染加载失败，已保留上一版可用文档';
    emitStatus('failed', { revisionId, reason });
  }

  function succeedLoad(frame, revisionId) {
    clearLoadTimer();
    clearStaging();
    commitFrame(frame);
    note.textContent =
      kind === 'presentation'
        ? '当前显示的是该版本的真实 HTML 渲染结果'
        : '当前显示的是该版本编译出的真实 PDF（框选坐标按整页归一化）';
    emitStatus('loaded', { revisionId, frame });
  }

  function mount({ url, kind: k, page: p = 1, revisionId, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS }) {
    kind = k === 'presentation' ? 'presentation' : 'pdf';
    page = p;
    pendingRevisionId = revisionId || '';
    host.dataset.kind = kind;
    const parent = kind === 'presentation' ? $('#slide-view') : $('#center-pdf');
    if (parent && host.parentElement !== parent) parent.prepend(host);
    surface.style.aspectRatio = kind === 'presentation' ? '16 / 9' : '1 / 1.4142';

    const token = ++loadToken;
    clearLoadTimer();
    clearStaging();

    const frame = document.createElement('iframe');
    frame.className = 'ao-render__frame';
    frame.title = kind === 'presentation' ? '幻灯片渲染结果' : 'PDF 渲染结果';
    frame.dataset.revisionId = revisionId || '';
    if (kind === 'presentation') {
      frame.setAttribute('sandbox', 'allow-same-origin');
    }

    stagingEl = document.createElement('div');
    stagingEl.className = 'ao-render__staging';
    stagingEl.append(frame);
    host.append(stagingEl);

    note.textContent = '正在加载渲染结果…';
    emitStatus('loading', { revisionId: pendingRevisionId });

    const onLoad = () => {
      if (token !== loadToken) return;
      if (!validateLoad(frame)) {
        failLoad(pendingRevisionId, 'error');
        return;
      }
      succeedLoad(frame, pendingRevisionId);
    };

    frame.addEventListener('load', onLoad, { once: true });
    frame.addEventListener(
      'error',
      () => {
        if (token !== loadToken) return;
        failLoad(pendingRevisionId, 'error');
      },
      { once: true },
    );

    loadTimer = setTimeout(() => {
      if (token !== loadToken) return;
      failLoad(pendingRevisionId, 'timeout');
    }, timeoutMs);

    if (kind === 'presentation') frame.src = url;
    else frame.src = `${url}${PDF_VIEWER_HINT}&page=${page}`;

    return frame;
  }

  function onStatusChange(cb) {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  }

  /** Resolves when the given revision finishes loading; rejects on failure/timeout. */
  function whenLoaded(revisionId, { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS + 2000 } = {}) {
    const rid = revisionId || pendingRevisionId;
    if (status === 'loaded' && lastGoodFrame?.dataset.revisionId === rid) {
      return Promise.resolve(lastGoodFrame);
    }
    if (status === 'failed' && pendingRevisionId === rid) {
      return Promise.reject(new Error('render failed'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('whenLoaded timeout'));
      }, timeoutMs);
      const off = onStatusChange((st, detail) => {
        if (detail.revisionId !== rid) return;
        if (st === 'loaded') {
          clearTimeout(timer);
          off();
          resolve(detail.frame || lastGoodFrame);
        } else if (st === 'failed') {
          clearTimeout(timer);
          off();
          reject(new Error(detail.reason || 'render failed'));
        }
      });
    });
  }

  function surfaceRect() {
    const frame = $('#ao-render-frame');
    if (kind === 'presentation' && frame) {
      const slide = slideEl(frame, page);
      if (slide) {
        const inner = slide.getBoundingClientRect();
        const outer = frame.getBoundingClientRect();
        return new DOMRect(outer.left + inner.left, outer.top + inner.top, inner.width, inner.height);
      }
    }
    return (frame || surface).getBoundingClientRect();
  }

  function slideEl(frame, n) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return null;
      const slides = doc.querySelectorAll('[data-ao-type="slide"], .ao-slide');
      return slides[n - 1] || null;
    } catch {
      return null;
    }
  }

  function nodeAtPoint(clientX, clientY) {
    if (status !== 'loaded') return null;
    const frame = $('#ao-render-frame');
    if (kind !== 'presentation' || !frame) return null;
    try {
      const doc = frame.contentDocument;
      if (!doc) return null;
      const box = frame.getBoundingClientRect();
      const el = doc.elementFromPoint(clientX - box.left, clientY - box.top);
      const owner = el?.closest?.('[data-ao-id]');
      const id = owner?.getAttribute('data-ao-id');
      if (!id || owner.getAttribute('data-ao-type') === 'slide') return null;
      return id;
    } catch {
      return null;
    }
  }

  function goToPage(n) {
    if (status !== 'loaded') return;
    page = n;
    const frame = $('#ao-render-frame');
    if (!frame) return;
    if (kind === 'presentation') {
      slideEl(frame, n)?.scrollIntoView({ block: 'center' });
    } else if (frame.src) {
      frame.src = frame.src.replace(/([?#&]page=)\d+/, `$1${n}`);
    }
  }

  /** @deprecated prefer whenLoaded / onStatusChange */
  function onFrameReady(cb) {
    whenLoaded(pendingRevisionId).then((frame) => cb(frame)).catch(() => {});
  }

  return {
    mount,
    surfaceRect,
    nodeAtPoint,
    goToPage,
    onFrameReady,
    onStatusChange,
    whenLoaded,
    get kind() {
      return kind;
    },
    get page() {
      return page;
    },
    get status() {
      return status;
    },
    get revisionId() {
      return lastGoodFrame?.dataset.revisionId || pendingRevisionId;
    },
  };
}
