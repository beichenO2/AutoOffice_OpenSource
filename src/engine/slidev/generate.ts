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

/** Decode the base64 payload of a `data:` URI; null when it is not base64-encoded. */
function dataUriBytes(src: string): Buffer | null {
  const m = /^data:[^,]*;base64,(.+)$/i.exec(src);
  if (!m) return null;
  try {
    return Buffer.from(m[1]!, 'base64');
  } catch {
    return null;
  }
}

/** Intrinsic w/h for an SVG data URI (base64 or url-encoded); null if unmeasurable. */
function svgAspect(src: string): number | null {
  let svg = '';
  const b64 = /^data:image\/svg\+xml;base64,(.+)$/.exec(src);
  if (b64) {
    try {
      svg = Buffer.from(b64[1]!, 'base64').toString('utf8');
    } catch {
      return null;
    }
  } else if (/^data:image\/svg\+xml/i.test(src)) {
    try {
      svg = decodeURIComponent(src.replace(/^data:image\/svg\+xml[^,]*,/i, ''));
    } catch {
      return null;
    }
  } else {
    return null;
  }
  let w = NaN;
  let h = NaN;
  const wm = /\bwidth="([\d.]+)"/.exec(svg);
  const hm = /\bheight="([\d.]+)"/.exec(svg);
  if (wm) w = parseFloat(wm[1]!);
  if (hm) h = parseFloat(hm[1]!);
  if (!(w > 0 && h > 0)) {
    const vb = /viewBox="[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
    if (vb) {
      w = parseFloat(vb[1]!);
      h = parseFloat(vb[2]!);
    }
  }
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * Intrinsic w/h for a raster `data:` URI — PNG / GIF / JPEG headers; null otherwise.
 * Lets the two-column media layout know a *raster* figure's shape (e.g. a tall
 * screenshot the user pasted), not just the SVG cards the deck engine emits.
 */
function rasterAspect(src: string): number | null {
  const buf = dataUriBytes(src);
  if (!buf || buf.length < 24) return null;
  // PNG — 8-byte signature; IHDR carries width@16 / height@20 (big-endian).
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? w / h : null;
  }
  // GIF — "GIF8"; logical-screen width@6 / height@8 (little-endian uint16).
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    const w = buf.readUInt16LE(6);
    const h = buf.readUInt16LE(8);
    return w > 0 && h > 0 ? w / h : null;
  }
  // JPEG — walk segment markers to the Start-Of-Frame; height then width (big-endian).
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1]!;
      // SOFn frames (C0..CF) carry the dimensions — except DHT(C4)/JPG(C8)/DAC(CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = buf.readUInt16BE(off + 5);
        const w = buf.readUInt16BE(off + 7);
        return w > 0 && h > 0 ? w / h : null;
      }
      // Standalone markers (SOI/EOI/RSTn) carry no length payload.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) break;
      off += 2 + len;
    }
    return null;
  }
  return null;
}

/**
 * Best-effort intrinsic aspect ratio (w/h) for an image src, used to tune the
 * two-column media layout (a tall figure wants a narrower media column than a wide
 * one). SVG data URIs (what the deck engine emits) and common raster data URIs
 * (PNG / GIF / JPEG — e.g. a pasted screenshot) are measured; anything else
 * returns null (caller falls back to a balanced split).
 */
export function imageAspect(src: string | undefined): number | null {
  if (!src) return null;
  return svgAspect(src) ?? rasterAspect(src);
}

