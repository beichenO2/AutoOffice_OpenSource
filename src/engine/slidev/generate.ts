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
  renderFormulaMathml,
  renderInlineText,
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

/** Body content that can step-reveal on click when a slide has `reveal` (S7). */
function isRevealable(type: SlideElementSpec['type']): boolean {
  return type === 'bullet' || type === 'paragraph' || type === 'formula';
}

function renderElement(slideId: string, el: SlideElementSpec, reveal = false): string {
  const gid = `${slideId}-${el.id}`;
  // S7: `v-click` makes the element a fragment in Slidev (export/dev step-reveal).
  // In the sandboxed static preview it is an unknown attribute → ignored (element
  // stays visible), so the box map / editing contract is unaffected.
  const vclick = reveal && isRevealable(el.type) ? ' v-click' : '';
  const idAttr = `data-ao-id="${escapeHtml(gid)}" data-ao-type="${el.type}" class="ao-el"${vclick}`;
  switch (el.type) {
    case 'heading':
      return `<h1 ${idAttr}>${renderInlineText(el.text ?? '')}</h1>`;
    case 'subheading':
      return `<h2 ${idAttr}>${renderInlineText(el.text ?? '')}</h2>`;
    case 'paragraph':
      return `<p ${idAttr}>${renderInlineText(el.text ?? '')}</p>`;
    case 'note':
      return `<p ${idAttr} data-ao-note="1">${renderInlineText(el.text ?? '')}</p>`;
    case 'image':
      return `<img ${idAttr} src="${escapeHtml(el.src ?? '')}" alt="${escapeHtml(el.alt ?? '')}">`;
    case 'bullet':
      return `<li ${idAttr}>${renderInlineText(el.text ?? '')}</li>`;
    case 'formula':
      return `<div ${idAttr} data-ao-formula="1">${renderFormulaMathml(el.text ?? '', el.display !== false)}</div>`;
  }
}

