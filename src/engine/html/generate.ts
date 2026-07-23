/**
 * Presentation source generator. HTML/CSS is the source-of-truth for PPT.
 * Every slide and editable element carries a stable, render-independent
 * `data-ao-id` so a selection can be mapped back to the exact source object.
 *
 * Pure Node (no Python); generated prose is expected to be de-AI'd upstream.
 */

export interface SlideElementSpec {
  /** Local id (unique within slide); global id becomes `${slideId}-${id}`. */
  id: string;
  type: 'heading' | 'subheading' | 'paragraph' | 'bullet' | 'image' | 'note';
  text?: string;
  src?: string;
  alt?: string;
}

export interface SlideSpec {
  title: string;
  layout?: 'title' | 'content' | 'section';
  elements: SlideElementSpec[];
}

export interface DeckSpec {
  title: string;
  theme?: string;
  slides: SlideSpec[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Deterministic default CSS — readable slides, no external assets. */
export const DECK_BASE_CSS = `
:root{--ao-ink:#141821;--ao-muted:#5b6472;--ao-accent:#3b6ef5;--ao-bg:#ffffff;}
*{box-sizing:border-box;}
body{margin:0;font-family:-apple-system,"Segoe UI","PingFang SC",Roboto,sans-serif;color:var(--ao-ink);background:#eef1f6;}
.ao-slide{position:relative;width:1280px;height:720px;margin:0 auto 24px;background:var(--ao-bg);
  padding:64px 72px;overflow:hidden;box-shadow:0 8px 30px rgba(20,24,33,.10);}
.ao-slide[data-ao-layout="title"]{display:flex;flex-direction:column;justify-content:center;}
.ao-el{outline:none;}
h1.ao-el{font-size:52px;line-height:1.15;margin:0 0 16px;font-weight:700;}
h2.ao-el{font-size:34px;line-height:1.2;margin:0 0 20px;font-weight:650;color:var(--ao-accent);}
p.ao-el{font-size:24px;line-height:1.5;margin:0 0 14px;color:var(--ao-muted);}
ul.ao-el{margin:0;padding-left:28px;}
li.ao-el{font-size:26px;line-height:1.55;margin:0 0 12px;}
img.ao-el{max-width:100%;border-radius:12px;}
`.trim();

function renderElement(slideId: string, el: SlideElementSpec): string {
  const gid = `${slideId}-${el.id}`;
  const idAttr = `data-ao-id="${escapeHtml(gid)}" data-ao-type="${el.type}" class="ao-el"`;
  switch (el.type) {
    case 'heading':
      return `<h1 ${idAttr}>${escapeHtml(el.text ?? '')}</h1>`;
    case 'subheading':
      return `<h2 ${idAttr}>${escapeHtml(el.text ?? '')}</h2>`;
    case 'paragraph':
      return `<p ${idAttr}>${escapeHtml(el.text ?? '')}</p>`;
    case 'note':
      return `<p ${idAttr} data-ao-note="1">${escapeHtml(el.text ?? '')}</p>`;
    case 'image':
      return `<img ${idAttr} src="${escapeHtml(el.src ?? '')}" alt="${escapeHtml(el.alt ?? '')}">`;
    case 'bullet':
      return `<li ${idAttr}>${escapeHtml(el.text ?? '')}</li>`;
  }
}

function renderSlide(spec: SlideSpec, index: number): string {
  const slideId = `slide-${index + 1}`;
  const page = index + 1;
  const layout = spec.layout ?? 'content';
  const bullets = spec.elements.filter((e) => e.type === 'bullet');
  const nonBullets = spec.elements.filter((e) => e.type !== 'bullet');
  const parts: string[] = [];
  for (const el of nonBullets) parts.push(renderElement(slideId, el));
  if (bullets.length > 0) {
    const lis = bullets.map((b) => renderElement(slideId, b)).join('\n      ');
    parts.push(`<ul data-ao-id="${slideId}-bullets" data-ao-type="list" class="ao-el">\n      ${lis}\n    </ul>`);
  }
  return [
    `  <section class="ao-slide" data-ao-id="${slideId}" data-ao-type="slide" data-ao-page="${page}" data-ao-layout="${layout}">`,
    `    ${parts.join('\n    ')}`,
    `  </section>`,
  ].join('\n');
}

/** Render a full, self-contained deck HTML document. */
export function renderDeckHtml(deck: DeckSpec): string {
  const slides = deck.slides.map((s, i) => renderSlide(s, i)).join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(deck.title)}</title>`,
    `<style>\n${DECK_BASE_CSS}\n</style>`,
    '</head>',
    '<body data-ao-deck="1">',
    slides,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Total slide count in a deck spec. */
export function slideCount(deck: DeckSpec): number {
  return deck.slides.length;
}
