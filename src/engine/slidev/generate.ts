/**
 * Slidev presentation source generator.
 *
 * Canonical PPT source-of-truth: `slides.md` (+ styles/components).
 * Legacy HTML deck (`html/generate.ts` + pptxgenjs image fallback) remains a
 * compatibility bridge when AUTOOFFICE_PPT_SOT=html.
 *
 * Editable nodes embed stable `data-ao-id` HTML fragments inside slides.md so
 * sourcemap/edit paths match the legacy HTML contract.
 */
import type { SourceFile } from '../types.js';
import {
  DECK_BASE_CSS,
  escapeHtml,
  renderDeckHtml,
  type DeckSpec,
  type SlideElementSpec,
  type SlideSpec,
} from '../html/generate.js';

export const SLIDES_MD = 'slides.md';
export const STYLES_PATH = 'styles/index.css';
export const COMPONENTS_DIR = 'components';

const SLIDEV_STYLES = `/* AutoOffice Slidev theme bridge — liquid-glass tokens */
:root { --ao-accent: #3b6ef5; --ao-ink: #141821; }
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

/** One Slidev slide page — HTML fragment with ao ids (no outer document). */
function renderSlideMarkdownBody(spec: SlideSpec, index: number): string {
  const slideId = `slide-${index + 1}`;
  const page = index + 1;
  const layout = spec.layout ?? 'content';
  const bullets = spec.elements.filter((e) => e.type === 'bullet');
  const nonBullets = spec.elements.filter((e) => e.type !== 'bullet');
  const parts: string[] = [];
  for (const el of nonBullets) parts.push(renderElement(slideId, el));
  if (bullets.length > 0) {
    const lis = bullets.map((b) => renderElement(slideId, b)).join('\n');
    parts.push(
      `<ul data-ao-id="${slideId}-bullets" data-ao-type="list" class="ao-el">\n${lis}\n</ul>`,
    );
  }
  return [
    `<div class="ao-slide" data-ao-id="${slideId}" data-ao-type="slide" data-ao-page="${page}" data-ao-layout="${layout}">`,
    parts.join('\n'),
    `</div>`,
  ].join('\n');
}

/** Render canonical slides.md from a deck spec. */
export function renderSlidesMd(deck: DeckSpec): string {
  const frontmatter = [
    '---',
    'theme: default',
    `title: ${JSON.stringify(deck.title)}`,
    `css: ${STYLES_PATH}`,
    'highlighter: shiki',
    'drawings:',
    '  persist: false',
    '---',
    '',
  ].join('\n');

  const pages = deck.slides.map((s, i) => renderSlideMarkdownBody(s, i));
  return frontmatter + pages.join('\n\n---\n\n') + '\n';
}

/** Full revision source tree for a Slidev presentation. */
export function renderSlidevSource(deck: DeckSpec): SourceFile[] {
  return [
    { path: SLIDES_MD, language: 'markdown', content: renderSlidesMd(deck) },
    { path: STYLES_PATH, language: 'css', content: SLIDEV_STYLES },
  ];
}

/** Strip YAML frontmatter and split Slidev pages on `---`. */
export function splitSlidevPages(md: string): string[] {
  let body = md;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end >= 0) body = body.slice(end + 4).replace(/^\n/, '');
  }
  return body
    .split(/\n---\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Measurable HTML preview for iframe/boxmap — wraps slide fragments from
 * slides.md in the same DOM contract as legacy deck.html.
 */
export function previewHtmlFromSlidesMd(md: string, title = 'Slidev preview'): string {
  const pages = splitSlidevPages(md);
  const slides = pages.join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${DECK_BASE_CSS}\n</style>`,
    '</head>',
    '<body data-ao-deck="1">',
    slides,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Preview HTML from a revision's Slidev source files. */
export function previewHtmlFromSource(source: SourceFile[]): string {
  const md = source.find((f) => f.path === SLIDES_MD)?.content;
  if (md) {
    const titleMatch = /^title:\s*(.+)$/m.exec(md.split('---')[1] ?? '');
    const title = titleMatch ? JSON.parse(titleMatch[1]!.trim()) : 'Slidev preview';
    return previewHtmlFromSlidesMd(md, typeof title === 'string' ? title : 'Slidev preview');
  }
  const legacy = source.find((f) => f.path === 'deck.html')?.content;
  if (legacy) return legacy;
  return renderDeckHtml({ title: 'Empty', slides: [] });
}