/** Standalone editable image element (used by user-driven "insert image"). */
export function imageElementHtml(nodeId: string, src: string, alt = ''): string {
  return `<img data-ao-id="${escapeHtml(nodeId)}" data-ao-type="image" class="ao-el" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
}

/** One Slidev slide page — HTML fragment with ao ids (no outer document). */
function renderSlideMarkdownBody(spec: SlideSpec, index: number): string {
  const slideId = `slide-${index + 1}`;
  const page = index + 1;
  const layout = spec.layout ?? 'content';
  const bullets = spec.elements.filter((e) => e.type === 'bullet');
  const nonBullets = spec.elements.filter((e) => e.type !== 'bullet');
  const parts: string[] = [];
  // Content slides carry a title in the spec but never rendered it — give each a
  // proper frame title (editable, stable `slide-N-title` id) so the deck reads
  // like a real presentation instead of bare bullets.
  const hasHeading = spec.elements.some((e) => e.type === 'heading' || e.type === 'subheading');
  const reveal = layout !== 'title' && !!spec.reveal;
  if (layout !== 'title' && spec.title && !hasHeading) {
    parts.push(renderElement(slideId, { id: 'title', type: 'heading', text: spec.title })); // title never reveals
  }
  for (const el of nonBullets) parts.push(renderElement(slideId, el, reveal));
  if (bullets.length > 0) {
    const lis = bullets.map((b) => renderElement(slideId, b, reveal)).join('\n');
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
    // S7: deck-level default transition (Slidev headmatter) — applies to every
    // slide in export/dev; inert in the static preview. Kept inside the single
    // head frontmatter block so splitSlidevPages / title extraction are unaffected.
    ...(deck.transition ? [`transition: ${deck.transition}`] : []),
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

/** True if the deck source carries Slidev click fragments (S7 `v-click`) — used
 * to auto-enable `--with-clicks` on export so step-reveal becomes per-step pages. */
export function deckHasClicks(source: SourceFile[]): boolean {
  const md = source.find((f) => f.path === SLIDES_MD)?.content ?? '';
  return /\bv-click\b/.test(md);
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
 * Fit the intrinsic 1280×720 slide to whatever viewport the preview iframe gives
 * us. Box geometry is preserved because the Chromium box measurer runs at a
 * 1280-wide viewport where these `vw` units reproduce the original pixels
 * (100vw = 1280px, 4.0625vw = 52px, 5vw = 64px …) and boxes are normalised
 * against the slide's own rect; in the smaller live editor iframe the same slide
 * simply scales down to fit instead of overflowing and clipping its content.
 */
/*
 * Metropolis-inspired deck theme (the clean minimalist look used at NeurIPS/ICML
 * talks): generous whitespace, one accent, frame title over a hairline rule, a
 * slim progress bar at the foot. All sizes in vw so that at the 1280-wide
 * box-measure viewport they reproduce intrinsic px (100vw=1280) and the selection
 * overlay stays aligned, while the slide scales to fit the live editor iframe.
 */
const PREVIEW_FIT_CSS = `
html,body{margin:0;overflow-x:hidden;}
body[data-ao-deck]{
  background:#e9edf4;
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  counter-reset:aopage aosec;
  /* Theme accent tokens — a deck is a themed system, so every accent is driven
     by these vars. Defaults reproduce the original hard-coded palette exactly;
     the preview overrides --ao-accent (+ derived) from the slides.md aoAccent
     frontmatter to recolor the whole deck consistently (the #4 PPT skill). */
  --ao-accent:#3a63e8;
  --ao-accent-lite:#6f93f7;
  --ao-accent-lite2:#7ea0ff;
  --ao-accent-cover:#9ab4ff;
  --ao-cover-1:#0d1526;
  --ao-cover-2:#172a54;
  --ao-cover-3:#21407e;
}
.ao-slide{
  position:relative;width:100vw;height:56.25vw;margin:0 auto 2.6vw;
  padding:6.6vw 7.4vw 6.4vw;background:#fbfcfe;color:#1b2233;overflow:hidden;
  display:flex;flex-direction:column;
  box-shadow:0 1.6vw 3.6vw rgba(20,28,56,.14), 0 .3vw .8vw rgba(20,28,56,.07);
}
.ao-el{outline:none;}
/* two independent counters: aopage over every slide, aosec over content only,
   so the footer page number and the frame-title eyebrow number stay honest for
   any deck length (no hardcoded slide count). Mutually-exclusive layout rules
   keep counter-increment from clobbering itself. */
.ao-slide[data-ao-layout="title"]{counter-increment:aopage;}
.ao-slide:not([data-ao-layout="title"]){counter-increment:aopage aosec;}
/* slim accent tab at the foot — the one Metropolis flourish (single signature) */
.ao-slide::after{content:"";position:absolute;left:0;bottom:0;height:.5vw;width:14vw;
  background:linear-gradient(90deg,var(--ao-accent),var(--ao-accent-lite));border-top-right-radius:.5vw;}
/* real page number, bottom-right, on content slides (cover stays uncluttered) */
.ao-slide:not([data-ao-layout="title"])::before{
  content:counter(aopage,decimal-leading-zero);position:absolute;right:7.4vw;bottom:3vw;
  font-size:1.5vw;font-weight:600;letter-spacing:.14em;color:#aab3c6;
  font-variant-numeric:tabular-nums;}

/* ---- cover / title slide: deep branded background with layered depth ---- */
.ao-slide[data-ao-layout="title"]{justify-content:center;padding:6.6vw 8vw;color:#f4f7ff;
  background:
    radial-gradient(120% 130% at 82% 8%, rgba(122,154,252,.30), rgba(122,154,252,0) 46%),
    radial-gradient(100% 120% at 0% 106%, rgba(46,74,140,.55), rgba(46,74,140,0) 52%),
    linear-gradient(135deg,var(--ao-cover-1) 0%,var(--ao-cover-2) 58%,var(--ao-cover-3) 100%);}
.ao-slide[data-ao-layout="title"] h1.ao-el{
  font-size:6.2vw;line-height:1.05;font-weight:800;letter-spacing:-.025em;color:#ffffff;
  max-width:92%;text-wrap:balance;margin:0;
  text-shadow:0 .3vw 1.6vw rgba(6,12,28,.35);}
.ao-slide[data-ao-layout="title"] h1.ao-el::before{content:"";display:block;
  width:7.5vw;height:.6vw;border-radius:1vw;background:linear-gradient(90deg,var(--ao-accent-lite),var(--ao-accent-cover));margin-bottom:2.8vw;
  box-shadow:0 .3vw 1.2vw color-mix(in srgb,var(--ao-accent-lite) 50%,transparent);}
.ao-slide[data-ao-layout="title"] p.ao-el{color:#b7c4e6;font-size:2.15vw;line-height:1.55;
  margin:2.6vw 0 0;max-width:84%;}

/* ---- content frame title: heading over a hairline rule with an accent tick ---- */
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{
  font-size:3.5vw;line-height:1.15;font-weight:750;letter-spacing:-.01em;color:#141b2e;
  margin:0 0 3.2vw;padding-bottom:1.5vw;position:relative;text-wrap:balance;
  border-bottom:.16vw solid #dce1ec;}
/* editorial eyebrow: two-digit section index above the title (accent, tracked) */
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{
  content:counter(aosec,decimal-leading-zero);display:block;
  font-size:1.35vw;font-weight:700;letter-spacing:.28em;color:var(--ao-accent);
  margin:0 0 1.1vw;font-variant-numeric:tabular-nums;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{content:"";position:absolute;
  left:0;bottom:-.16vw;width:6.5vw;height:.32vw;background:var(--ao-accent);}

h2.ao-el{font-size:2.5vw;line-height:1.25;font-weight:650;margin:0 0 1.6vw;color:var(--ao-accent);}

/* content lead paragraph → a tinted accent callout block that sets up the slide */
.ao-slide:not([data-ao-layout="title"]) > p.ao-el{
  font-size:2.1vw;line-height:1.7;margin:0 0 2.9vw;color:#37415a;max-width:92%;
  padding:1.15vw 2.1vw;border-left:.34vw solid var(--ao-accent);border-radius:0 .8vw .8vw 0;
  background:linear-gradient(90deg,color-mix(in srgb,var(--ao-accent) 8.5%,transparent),color-mix(in srgb,var(--ao-accent) 2%,transparent) 55%,transparent);
  font-variant-numeric:tabular-nums;text-wrap:pretty;}
p.ao-el[data-ao-note]{font-size:1.65vw;color:#6a7288;border:0;padding:0;background:none;}

/* bullets: airy rows, crisp accent marker, comfortable reading measure */
ul.ao-el{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2.2vw;max-width:93%;}
li.ao-el{position:relative;font-size:2.3vw;line-height:1.5;padding-left:3.8vw;
  color:#212838;font-weight:500;font-variant-numeric:tabular-nums;}
li.ao-el::before{content:"";position:absolute;left:.2vw;top:.52vw;width:1.32vw;height:1.32vw;
  border-radius:.36vw;background:linear-gradient(135deg,var(--ao-accent),var(--ao-accent-lite2));
  box-shadow:0 .22vw .5vw color-mix(in srgb,var(--ao-accent) 40%,transparent),inset 0 .06vw .14vw rgba(255,255,255,.55);}

img.ao-el{max-width:100%;border-radius:1vw;box-shadow:0 1vw 2.4vw rgba(20,28,56,.18);}
/* content-slide illustration: keep a framed "配图" tidy (no overflow) + selectable */
.ao-slide:not([data-ao-layout="title"]) img.ao-el{max-width:70%;max-height:33vw;width:auto;
  display:block;margin:1vw 0 0;}
`.trim();

/** Read the optional deck-wide accent from the slides.md YAML frontmatter. */
export function deckAccentFromMd(md: string): string | null {
  if (!md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  const front = end === -1 ? md : md.slice(0, end);
  const m = /^aoAccent:\s*"?(#?[0-9a-fA-F]{3,6})"?\s*$/m.exec(front);
  if (!m) return null;
  const hex = m[1]!.startsWith('#') ? m[1]! : `#${m[1]}`;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex.toLowerCase() : null;
}

/** Theme-token override so a single accent recolors the whole deck (incl. cover). */
function deckAccentOverrideCss(hex: string): string {
  return (
    `body[data-ao-deck]{` +
    `--ao-accent:${hex};` +
    `--ao-accent-lite:color-mix(in srgb,${hex} 80%,#ffffff);` +
    `--ao-accent-lite2:color-mix(in srgb,${hex} 64%,#ffffff);` +
    `--ao-accent-cover:color-mix(in srgb,${hex} 46%,#ffffff);` +
    `--ao-cover-1:color-mix(in srgb,${hex} 12%,#0a0f1c);` +
    `--ao-cover-2:color-mix(in srgb,${hex} 30%,#0d1730);` +
    `--ao-cover-3:color-mix(in srgb,${hex} 52%,#14213f);` +
    `}`
  );
}

/**
 * Measurable HTML preview for iframe/boxmap — wraps slide fragments from
 * slides.md in the same DOM contract as legacy deck.html.
 */
export function previewHtmlFromSlidesMd(md: string, title = 'Slidev preview'): string {
  const pages = splitSlidevPages(md);
  const slides = pages.join('\n');
  const accent = deckAccentFromMd(md);
  const accentCss = accent ? `\n${deckAccentOverrideCss(accent)}` : '';
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${DECK_BASE_CSS}\n${PREVIEW_FIT_CSS}${accentCss}\n</style>`,
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
