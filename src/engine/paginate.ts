/**
 * DeckSpec pagination — wrap + 分主题分页.
 *
 * Ultra-dense slides keep full body copy (CSS wraps). Overflow is handled by
 * splitting into extra slides: at subheading theme boundaries when present,
 * otherwise by estimated wrap-line budget. Images stay on the first page.
 */
import type { DeckSpec, SlideElementSpec, SlideSpec } from './html/generate.js';

/** Estimated wrap lines that still fit one content page (ultra path starts above this). */
export const SLIDE_BODY_LINE_CAP = 9;

export type DensityMode = 'tall' | 'square' | 'wide' | 'full';

export interface PaginateOptions {
  /** Column mode for the *original* slide (generate.ts passes image-aspect mode). */
  densityMode?: (slide: SlideSpec) => DensityMode;
}

const FLOW_TYPES = new Set<SlideElementSpec['type']>(['bullet', 'paragraph', 'formula', 'subheading']);

/** True for glyphs that take a full em (CJK, fullwidth forms, Hangul…). */
function isFullWidthCode(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}

/** Approx rendered advance width (px at the 1280 box-measure viewport). */
function textAdvancePx(s: string): number {
  let w = 0;
  for (const ch of s) w += isFullWidthCode(ch.codePointAt(0)!) ? 26 : 13;
  return w;
}

/** Column used to estimate wrap — same calibration as the Slidev density ladder. */
function columnPx(mode: DensityMode): number {
  switch (mode) {
    case 'tall':
      return 600;
    case 'wide':
      return 370;
    case 'square':
      return 498;
    case 'full':
      return 960;
  }
}

function isFlow(el: SlideElementSpec): boolean {
  return FLOW_TYPES.has(el.type);
}

function elementLines(el: SlideElementSpec, mode: DensityMode): number {
  if (el.type === 'bullet' || el.type === 'paragraph' || el.type === 'subheading') {
    let n = Math.max(1, Math.ceil(textAdvancePx(el.text ?? '') / columnPx(mode)));
    if (el.type === 'paragraph') n += 1;
    return n;
  }
  if (el.type === 'formula') return 2;
  return 0;
}

/**
 * Estimate how many text lines the slide copy wraps to in the given column mode.
 * Heading / image / note do not count (frame chrome, not body).
 */
export function estimateBodyLines(spec: SlideSpec, mode: DensityMode): number {
  let lines = 0;
  for (const e of spec.elements) lines += elementLines(e, mode);
  return lines;
}

function resolveMode(slide: SlideSpec, options?: PaginateOptions): DensityMode {
  if (options?.densityMode) return options.densityMode(slide);
  return slide.elements.some((e) => e.type === 'image') ? 'square' : 'full';
}

function continuedTitle(base: string, index: number, total: number): string {
  if (total <= 1 || index === 0) return base;
  return `${base}（${index + 1}/${total}）`;
}

function cloneEl(el: SlideElementSpec): SlideElementSpec {
  return { ...el };
}

function flowOf(elements: SlideElementSpec[]): SlideElementSpec[] {
  return elements.filter(isFlow);
}

/** Split flow elements at each subheading (preamble before the first sub is its own group). */
function splitThemeGroups(elements: SlideElementSpec[]): SlideElementSpec[][] {
  const groups: SlideElementSpec[][] = [];
  let cur: SlideElementSpec[] = [];
  for (const el of flowOf(elements)) {
    if (el.type === 'subheading' && cur.length > 0) {
      groups.push(cur);
      cur = [];
    }
    cur.push(el);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** Pack flow elements so each page stays within `cap` estimated lines. */
function packFlow(flow: SlideElementSpec[], firstMode: DensityMode, cap: number): SlideElementSpec[][] {
  if (flow.length === 0) return [];
  const pages: SlideElementSpec[][] = [];
  let cur: SlideElementSpec[] = [];
  let lines = 0;
  for (const el of flow) {
    const mode = pages.length === 0 ? firstMode : 'full';
    const n = elementLines(el, mode);
    if (cur.length > 0 && lines + n > cap) {
      pages.push(cur);
      cur = [];
      lines = 0;
    }
    const mode2 = pages.length === 0 ? firstMode : 'full';
    cur.push(el);
    lines += elementLines(el, mode2);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function assemblePages(slide: SlideSpec, chunks: SlideElementSpec[][]): SlideSpec[] {
  const n = chunks.length;
  if (n <= 1) return [slide];

  const heading = slide.elements.find((e) => e.type === 'heading');
  const image = slide.elements.find((e) => e.type === 'image');
  const extras = slide.elements.filter((e) => e.type !== 'heading' && e.type !== 'image' && !isFlow(e));
  const injectTitle = chunks.some((c) => c.some((e) => e.type === 'subheading')) && !heading;

  return chunks.map((chunk, i) => {
    const title = continuedTitle(slide.title, i, n);
    const elements: SlideElementSpec[] = [];
    if (heading) {
      elements.push({ ...heading, text: i === 0 ? (heading.text ?? title) : title });
    } else if (injectTitle) {
      elements.push({ id: 'title', type: 'heading', text: title });
    }
    if (i === 0) {
      for (const e of extras) elements.push(cloneEl(e));
    }
    for (const e of chunk) elements.push(cloneEl(e));
    if (i === 0 && image) elements.push(cloneEl(image));
    return { ...slide, title, elements };
  });
}

function paginateSlide(slide: SlideSpec, options?: PaginateOptions): SlideSpec[] {
  if (slide.layout === 'title') return [slide];
  const mode = resolveMode(slide, options);
  if (estimateBodyLines(slide, mode) <= SLIDE_BODY_LINE_CAP) return [slide];

  const hasThemes = slide.elements.some((e) => e.type === 'subheading');
  const groups = hasThemes ? splitThemeGroups(slide.elements) : [flowOf(slide.elements)];

  const chunks: SlideElementSpec[][] = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!;
    const groupMode = g === 0 ? mode : 'full';
    const groupLines = group.reduce((sum, el) => sum + elementLines(el, groupMode), 0);
    if (groupLines <= SLIDE_BODY_LINE_CAP) chunks.push(group);
    else chunks.push(...packFlow(group, groupMode, SLIDE_BODY_LINE_CAP));
  }

  return assemblePages(slide, chunks);
}

/** Expand over-capacity slides into wrap-friendly pages. Does not mutate `deck`. */
export function paginateDeckSpec(deck: DeckSpec, options?: PaginateOptions): DeckSpec {
  return {
    ...deck,
    slides: deck.slides.flatMap((s) => paginateSlide(s, options)),
  };
}