/** True for glyphs that take a full em (CJK, fullwidth forms, Hangul…). */
function isFullWidthCode(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
    (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
    (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
    (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
    (c >= 0xffe0 && c <= 0xffe6) || // fullwidth signs
    (c >= 0x20000 && c <= 0x3fffd) // CJK extension B+
  );
}

/**
 * Approx rendered advance width (px at the 1280 box-measure viewport) of a string in
 * the body/bullet font: full-width glyphs ≈ 26px, everything else (Latin, digits,
 * spaces, `**`/`$` markers) ≈ 13px. Only used to estimate how many lines the copy
 * wraps to when picking the figure density / condensing an over-dense slide.
 */
function textAdvancePx(s: string): number {
  let w = 0;
  for (const ch of s) w += isFullWidthCode(ch.codePointAt(0)!) ? 26 : 13;
  return w;
}

/** Weighted length in "units" (full-width glyph = 2, else 1) — a font-agnostic proxy
 *  for how much horizontal room a string needs, used to budget condensation. */
function textUnits(s: string): number {
  let u = 0;
  for (const ch of s) u += isFullWidthCode(ch.codePointAt(0)!) ? 2 : 1;
  return u;
}

/** Keep `**bold**` / `$…$` markers balanced after a mid-string cut (a dangling
 *  opener would otherwise swallow the rest of the deck or render literal markup). */
function balanceInlineMarkers(s: string): string {
  let out = s;
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out = out.replace(/\s*\*\*\s*\S*$/, '').trimEnd();
  if ((out.match(/\$/g) ?? []).length % 2 === 1) out = out.replace(/\$[^$]*$/, '').trimEnd();
  return out;
}

/**
 * Condense one run of copy to roughly `maxUnits` wide, preferring a natural break so
 * the result still reads as a whole thought: cut at the last sentence terminator in
 * range, else the last clause boundary (+ …), else a hard cap (+ …). Used only to
 * auto-trim genuinely over-dense slides (会话 §20.9) where even the float+reflow
 * layout would clip; light copy is returned unchanged.
 */
function condenseText(text: string, maxUnits: number): string {
  const t = text.trim();
  if (textUnits(t) <= maxUnits) return t;
  const chars = [...t];
  const minUnits = maxUnits * 0.45; // don't cut so early the point is lost
  let acc = 0;
  let hardCut = chars.length;
  let sentEnd = -1;
  let clauseEnd = -1;
  for (let i = 0; i < chars.length; i++) {
    acc += isFullWidthCode(chars[i]!.codePointAt(0)!) ? 2 : 1;
    const ch = chars[i]!;
    if (acc >= minUnits && acc <= maxUnits) {
      if ('。！？!?；;'.includes(ch) || (ch === '.' && !/\d/.test(chars[i + 1] ?? ''))) sentEnd = i;
      else if ('，、,—…)）'.includes(ch)) clauseEnd = i;
    }
    if (acc > maxUnits) {
      hardCut = i;
      break;
    }
  }
  if (sentEnd >= 0) return balanceInlineMarkers(chars.slice(0, sentEnd + 1).join('').trim());
  const at = clauseEnd >= 0 ? clauseEnd + 1 : hardCut;
  const head = balanceInlineMarkers(chars.slice(0, at).join('').replace(/[，、,—…\s]+$/u, '').trim());
  return head + '…';
}

/**
 * Estimate how many text lines the slide copy wraps to inside the *sparse* (big
 * full-height figure) two-column layout, whose text column width depends on the media
 * mode (tall figure → widest copy column, wide figure → narrowest). This is the
 * signal for figure density: a tall screenshot with light copy stays under the
 * threshold (keeps the big figure), while a genuinely text-heavy slide — many bullets
 * OR a few long ones, like a real GLM slide — trips it and floats a shorter figure so
 * the copy reflows. Calibrated against measured overflow (see 会话 §20.7).
 */
function estimateBodyLines(spec: SlideSpec, mode: 'tall' | 'square' | 'wide'): number {
  const colPx = mode === 'tall' ? 600 : mode === 'wide' ? 370 : 498;
  let lines = 0;
  for (const e of spec.elements) {
    if (e.type === 'bullet' || e.type === 'paragraph' || e.type === 'subheading') {
      lines += Math.max(1, Math.ceil(textAdvancePx(e.text ?? '') / colPx));
      if (e.type === 'paragraph') lines += 1; // lead callout block padding overhead
    } else if (e.type === 'formula') {
      lines += 2; // a display formula block is roughly two lines tall
    }
  }
  return lines;
}

/** One Slidev slide page — HTML fragment with ao ids (no outer document). */
function renderSlideMarkdownBody(spec: SlideSpec, index: number): string {
  const slideId = `slide-${index + 1}`;
  const page = index + 1;
  const layout = spec.layout ?? 'content';
  const hasHeading = spec.elements.some((e) => e.type === 'heading' || e.type === 'subheading');
  const reveal = layout !== 'title' && !!spec.reveal;

  // When a content slide pairs an image with text, lay it out as two columns — copy on
  // the LEFT, and the figure as a big panel on the RIGHT, vertically centred on the
  // slide midline. The figure is the *soul* of a slide, so it always stays large and is
  // never shrunk or floated into a corner. The copy lives in a width-capped left column
  // (guaranteed gutter → it never collides with the figure). `data-ao-media` (from the
  // image aspect) picks the column widths.
  //
  // Density is handled *on the copy*, not the figure: if the copy is too tall for its
  // left column, first tighten the type (`data-ao-dense` = smaller font + leading), and
  // only if it *still* won't fit, auto-condense each block to a natural break so it fits
  // ("字多就删减/换行，不撞图"; 会话 §20.10). Thresholds are estimated wrapped-line
  // counts in the left column, calibrated against measured overflow.
  const imageEl = spec.elements.find((e) => e.type === 'image');
  const specBullets = spec.elements.filter((e) => e.type === 'bullet').length;
  const leadBlocks = spec.elements.filter(
    (e) => e.type === 'paragraph' || e.type === 'subheading' || e.type === 'formula',
  ).length;
  const hasText = specBullets > 0 || leadBlocks > 0;
  let mediaAttr = '';
  let dense = false;
  let mode: 'tall' | 'square' | 'wide' = 'square';
  let workSpec = spec;
  if (layout !== 'title' && imageEl && hasText) {
    const ar = imageAspect(imageEl.src);
    mode = ar == null ? 'square' : ar <= 0.9 ? 'tall' : ar < 1.4 ? 'square' : 'wide';
    const lines = estimateBodyLines(spec, mode);
    dense = lines > 6; // won't comfortably fit the left column at full size → tighten type
    if (lines > 9) {
      // even tightened it overflows → condense each block to the column's capacity,
      // trimming as gently as possible (start ~4 lines/block, tighten only until it fits)
      const colUnits = (mode === 'tall' ? 600 : mode === 'wide' ? 370 : 498) / 13;
      const condenseAll = (u: number): SlideSpec => ({
        ...spec,
        elements: spec.elements.map((e) =>
          (e.type === 'bullet' || e.type === 'paragraph') && e.text
            ? { ...e, text: condenseText(e.text, Math.round(e.type === 'paragraph' ? u * 1.4 : u)) }
            : e,
        ),
      });
      let maxUnits = Math.round(colUnits * 4);
      workSpec = condenseAll(maxUnits);
      while (estimateBodyLines(workSpec, mode) > 8 && maxUnits > colUnits * 0.6) {
        maxUnits -= Math.max(6, Math.round(colUnits * 0.4));
        workSpec = condenseAll(maxUnits);
      }
    }
    mediaAttr = ` data-ao-media="${mode}"${dense ? ' data-ao-dense="1"' : ''}`;
  }

  const bullets = workSpec.elements.filter((e) => e.type === 'bullet');
  const nonBullets = workSpec.elements.filter((e) => e.type !== 'bullet');

  // The figure is absolutely positioned (out of flow), so its source order is
  // irrelevant to layout — keep the natural element order. Every element keeps its
  // data-ao-id and stays a flat sibling → box-select / edit contract + sourcemap intact.
  const flowEls = nonBullets;

  const parts: string[] = [];
  // Content slides carry a title in the spec but never rendered it — give each a
  // proper frame title (editable, stable `slide-N-title` id) so the deck reads
  // like a real presentation instead of bare bullets.
  if (layout !== 'title' && spec.title && !hasHeading) {
    parts.push(renderElement(slideId, { id: 'title', type: 'heading', text: spec.title })); // title never reveals
  }
  for (const el of flowEls) parts.push(renderElement(slideId, el, reveal));
  if (bullets.length > 0) {
    const lis = bullets.map((b) => renderElement(slideId, b, reveal)).join('\n');
    parts.push(
      `<ul data-ao-id="${slideId}-bullets" data-ao-type="list" class="ao-el">\n${lis}\n</ul>`,
    );
  }
  return [
    `<div class="ao-slide" data-ao-id="${slideId}" data-ao-type="slide" data-ao-page="${page}" data-ao-layout="${layout}"${mediaAttr}>`,
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
/* content-slide illustration: fit-inside instead of clip. object-fit:contain +
   height:auto keeps aspect ratio; a bounded max-height and flexible shrink mean a
   too-tall image scales down to fit the frame rather than overflowing the slide
   (overflow:hidden used to crop tall images — this is the fix). */
.ao-slide:not([data-ao-layout="title"]) img.ao-el{max-width:100%;max-height:34vw;width:auto;height:auto;
  object-fit:contain;object-position:center;display:block;margin:1.4vw auto 0;flex:0 1 auto;min-height:0;}

/* inline emphasis (the #bold fix): GLM authors keywords as **bold** — render it as
   real emphasis, not literal asterisks. Bold keywords pick up the deck accent on
   content slides so each point has a clear focal word. */
.ao-slide strong{font-weight:800;}
.ao-slide:not([data-ao-layout="title"]) p.ao-el strong,
.ao-slide:not([data-ao-layout="title"]) li.ao-el strong{color:var(--ao-accent);}
.ao-slide em{font-style:italic;}
.ao-slide code{font-family:ui-monospace,SFMono-Regular,Menlo,"Courier New",monospace;
  font-size:.9em;background:color-mix(in srgb,var(--ao-accent) 12%,transparent);
  padding:.06em .38em;border-radius:.34em;}

/* image + text content slide → the copy stays on the LEFT and the figure is a LARGE
   panel on the RIGHT, centred on the slide's vertical midline — the "字排左·图排右"
   layout. The figure is the soul of the slide, so it stays big and prominent (never
   shrinks to a corner or floats under the copy). The copy is width-capped to its own
   left column, guaranteeing a gap so it never collides with the figure; when the copy
   is too long the renderer condenses it to fit (会话 §20.10) rather than shrinking the
   figure. Absolute positioning keeps the flat DOM / data-ao-id box-select contract. */
/* the copy column is vertically centred so it sits on the same midline as the figure —
   a balanced split (symmetric whitespace) instead of top-heavy copy + a lonely centred
   figure that looked "empty". */
.ao-slide[data-ao-media]{display:flex;flex-direction:column;justify-content:center;}
.ao-slide[data-ao-media] > .ao-el:not(img){max-width:42vw;}
.ao-slide[data-ao-media="tall"] > .ao-el:not(img){max-width:48vw;}
.ao-slide[data-ao-media="wide"] > .ao-el:not(img){max-width:32vw;}
/* the figure panel — big, right, vertically centred on the midline. It hugs its own
   aspect (auto on one axis) so there is no letterbox; max-width/height caps keep the
   ~2–3vw gutter to the copy so nothing overlaps. Each mode sets BOTH caps so a wide/
   short figure fills as much width as the gutter allows (else it looks tiny + empty). */
.ao-slide[data-ao-media] > img.ao-el{position:absolute;top:50%;right:7.4vw;
  transform:translateY(-50%);width:auto;height:40vw;max-width:40vw;max-height:46vw;
  object-fit:contain;object-position:center;margin:0;}
.ao-slide[data-ao-media="tall"] > img.ao-el{height:46vw;width:auto;max-width:34vw;}
.ao-slide[data-ao-media="wide"] > img.ao-el{height:auto;width:51vw;max-width:51vw;max-height:38vw;}
/* bullet rhythm in the left column */
.ao-slide[data-ao-media] > ul.ao-el{gap:1.9vw;}
.ao-slide[data-ao-media] li.ao-el{font-size:2.05vw;line-height:1.44;padding-left:3.1vw;}
.ao-slide[data-ao-media] li.ao-el::before{top:.44vw;width:1.16vw;height:1.16vw;}

/* ---- text-dense figure slide (data-ao-dense) ----
   The figure STAYS big + centred (it's the soul); only the copy tightens — smaller
   type, tighter leading and gaps — so more of it fits the left column before the
   renderer has to condense it (会话 §20.10). No float, no reflow under the figure, so
   the copy never collides with it. */
.ao-slide[data-ao-media][data-ao-dense] > ul.ao-el{gap:0.95vw;}
.ao-slide[data-ao-media][data-ao-dense] li.ao-el{font-size:1.9vw;line-height:1.32;}
.ao-slide[data-ao-media][data-ao-dense] li.ao-el::before{top:.34vw;}
.ao-slide[data-ao-media][data-ao-dense] > p.ao-el{font-size:1.8vw;line-height:1.46;margin:0 0 1.5vw;}
.ao-slide[data-ao-media][data-ao-dense] > h2.ao-el{font-size:2.2vw;margin:0 0 1vw;}
`.trim();

/**
 * Print stylesheet — the WYSIWYG *vector* export path. Chromium `page.pdf()` renders
 * this same preview HTML through print media, so the exported PDF looks like the live
 * /aoide/ preview AND keeps selectable / searchable text (small, crisp at any zoom),
 * instead of the old bare Slidev theme or a screenshot bitmap. With a 1280×720 print
 * page, `100vw`=1280 and `56.25vw`=720, so each `.ao-slide` fills exactly one page.
 * Screen preview is untouched — every rule here is scoped to `@media print`.
 */
const DECK_PRINT_CSS = `
@media print {
  html,body{margin:0 !important;padding:0 !important;background:#fff !important;overflow:visible !important;}
  body[data-ao-deck]{background:#fff !important;}
  .ao-slide{
    margin:0 !important;box-shadow:none !important;
    break-inside:avoid;page-break-inside:avoid;
    break-after:page;page-break-after:always;
  }
  .ao-slide:last-child{break-after:auto;page-break-after:auto;}
}
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
 * Deck-wide *visual style* presets (the "科技风 / 党政风 / 商务简约" ask). Unlike
 * aoAccent (which only shifts the accent hue), a style pack restyles the whole
 * deck's look-and-feel — accent + cover gradient + FONT family + slide
 * background/ink + bullet treatment — by overriding the theme tokens and a few
 * key selectors. Each pack is injected after PREVIEW_FIT_CSS (so it wins) but
 * before the explicit accentCss (so an explicit aoAccent can still fine-tune the
 * accent on top of a pack). DOM/box-select contract is untouched (CSS only).
 */
export const DECK_STYLE_PACKS = {
  // 科技风 — clean, LIGHT, professional (for writing about a new technology/its
  // application): white slides, one restrained tech-blue accent (#2563eb), crisp
  // sans, uppercase blue eyebrow + thin blue rule, tidy blue square markers, a
  // clean figure card (fine border + faint blue shadow). Cover = professional deep
  // blue (not gloomy black), not flashy. "科技感适度" not dramatic.
  tech: `
body[data-ao-deck]{
  --ao-accent:#2563eb;--ao-accent-lite:#5b8def;--ao-accent-lite2:#84a9f4;--ao-accent-cover:#a9c4f8;
  --ao-cover-1:#0b2350;--ao-cover-2:#123f8f;--ao-cover-3:#1d4ed8;
  background:#eef2f8;
  font-family:"Inter","Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;}
.ao-slide{background:#ffffff;color:#111c2e;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{color:#0f1b2d;border-bottom:.12vw solid #e3e9f2;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{color:var(--ao-accent);letter-spacing:.26em;text-transform:uppercase;font-weight:700;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{background:var(--ao-accent);height:.26vw;width:6.5vw;}
.ao-slide:not([data-ao-layout="title"]) > p.ao-el{color:#41506a;}
.ao-slide:not([data-ao-layout="title"]) li.ao-el{color:#26344b;}
body[data-ao-deck] li.ao-el::before{background:var(--ao-accent);border-radius:.16vw;box-shadow:none;width:1vw;height:1vw;top:.62vw;}
.ao-slide[data-ao-media] li.ao-el::before{width:1vw;height:1vw;top:.56vw;}
body[data-ao-deck] img.ao-el{border-radius:.7vw;border:.1vw solid #dbe3f0;box-shadow:0 1vw 2.4vw rgba(37,99,235,.12);}
/* ── 版式 · 科技 = HERO（真·换版式，非换皮）──
   图文页构图彻底不同于其它风格：右半幅「大图出血面板」直贴幻灯右/上/下三边，浅蓝底衬托
   （不裁切、不留白边），左半是大号陈述式标题 + 精炼要点；页码移到左下避免压在大图上。
   product-launch / Stripe·Linear 的「图是主角」发布式版式。文字列与大图之间留固定沟槽→不碰撞。*/
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{font-size:3.7vw;}
body[data-ao-style="tech"] .ao-slide[data-ao-media] > h1.ao-el{font-size:4vw;line-height:1.1;max-width:46vw;}
body[data-ao-style="tech"] .ao-slide[data-ao-media] > .ao-el:not(img){max-width:44vw;}
body[data-ao-style="tech"] .ao-slide[data-ao-media] > img.ao-el{
  top:0;right:0;bottom:0;transform:none;margin:0;
  width:46vw;height:100%;max-width:46vw;max-height:100%;
  border:0;border-left:.14vw solid #d6e2f6;border-radius:0;box-shadow:none;
  background:#eef4ff;object-fit:contain;object-position:center;padding:2.6vw;}
body[data-ao-style="tech"] .ao-slide[data-ao-media]:not([data-ao-layout="title"])::before{right:auto;left:7.4vw;}`,
  // 党政风 — 公文/红头，遵 GB/T 9704-2012《党政机关公文格式》(该国标本身还引用 GB/T 15834
  // 标点、GB/T 15835 数字、GB 3100-3102 计量单位)。国标签名元素落到版式：①「红色反线」——
  // 发文字号下一条与版心等宽的红色分隔线，公文最醒目的识别符 ②标题居中·方正小标宋(衬线)
  // ③正文/要点仿宋_GB2312 黑字 ④层次序数「一、二、三」(非装饰方块) ⑤页码 4 号宋体「— N —」
  // (数字左右一字线)。庄重对称、限制最死→最正式好看。图=白衬红边裱框(无圆角无阴影)。
  gov: `
body[data-ao-deck]{
  --ao-accent:#b01e23;--ao-accent-lite:#c94a4f;--ao-accent-lite2:#d97b7f;--ao-accent-cover:#e6a9ac;
  --ao-cover-1:#3a0a0c;--ao-cover-2:#7a1418;--ao-cover-3:#9e1b20;
  background:#e7ded1;
  font-family:"FangSong","STFangsong","FangSong_GB2312","Noto Serif SC","Songti SC","SimSun",serif;}
.ao-slide{background:#fbf8f2;color:#1c1613;}
.ao-slide:not([data-ao-layout="title"]) > p.ao-el{color:#2b2320;background:none;border-left-color:var(--ao-accent);}
.ao-slide:not([data-ao-layout="title"]) li.ao-el{color:#231c18;}
body[data-ao-deck] img.ao-el{border-radius:0;box-shadow:none;background:#ffffff;padding:.5vw;
  border:.16vw solid color-mix(in srgb,var(--ao-accent) 55%,#b8a06a);}
/* ── 版式 · 党政 = 公文/红头（真·换版式，遵 GB/T 9704-2012《党政机关公文格式》）── */
/* 标题：方正小标宋（衬线）、居中、庄重；给版头「红色反线」留白 */
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"]){padding-top:7.8vw;}
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el{
  font-family:"STZhongsong","Songti SC","Noto Serif SC","SimSun",serif;
  color:#1c1613;text-align:center;font-weight:700;letter-spacing:.03em;border-bottom:0;margin:0 0 3vw;}
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{display:none;}
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{
  left:50%;transform:translateX(-50%);bottom:-1vw;width:8vw;height:.3vw;background:var(--ao-accent);}
/* 「红色反线」：与版心等宽（左右 7.4vw 页边），编排在版头 → 公文识别符 */
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"])::after{
  content:"";left:7.4vw;right:7.4vw;top:4.6vw;bottom:auto;width:auto;height:.34vw;
  background:var(--ao-accent);border-radius:0;}
/* 层次序数「一、二、三」黑体红字（公文条目化，非装饰方块）*/
body[data-ao-style="gov"] ul.ao-el{counter-reset:aoli;}
body[data-ao-style="gov"] li.ao-el{padding-left:3vw;}
body[data-ao-style="gov"] li.ao-el::before{
  counter-increment:aoli;content:counter(aoli,simp-chinese-informal) "、";
  left:0;top:0;width:auto;height:auto;background:none;border-radius:0;box-shadow:none;
  color:var(--ao-accent);font-family:"SimHei","Heiti SC","Noto Sans CJK SC",sans-serif;
  font-weight:700;font-size:1.7vw;line-height:1.5;}
body[data-ao-style="gov"] .ao-slide[data-ao-media] li.ao-el::before{font-size:1.5vw;}
/* 页码：公文式「— N —」4 号宋体、居中版心下（数字左右一字线）*/
body[data-ao-style="gov"] .ao-slide:not([data-ao-layout="title"])::before{
  content:"— " counter(aopage) " —";left:0;right:0;bottom:2.4vw;text-align:center;
  color:#5b504a;font-family:"SimSun","Songti SC",serif;font-weight:400;letter-spacing:.1em;}
/* 封面 = 红头文件：米底、发文机关式红色小标宋 + 红色反线 + 居中标题 */
body[data-ao-style="gov"] .ao-slide[data-ao-layout="title"]{
  background:#fbf8f2;color:#1c1613;text-align:center;align-items:center;}
body[data-ao-style="gov"] .ao-slide[data-ao-layout="title"] h1.ao-el{
  color:#7a1418;font-family:"STZhongsong","Songti SC","Noto Serif SC","SimSun",serif;text-shadow:none;max-width:88%;}
body[data-ao-style="gov"] .ao-slide[data-ao-layout="title"] h1.ao-el::before{
  width:60vw;height:.4vw;background:var(--ao-accent);border-radius:0;box-shadow:none;margin:0 auto 3.2vw;}
body[data-ao-style="gov"] .ao-slide[data-ao-layout="title"] p.ao-el{color:#463a33;margin-left:auto;margin-right:auto;}`,
  // 商务风 — 咨询式（麦肯锡/BCG 范）：干净白底、克制藏青。真·换版式 =「页眉栏 + 左侧识别条」：
  // 左侧竖直藏青识别条（企业标识带，贯穿整页）+ 全幅页眉细线（行动式标题像信笺页眉）+ 藏青大写
  // eyebrow kicker。构图区别于基础版（短 tick + 脚标）。图=柔 navy 阴影卡片（中圆角）、小方点。
  business: `
body[data-ao-deck]{
  --ao-accent:#1f4e79;--ao-accent-lite:#3a6ea5;--ao-accent-lite2:#5b8bc0;--ao-accent-cover:#a9c3de;
  --ao-cover-1:#0c1a2c;--ao-cover-2:#123253;--ao-cover-3:#1c4c7c;
  background:#eef1f5;
  font-family:"Helvetica Neue","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;}
.ao-slide{background:#ffffff;color:#1a2433;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{color:#132132;}
body[data-ao-deck] li.ao-el::before{background:var(--ao-accent);border-radius:.28vw;box-shadow:none;}
body[data-ao-deck] img.ao-el{border-radius:.9vw;border:0;box-shadow:0 1.2vw 2.8vw rgba(20,40,70,.18);}
/* ── 版式 · 商务 = 咨询式「页眉栏 + 左侧识别条」(真·换版式，非换皮) ── */
/* 左侧竖直藏青识别条（复用 foot tab ::after → 左侧竖条，贯穿整页）+ 让出左边距 */
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"]){padding-left:9vw;}
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"])::after{
  left:0;top:0;bottom:0;width:.62vw;height:auto;background:var(--ao-accent);border-radius:0;}
/* 标题 = 页眉栏：全幅细蓝底线 + 藏青大写 kicker（信笺页眉感）*/
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el{
  font-size:3.3vw;border-bottom:.14vw solid #cfd8e6;padding-bottom:1.5vw;margin:0 0 2.9vw;}
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{
  letter-spacing:.24em;text-transform:uppercase;color:var(--ao-accent);font-weight:700;font-size:1.2vw;}
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{
  left:0;bottom:-.14vw;width:100%;height:.14vw;background:#cfd8e6;}
/* 页码对齐识别条留白 */
body[data-ao-style="business"] .ao-slide:not([data-ao-layout="title"])::before{left:auto;right:7.4vw;}`,
  // 学术风（国标向）— 顶会/基金答辩规范：纯白幻灯、深蓝主色 + 学术红强调（蓝主红强调，
  // ≤3 色、高对比）、无衬线（微软雅黑/思源黑体级）、清晰分节 eyebrow、图=图版（细边+图注感）、
  // 项目符利落方点。对应 CVPR/NSFC「逻辑清晰、重点突出、图表为主、字大可读」。
  academic: `
body[data-ao-deck]{
  --ao-accent:#16367a;--ao-accent-lite:#3a5aa0;--ao-accent-lite2:#5f7cbb;--ao-accent-cover:#a7b9de;
  --ao-cover-1:#0a1f4a;--ao-cover-2:#12326e;--ao-cover-3:#1c47a0;
  background:#eef1f6;
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Hiragino Sans GB",system-ui,sans-serif;}
.ao-slide{background:#ffffff;color:#1a2230;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{color:#12244a;border-bottom:.16vw solid color-mix(in srgb,var(--ao-accent) 45%,#dfe4ee);}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{color:var(--ao-accent);letter-spacing:.2em;}
.ao-slide:not([data-ao-layout="title"]) > p.ao-el{color:#3a4560;}
.ao-slide:not([data-ao-layout="title"]) li.ao-el{color:#26304a;}
.ao-slide:not([data-ao-layout="title"]) li.ao-el strong,.ao-slide:not([data-ao-layout="title"]) p.ao-el strong{color:#c0392b;}
body[data-ao-deck] img.ao-el{border-radius:.3vw;border:.1vw solid #ccd4e2;box-shadow:0 .4vw 1.1vw rgba(20,40,80,.10);}
/* ── 版式 · 学术/国标 = RIGOROUS（对标 CVPR/NeurIPS + 国自然基金答辩规范）──
   要点改「数字编号」条目（研究内容/技术路线的条目化，非装饰方块）；分节 eyebrow 读作「01 /」；
   图=正式图版（顶部一道 accent 细线，如 Figure 版头）；正文/要点设可读字号下限（大字可读，
   ≤3 色·蓝主红强调·高对比）。保守对齐栅格，严谨不花哨。*/
body[data-ao-style="academic"] ul.ao-el{counter-reset:aoli;}
body[data-ao-style="academic"] li.ao-el{padding-left:3.5vw;}
body[data-ao-style="academic"] li.ao-el::before{
  counter-increment:aoli;content:counter(aoli);
  left:0;top:.1vw;width:2.2vw;height:2.2vw;border-radius:.3vw;
  background:var(--ao-accent);box-shadow:none;
  color:#fff;font-size:1.3vw;font-weight:700;line-height:2.2vw;text-align:center;
  font-variant-numeric:tabular-nums;}
body[data-ao-style="academic"] .ao-slide[data-ao-media] li.ao-el::before{width:2vw;height:2vw;line-height:2vw;top:0;}
body[data-ao-style="academic"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el::before{content:counter(aosec,decimal-leading-zero) "  /";}
body[data-ao-style="academic"] .ao-slide[data-ao-media] > img.ao-el{border-top:.34vw solid var(--ao-accent);}
/* 可读字号下限：即使密集页也不把要点缩到不可读（顶会/基金：正文≥可读线） */
body[data-ao-style="academic"] .ao-slide[data-ao-media][data-ao-dense] li.ao-el{font-size:2vw;line-height:1.4;}`,
  // 极简风 — minimalist: pure white, near-black monochrome, clean sans, generous
  // whitespace; the figure is un-framed (no border/shadow/rounding) with extra air
  // around it; dash markers; hairline rules (性冷淡 / 大留白).
  minimal: `
body[data-ao-deck]{
  --ao-accent:#111827;--ao-accent-lite:#4b5563;--ao-accent-lite2:#6b7280;--ao-accent-cover:#9ca3af;
  --ao-cover-1:#0a0a0b;--ao-cover-2:#18181b;--ao-cover-3:#26262b;
  background:#f4f4f5;
  font-family:"Helvetica Neue","Inter","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;}
.ao-slide{background:#ffffff;color:#18181b;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{color:#0b0b0c;font-weight:700;border-bottom:.1vw solid #e4e4e7;}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{height:.2vw;background:#111827;}
.ao-slide:not([data-ao-layout="title"]) > p.ao-el{color:#3f3f46;background:none;border-left-color:#d4d4d8;}
.ao-slide:not([data-ao-layout="title"]) li.ao-el{color:#27272a;}
.ao-slide:not([data-ao-layout="title"]) ul.ao-el{gap:2.7vw;}
body[data-ao-deck] li.ao-el::before{background:#111827;border-radius:0;box-shadow:none;width:1.5vw;height:.16vw;top:1.05vw;}
.ao-slide[data-ao-media] li.ao-el::before{width:1.5vw;height:.16vw;top:1vw;}
body[data-ao-deck] img.ao-el{border-radius:0;border:0;box-shadow:none;}
/* ── 版式 · 极简 = TITLE-DOMINANT（真·换版式，非换皮）──
   构图与其它风格相反：超大标题主导（占上半屏气场）+ 极大留白 + 图克制偏小、靠右点缀，
   编辑式负空间。纯文字页标题满幅特大；图文页标题在左栏放大、图小居右，绝不喧宾夺主。*/
.ao-slide{padding:8.4vw 9vw 7.4vw;}
body[data-ao-style="minimal"] .ao-slide:not([data-ao-layout="title"]) > h1.ao-el{
  font-size:5.4vw;line-height:1.04;font-weight:800;letter-spacing:-.02em;margin:0 0 4vw;padding-bottom:2.2vw;}
body[data-ao-style="minimal"] .ao-slide:not([data-ao-layout="title"]) > p.ao-el{font-size:1.95vw;line-height:1.75;}
body[data-ao-style="minimal"] .ao-slide:not([data-ao-layout="title"]) ul.ao-el{gap:2.5vw;}
body[data-ao-style="minimal"] .ao-slide[data-ao-media] > img.ao-el{
  height:auto;width:30vw;max-width:30vw;max-height:34vw;right:9vw;top:56%;}
body[data-ao-style="minimal"] .ao-slide[data-ao-media] > .ao-el:not(img){max-width:50vw;}
/* 图文页竖向更紧凑：仍是大标题（>默认），但收 padding/标题/间距给要点+图腾出空间，不超版心 */
body[data-ao-style="minimal"] .ao-slide[data-ao-media]{padding-top:6.2vw;padding-bottom:5.4vw;}
body[data-ao-style="minimal"] .ao-slide[data-ao-media] > h1.ao-el{font-size:4.2vw;margin:0 0 2.2vw;padding-bottom:1.6vw;}
body[data-ao-style="minimal"] .ao-slide[data-ao-media] > p.ao-el{margin:0 0 1.9vw;}
body[data-ao-style="minimal"] .ao-slide[data-ao-media] ul.ao-el{gap:1.9vw;}`,
} as const;

export type DeckStyleId = keyof typeof DECK_STYLE_PACKS;

/** zh/en aliases → canonical pack id (also accepted directly in frontmatter). */
const DECK_STYLE_ALIASES: Record<string, DeckStyleId> = {
  tech: 'tech', 科技风: 'tech', 科技: 'tech', 未来感: 'tech', 极客风: 'tech', technology: 'tech', futuristic: 'tech',
  gov: 'gov', 党政风: 'gov', 党政: 'gov', 政务: 'gov', 政务风: 'gov', 公文: 'gov', 公文风: 'gov', 公文格式: 'gov', 红头文件: 'gov', 红头: 'gov', 庄重: 'gov', official: 'gov', government: 'gov',
  business: 'business', 商务: 'business', 商务简约: 'business', 商业: 'business', 企业: 'business', 简约商务: 'business', corporate: 'business',
  academic: 'academic', 学术风: 'academic', 学术: 'academic', 论文: 'academic', 科研: 'academic', 学院: 'academic',
  国标: 'academic', 国标风: 'academic', 顶会: 'academic', 会议: 'academic', 基金: 'academic', 基金申请: 'academic', 答辩: 'academic', 严谨: 'academic', conference: 'academic', grant: 'academic',
  minimal: 'minimal', 极简风: 'minimal', 极简: 'minimal', 简约: 'minimal', 性冷淡: 'minimal', 极简主义: 'minimal',
};

/** Normalize any alias / id / Chinese name to a canonical pack id (or null). */
export function normalizeDeckStyleId(raw: string): DeckStyleId | null {
  const key = (raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (key in DECK_STYLE_PACKS) return key as DeckStyleId;
  return DECK_STYLE_ALIASES[key] ?? null;
}

/** Read the optional deck-wide style preset from the slides.md YAML frontmatter. */
export function deckStyleFromMd(md: string): DeckStyleId | null {
  if (!md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  const front = end === -1 ? md : md.slice(0, end);
  const m = /^aoStyle:\s*"?([A-Za-z\u4e00-\u9fff]+)"?\s*$/m.exec(front);
  return m ? normalizeDeckStyleId(m[1]!) : null;
}

/**
 * Measurable HTML preview for iframe/boxmap — wraps slide fragments from
 * slides.md in the same DOM contract as legacy deck.html.
 */
export function previewHtmlFromSlidesMd(md: string, title = 'Slidev preview'): string {
  const pages = splitSlidevPages(md);
  const slides = pages.join('\n');
  const styleId = deckStyleFromMd(md);
  const styleCss = styleId ? `\n${DECK_STYLE_PACKS[styleId].trim()}` : '';
  const accent = deckAccentFromMd(md);
  const accentCss = accent ? `\n${deckAccentOverrideCss(accent)}` : '';
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${DECK_BASE_CSS}\n${PREVIEW_FIT_CSS}${styleCss}${accentCss}\n${DECK_PRINT_CSS}\n</style>`,
    '</head>',
    // data-ao-style lets a style pack own not just the *skin* but the *layout* — its
    // rules (`body[data-ao-style="tech"] .ao-slide…`) outrank the base media layout, so
    // each preset can restructure the composition (科技=hero 大图 / 极简=超大标题·大留白 /
    // 学术=国标严谨编号版式), not merely recolour it. DOM stays flat → box-select intact.
    `<body data-ao-deck="1"${styleId ? ` data-ao-style="${styleId}"` : ''}>`,
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
