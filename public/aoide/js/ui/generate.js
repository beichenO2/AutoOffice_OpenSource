/**
 * AOIDE · "输入主题一键生成" modal controller.
 * Collects a topic (required) plus optional grounding — outline, authoritative
 * guidance, pre-chosen image links, LaTeX-formula toggle, slide count — and hands
 * a normalized payload to `onGenerate`. The modal owns open/close/validation and
 * a busy state; the caller performs the API call and closes on success.
 */
import { $, $$ } from './dom.js';

/** Parse the images textarea: one per line, optional "N: url" pins to slide N. */
function parseImages(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\d+)\s*:\s*([\s\S]+)$/.exec(line);
      return m ? { slide: Number(m[1]), src: m[2].trim() } : { src: line };
    })
    .filter((i) => /^(https?:\/\/|data:image\/)/i.test(i.src));
}

export function initGenerate({ onGenerate } = {}) {
  const modal = $('#generate-modal');
  const topicEl = $('#gen-topic');
  const outlineEl = $('#gen-outline');
  const guidanceEl = $('#gen-guidance');
  const imageEl = $('#gen-image');
  const formulasEl = $('#gen-formulas');
  const animateEl = $('#gen-animate');
  const slidesEl = $('#gen-slides');
  const submitEl = $('#gen-submit');
  if (!modal) return { open() {} };

  let busy = false;

  function open(prefillTopic = '') {
    if (prefillTopic) topicEl.value = prefillTopic;
    modal.classList.remove('ao-hidden');
    setTimeout(() => topicEl.focus(), 0);
  }
  function close() {
    if (busy) return;
    modal.classList.add('ao-hidden');
  }
  function setBusy(on) {
    busy = on;
    submitEl.classList.toggle('is-loading', on);
    submitEl.toggleAttribute('disabled', on);
  }

  async function submit() {
    const topic = topicEl.value.trim();
    if (!topic) { topicEl.focus(); return; }
    const slides = Number.parseInt(slidesEl.value, 10);
    const payload = {
      topic,
      outline: outlineEl.value.trim() || undefined,
      guidance: guidanceEl.value.trim() || undefined,
      formulas: !!formulasEl.checked,
      animate: !!animateEl?.checked,
      ...(Number.isFinite(slides) ? { slides } : {}),
    };
    const images = parseImages(imageEl.value);
    if (images.length) payload.images = images;
    try {
      setBusy(true);
      const ok = await onGenerate?.(payload);
      if (ok !== false) { modal.classList.add('ao-hidden'); reset(); }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    [topicEl, outlineEl, guidanceEl, imageEl, slidesEl].forEach((n) => { if (n) n.value = ''; });
    if (formulasEl) formulasEl.checked = false;
    if (animateEl) animateEl.checked = false;
  }

  // triggers: left header, empty-state button, topic chips
  $('#generate-deck')?.addEventListener('click', () => open());
  $('#empty-generate')?.addEventListener('click', () => open());
  document.addEventListener('click', (e) => {
    const topic = e.target.closest('[data-topic]')?.dataset.topic;
    if (topic) open(topic);
  });

  // close: X / cancel / scrim
  $$('[data-gen-close]').forEach((n) => n.addEventListener('click', close));
  submitEl?.addEventListener('click', submit);
  // Ctrl/Cmd+Enter submits from the topic field
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
  });

  return { open, close };
}
