/**
 * Measure-and-shrink text fit (Strategy A).
 *
 * After preview HTML is in a real layout, detect overflow the way a renderer
 * would (scrollHeight > clientHeight, or child bottoms past the slide box)
 * and step `--ao-body-font` down to a readable floor (~1.5vw / 18px at the
 * 1280 measure viewport). A heuristic path covers CI without Chromium.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';

/** Readable floor: 1.5vw ≈ 19.2px at 1280; 18px equivalent. */
export const FIT_FLOOR_VW = 1.5;
export const FIT_FLOOR_PX = 18;
export const FIT_STEP_VW = 0.1;
export const FIT_MAX_STEPS = 32;
export const DEFAULT_BODY_FONT_VW = 2.3;
/** Title floor stays above body (~30px at 1280) so a heading still reads as a title. */
export const FIT_TITLE_FLOOR_VW = 2.4;
export const DEFAULT_TITLE_FONT_VW = 3.5;
export const DEFAULT_COVER_TITLE_FONT_VW = 6.2;

const MEASURE_VIEWPORT_PX = 1280;
const MEASURE_SLIDE_H_PX = 720;
const SLIDE_OPEN_RE = /<div\b[^>]*\bclass="[^"]*\bao-slide\b[^"]*"[^>]*>/g;
const SLIDE_BLOCK_RE = /<div\b[^>]*\bclass="[^"]*\bao-slide\b[^"]*"[^>]*>[\s\S]*?<\/div>/g;

export interface SlideOverflow {
  overflowing: boolean;
  scrollOverflow: boolean;
  childOverflow: boolean;
  scrollHeight: number;
  clientHeight: number;
  maxChildBottom: number;
  boxHeight: number;
}

export interface FitLadderOptions {
  floorVw?: number;
  titleFloorVw?: number;
  stepVw?: number;
  maxSteps?: number;
  slideSelector?: string;
}

export interface FitSlideResult {
  overflowing: boolean;
  bodyFontVw: number;
  titleFontVw: number;
  steps: number;
  hitFloor: boolean;
  hitTitleFloor: boolean;
}

export interface FitHtmlResult {
  html: string;
  slides: FitSlideResult[];
  fitted: boolean;
}

function roundVw(n: number): number {
  return Number(n.toFixed(2));
}

function parseFontToVw(raw: string, viewportPx = MEASURE_VIEWPORT_PX): number | null {
  const t = raw.trim();
  const vw = /^([\d.]+)\s*vw$/i.exec(t);
  if (vw) return Number(vw[1]);
  const px = /^([\d.]+)\s*px$/i.exec(t);
  if (px) return (Number(px[1]) / viewportPx) * 100;
  return null;
}

/** Next shrink step; null if already at/below the readable floor. */
export function nextFitStep(
  currentVw: number,
  floorVw = FIT_FLOOR_VW,
  stepVw = FIT_STEP_VW,
): number | null {
  if (!Number.isFinite(currentVw) || currentVw <= floorVw + 1e-9) return null;
  return Math.max(floorVw, roundVw(currentVw - stepVw));
}

function applyFitToSlideOpen(open: string, bodyFontVw: number, titleFontVw?: number): string {
  const vw = Math.max(FIT_FLOOR_VW, roundVw(bodyFontVw));
  const isTitle = /\bdata-ao-layout="title"/.test(open);
  const existingTitle = /--ao-title-font:\s*([^;\s"']+)/.exec(open);
  const parsedExisting = existingTitle ? parseFontToVw(existingTitle[1]!) : null;
  const titleVw = Math.max(
    FIT_TITLE_FLOOR_VW,
    roundVw(
      titleFontVw ??
        parsedExisting ??
        (isTitle ? DEFAULT_COVER_TITLE_FONT_VW : DEFAULT_TITLE_FONT_VW),
    ),
  );
  const bodyDecl = `--ao-body-font: ${vw}vw`;
  const titleDecl = `--ao-title-font: ${titleVw}vw`;
  let inner = open.startsWith('<div') ? open.slice(4) : open;
  if (inner.endsWith('>')) inner = inner.slice(0, -1);

  if (!/\bdata-ao-fit\s*=/.test(inner)) inner += ' data-ao-fit="1"';

  const styleRe = /\bstyle\s*=\s*"([^"]*)"/;
  const sm = styleRe.exec(inner);
  if (sm) {
    let style = sm[1] ?? '';
    style = /--ao-body-font\s*:/.test(style)
      ? style.replace(/--ao-body-font\s*:\s*[^;]*/, bodyDecl)
      : `${bodyDecl}; ${style}`;
    style = /--ao-title-font\s*:/.test(style)
      ? style.replace(/--ao-title-font\s*:\s*[^;]*/, titleDecl)
      : `${titleDecl}; ${style}`;
    inner = inner.replace(styleRe, `style="${style}"`);
  } else {
    inner += ` style="${bodyDecl}; ${titleDecl}"`;
  }
  return `<div${inner}>`;
}

/** Stamp `data-ao-fit` + `--ao-body-font` / `--ao-title-font` on `.ao-slide` (clamped to floors). */
export function applyFitCssVars(
  html: string,
  bodyFontVw: number,
  opts?: { slideIndex?: number; titleFontVw?: number },
): string {
  let i = -1;
  return html.replace(SLIDE_OPEN_RE, (open) => {
    i += 1;
    if (opts?.slideIndex !== undefined && i !== opts.slideIndex) return open;
    return applyFitToSlideOpen(open, bodyFontVw, opts?.titleFontVw);
  });
}

/** Read the first `--ao-body-font` vw value from fitted HTML. */
export function readFitBodyFontVw(html: string): number | null {
  const m = /--ao-body-font:\s*([\d.]+)vw/.exec(html);
  return m ? Number(m[1]) : null;
}

/** Read the first `--ao-title-font` vw value from fitted HTML. */
export function readFitTitleFontVw(html: string): number | null {
  const m = /--ao-title-font:\s*([\d.]+)vw/.exec(html);
  return m ? Number(m[1]) : null;
}

function readSlideFontVw(slideHtml: string): number {
  const m = /--ao-body-font:\s*([^;\s"']+)/.exec(slideHtml);
  if (m) {
    const vw = parseFontToVw(m[1]!);
    if (vw != null && Number.isFinite(vw)) return vw;
  }
  return DEFAULT_BODY_FONT_VW;
}

function readSlideTitleFontVw(slideHtml: string): number {
  const m = /--ao-title-font:\s*([^;\s"']+)/.exec(slideHtml);
  if (m) {
    const vw = parseFontToVw(m[1]!);
    if (vw != null && Number.isFinite(vw)) return vw;
  }
  return /\bdata-ao-layout="title"/.test(slideHtml)
    ? DEFAULT_COVER_TITLE_FONT_VW
    : DEFAULT_TITLE_FONT_VW;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function blockTexts(html: string, tag: 'li' | 'p'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...html.matchAll(re)].map((m) => stripTags(m[1] ?? '').trim()).filter(Boolean);
}

function estimateOneSlide(slideHtml: string, bodyFontVw: number): boolean {
  const heightPx = /height:\s*([\d.]+)px/.exec(slideHtml);
  const padPx = /padding:\s*([\d.]+)px/.exec(slideHtml);
  const boxH = heightPx ? Number(heightPx[1]) : MEASURE_SLIDE_H_PX;
  const padY = padPx ? Number(padPx[1]) * 2 : Math.round(13 * (MEASURE_VIEWPORT_PX / 100));
  const colPx = 1090;
  const fontPx = (bodyFontVw / 100) * MEASURE_VIEWPORT_PX;
  const charsPerLine = Math.max(8, Math.floor(colPx / Math.max(8, fontPx)));
  const bullets = blockTexts(slideHtml, 'li');
  const paras = blockTexts(slideHtml, 'p');
  let lines = 0;
  for (const t of [...bullets, ...paras]) {
    lines += Math.max(1, Math.ceil([...t].length / charsPerLine));
  }
  if (lines === 0) return false;
  const blocks = Math.max(1, bullets.length + paras.length);
  const linePx = fontPx * 1.35;
  const gapPx = 8;
  const height = lines * linePx + Math.max(0, blocks - 1) * gapPx + padY;
  return height > boxH + 1;
}

/** Heuristic overflow (no browser): estimated copy taller than the 1280×720 frame. */
export function estimateSlideOverflow(html: string, bodyFontVw?: number): boolean {
  const slides = html.match(SLIDE_BLOCK_RE) ?? [html];
  return slides.some((s) => estimateOneSlide(s, bodyFontVw ?? readSlideFontVw(s)));
}

/** Heuristic title overflow: heading block taller than a share of the 1280×720 frame. */
function estimateTitleOverflow(slideHtml: string, titleFontVw: number): boolean {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(slideHtml);
  if (!h1) return false;
  const text = stripTags(h1[1] ?? '').trim();
  if (!text) return false;
  const isTitle = /\bdata-ao-layout="title"/.test(slideHtml);
  const colPx = isTitle ? MEASURE_VIEWPORT_PX * 0.92 : MEASURE_VIEWPORT_PX * 0.85;
  const fontPx = (titleFontVw / 100) * MEASURE_VIEWPORT_PX;
  const charsPerLine = Math.max(4, Math.floor(colPx / Math.max(8, fontPx)));
  const lines = Math.max(1, Math.ceil([...text].length / charsPerLine));
  const linePx = fontPx * (isTitle ? 1.05 : 1.15);
  const extra = isTitle
    ? fontPx * 0.6 + (2.8 / 100) * MEASURE_VIEWPORT_PX
    : (1.35 / 100) * MEASURE_VIEWPORT_PX + (1.1 / 100) * MEASURE_VIEWPORT_PX + (1.5 / 100) * MEASURE_VIEWPORT_PX;
  const titleBlockH = lines * linePx + extra;
  const maxTitleH = isTitle ? MEASURE_SLIDE_H_PX * 0.55 : MEASURE_SLIDE_H_PX * 0.32;
  return titleBlockH > maxTitleH + 1;
}

/**
 * Heuristic / CSS-var ladder. Prefer `applyFitLadderOnPage` / `fitPreviewHtml`
 * when Chromium is available — this path is the CI fallback.
 */
export function applyFitLadder(html: string, opts?: FitLadderOptions): FitHtmlResult {
  const floorVw = opts?.floorVw ?? FIT_FLOOR_VW;
  const titleFloorVw = opts?.titleFloorVw ?? FIT_TITLE_FLOOR_VW;
  const stepVw = opts?.stepVw ?? FIT_STEP_VW;
  const maxSteps = opts?.maxSteps ?? FIT_MAX_STEPS;
  const slidesHtml = html.match(SLIDE_BLOCK_RE) ?? [];
  if (slidesHtml.length === 0) return { html, slides: [], fitted: true };

  const results: FitSlideResult[] = [];
  let index = 0;
  const out = html.replace(SLIDE_BLOCK_RE, (slide) => {
    const i = index++;
    const isTitleSlide = /\bdata-ao-layout="title"/.test(slide);
    let bodyVw = readSlideFontVw(slide);
    let titleVw = readSlideTitleFontVw(slide);
    let current = slide;
    let steps = 0;
    while (steps < maxSteps) {
      const bodyOver = estimateOneSlide(current, bodyVw);
      const titleOver = estimateTitleOverflow(current, titleVw);
      if (!bodyOver && !titleOver) break;
      let progressed = false;
      if (titleOver || isTitleSlide) {
        const nextTitle = nextFitStep(titleVw, titleFloorVw, stepVw);
        if (nextTitle != null) {
          titleVw = nextTitle;
          progressed = true;
        }
      }
      if (!isTitleSlide || bodyOver) {
        const nextBody = nextFitStep(bodyVw, floorVw, stepVw);
        if (nextBody != null) {
          bodyVw = nextBody;
          progressed = true;
        }
      }
      if (!progressed) break;
      current = applyFitCssVars(current, bodyVw, { slideIndex: 0, titleFontVw: titleVw });
      steps += 1;
    }
    const overflowing = estimateOneSlide(current, bodyVw) || estimateTitleOverflow(current, titleVw);
    results[i] = {
      overflowing,
      bodyFontVw: bodyVw,
      titleFontVw: titleVw,
      steps,
      hitFloor: bodyVw <= floorVw + 1e-9,
      hitTitleFloor: titleVw <= titleFloorVw + 1e-9,
    };
    return current;
  });

  return { html: out, slides: results, fitted: results.every((s) => !s.overflowing) };
}

const OVERFLOW_SCRIPT = (
  slide: Element,
): {
  overflowing: boolean;
  scrollOverflow: boolean;
  childOverflow: boolean;
  scrollHeight: number;
  clientHeight: number;
  maxChildBottom: number;
  boxHeight: number;
} => {
  const EPS = 1;
  const host = slide as HTMLElement;
  const scrollOverflow = host.scrollHeight > host.clientHeight + EPS;
  const box = host.getBoundingClientRect();
  let maxChildBottom = 0;
  let childOverflow = false;
  host.querySelectorAll(':scope > *, .ao-el, [data-ao-id]').forEach((el) => {
    if (el === host) return;
    const r = el.getBoundingClientRect();
    const bottom = r.bottom - box.top;
    if (bottom > maxChildBottom) maxChildBottom = bottom;
    if (r.bottom > box.bottom + EPS) childOverflow = true;
  });
  return {
    overflowing: scrollOverflow || childOverflow,
    scrollOverflow,
    childOverflow,
    scrollHeight: host.scrollHeight,
    clientHeight: host.clientHeight,
    maxChildBottom,
    boxHeight: box.height,
  };
};

/** Playwright: renderer-true overflow on one slide (draw.io bbox-fail spirit). */
export async function detectSlideOverflow(page: Page, slideSelector: string): Promise<SlideOverflow> {
  const loc = page.locator(slideSelector).first();
  if ((await loc.count()) === 0) {
    throw new Error(`detectSlideOverflow: no slide matches ${slideSelector}`);
  }
  return loc.evaluate(OVERFLOW_SCRIPT);
}

/** Playwright: step `--ao-body-font` / `--ao-title-font` until fit or floor. */
export async function applyFitLadderOnPage(
  page: Page,
  slideSelector = '.ao-slide',
  opts?: FitLadderOptions,
): Promise<FitSlideResult[]> {
  const floorVw = opts?.floorVw ?? FIT_FLOOR_VW;
  const titleFloorVw = opts?.titleFloorVw ?? FIT_TITLE_FLOOR_VW;
  const stepVw = opts?.stepVw ?? FIT_STEP_VW;
  const maxSteps = opts?.maxSteps ?? FIT_MAX_STEPS;

  return page.evaluate(
    ({ selector, floorVw: floor, titleFloorVw: titleFloor, stepVw: step, maxSteps: max }) => {
      const EPS = 1;
      /** Ignore glyph-ink slop (~line-height 1.05) so we match the gate's in-flow predicate. */
      const CELL_EPS = 4;
      const hideAbsForScrollMeasure = (root: HTMLElement): (() => void) => {
        const undone: Array<() => void> = [];
        root.querySelectorAll<HTMLElement>('*').forEach((child) => {
          if (getComputedStyle(child).position === 'absolute') {
            const prev = child.style.display;
            child.style.display = 'none';
            undone.push(() => {
              child.style.display = prev;
            });
          }
        });
        const marker = 'data-ao-fit-inflow';
        root.setAttribute(marker, '');
        const style = document.createElement('style');
        style.textContent = `[${marker}]::before,[${marker}]::after{display:none!important}`;
        document.head.appendChild(style);
        undone.push(() => {
          root.removeAttribute(marker);
          style.remove();
        });
        return () => {
          for (const fn of undone.reverse()) fn();
        };
      };
      const inflowScrollOverflow = (el: HTMLElement): boolean => {
        const restore = hideAbsForScrollMeasure(el);
        const overflow =
          el.scrollWidth > el.clientWidth + EPS || el.scrollHeight > el.clientHeight + EPS;
        restore();
        return overflow;
      };
      const contentExceedsCell = (el: HTMLElement): boolean => {
        const text = (el.innerText || el.textContent || '').trim();
        if (!text) return false;
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const tr = range.getBoundingClientRect();
          if (tr.width <= 0 || tr.height <= 0) return false;
          const box = el.getBoundingClientRect();
          return (
            tr.left < box.left - CELL_EPS ||
            tr.top < box.top - CELL_EPS ||
            tr.right > box.right + CELL_EPS ||
            tr.bottom > box.bottom + CELL_EPS
          );
        } catch {
          return false;
        }
      };
      const elementGateOverflow = (el: HTMLElement): boolean =>
        inflowScrollOverflow(el) || contentExceedsCell(el);
      const slideLevelOverflow = (slide: HTMLElement): boolean => {
        if (slide.scrollHeight > slide.clientHeight + EPS) return true;
        const box = slide.getBoundingClientRect();
        const nodes = slide.querySelectorAll(':scope > *, .ao-el, [data-ao-id]');
        for (const el of nodes) {
          if (el === slide) continue;
          if ((el as HTMLElement).getBoundingClientRect().bottom > box.bottom + EPS) return true;
        }
        return false;
      };
      const isOverflow = (slide: HTMLElement): boolean => {
        if (slideLevelOverflow(slide)) return true;
        const nodes = slide.querySelectorAll('h1, h2, p, li, .ao-el, [data-ao-id]');
        for (const el of nodes) {
          if (el === slide) continue;
          if (elementGateOverflow(el as HTMLElement)) return true;
        }
        return false;
      };
      const titleOverflows = (slide: HTMLElement): boolean => {
        const h1 = slide.querySelector('h1.ao-el, h1') as HTMLElement | null;
        if (!h1) return false;
        return elementGateOverflow(h1) || (slide.getAttribute('data-ao-layout') === 'title' && slideLevelOverflow(slide));
      };
      const parseToVw = (raw: string, viewportPx: number): number | null => {
        const t = raw.trim();
        const vwM = /^([\d.]+)\s*vw$/i.exec(t);
        if (vwM) return Number(vwM[1]);
        const pxM = /^([\d.]+)\s*px$/i.exec(t);
        if (pxM) return (Number(pxM[1]) / viewportPx) * 100;
        return null;
      };
      const currentVw = (slide: HTMLElement): number => {
        const inline = slide.style.getPropertyValue('--ao-body-font');
        const css = getComputedStyle(slide).getPropertyValue('--ao-body-font');
        const fromVar = parseToVw(inline || css, window.innerWidth);
        if (fromVar != null && Number.isFinite(fromVar)) return fromVar;
        const probe = slide.querySelector('li, p, .ao-el') as HTMLElement | null;
        if (probe) {
          const px = parseFloat(getComputedStyle(probe).fontSize);
          if (Number.isFinite(px) && px > 0) return (px / window.innerWidth) * 100;
        }
        return 2.3;
      };
      const currentTitleVw = (slide: HTMLElement): number => {
        const inline = slide.style.getPropertyValue('--ao-title-font');
        const css = getComputedStyle(slide).getPropertyValue('--ao-title-font');
        const fromVar = parseToVw(inline || css, window.innerWidth);
        if (fromVar != null && Number.isFinite(fromVar)) return fromVar;
        const probe = slide.querySelector('h1.ao-el, h1') as HTMLElement | null;
        if (probe) {
          const px = parseFloat(getComputedStyle(probe).fontSize);
          if (Number.isFinite(px) && px > 0) return (px / window.innerWidth) * 100;
        }
        return slide.getAttribute('data-ao-layout') === 'title' ? 6.2 : 3.5;
      };

      const results: Array<{
        overflowing: boolean;
        bodyFontVw: number;
        titleFontVw: number;
        steps: number;
        hitFloor: boolean;
        hitTitleFloor: boolean;
      }> = [];
      for (const slide of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
        const isTitleSlide = slide.getAttribute('data-ao-layout') === 'title';
        let bodyVw = currentVw(slide);
        let titleVw = currentTitleVw(slide);
        let steps = 0;
        while (isOverflow(slide) && steps < max) {
          const tOver = titleOverflows(slide);
          let progressed = false;
          if (tOver || isTitleSlide) {
            if (titleVw > titleFloor + 1e-9) {
              titleVw = Math.max(titleFloor, Number((titleVw - step).toFixed(2)));
              progressed = true;
            }
          }
          if (!isTitleSlide || !tOver) {
            if (bodyVw > floor + 1e-9) {
              bodyVw = Math.max(floor, Number((bodyVw - step).toFixed(2)));
              progressed = true;
            }
          }
          if (!progressed) break;
          slide.setAttribute('data-ao-fit', '1');
          slide.style.setProperty('--ao-body-font', `${bodyVw}vw`);
          slide.style.setProperty('--ao-title-font', `${titleVw}vw`);
          steps += 1;
        }
        slide.setAttribute('data-ao-fit', '1');
        slide.style.setProperty('--ao-body-font', `${bodyVw}vw`);
        slide.style.setProperty('--ao-title-font', `${titleVw}vw`);
        results.push({
          overflowing: isOverflow(slide),
          bodyFontVw: bodyVw,
          titleFontVw: titleVw,
          steps,
          hitFloor: bodyVw <= floor + 1e-9,
          hitTitleFloor: titleVw <= titleFloor + 1e-9,
        });
      }
      return results;
    },
    { selector: slideSelector, floorVw, titleFloorVw, stepVw, maxSteps },
  );
}

/** Marks preview HTML that has already run the fit ladder (serve-path skip). */
export const PREVIEW_FITTED_ATTR = 'data-ao-preview-fitted';

export function isPreviewFitted(html: string): boolean {
  return new RegExp(`\\b${PREVIEW_FITTED_ATTR}\\s*=`).test(html);
}

function stampPreviewFitted(html: string): string {
  if (isPreviewFitted(html)) return html;
  if (/<body\b/i.test(html)) {
    return html.replace(/<body\b/i, `<body ${PREVIEW_FITTED_ATTR}="1"`);
  }
  return html;
}

/**
 * Render preview HTML in Chromium, apply the fit ladder, return mutated HTML.
 * Falls back to the heuristic ladder if Playwright cannot launch.
 */
export async function fitPreviewHtml(html: string, opts?: FitLadderOptions): Promise<FitHtmlResult> {
  try {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    }
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.setContent(html, { waitUntil: 'load' });
      const slides = await applyFitLadderOnPage(page, opts?.slideSelector ?? '.ao-slide', opts);
      const fittedHtml = await page.content();
      await page.close();
      return { html: stampPreviewFitted(fittedHtml), slides, fitted: slides.every((s) => !s.overflowing) };
    } finally {
      await browser.close();
    }
  } catch {
    const result = applyFitLadder(html, opts);
    return { ...result, html: stampPreviewFitted(result.html) };
  }
}
