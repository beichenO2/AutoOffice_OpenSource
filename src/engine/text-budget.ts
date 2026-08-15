/**
 * DeckSpec copy budgets (CJK units, fullwidth = 1).
 *
 * Distinct from slidev `textUnits` (fullwidth = 2), which estimates wrap width.
 * This module only answers: is the authored spec over the hard text caps?
 */
import type { DeckSpec, SlideElementSpec, SlideSpec } from './html/generate.js';

const MAX_BULLETS_PER_CONTENT_SLIDE = 6;
const MAX_BULLET_UNITS = 80;
const MAX_PARAGRAPH_UNITS = 280;

export interface DeckTextBudgetResult {
  ok: boolean;
  violations: string[];
}

/** One Unicode code point = one budget unit (CJK ideograph and fullwidth Latin both 1). */
function cjkBudgetUnits(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

function isContentLayout(layout: SlideSpec['layout']): boolean {
  return layout !== 'title' && layout !== 'section';
}

export function enforceDeckTextBudget(spec: DeckSpec): DeckTextBudgetResult {
  const violations: string[] = [];

  for (const [index, slide] of spec.slides.entries()) {
    const label = slide.title || `slide ${index + 1}`;
    const bullets = slide.elements.filter((el) => el.type === 'bullet');

    if (isContentLayout(slide.layout) && bullets.length > MAX_BULLETS_PER_CONTENT_SLIDE) {
      violations.push(
        `content slide "${label}": ${bullets.length} bullets exceeds ${MAX_BULLETS_PER_CONTENT_SLIDE} 要点`,
      );
    }

    for (const el of slide.elements) {
      const units = cjkBudgetUnits(el.text ?? '');
      if (el.type === 'bullet' && units > MAX_BULLET_UNITS) {
        violations.push(
          `slide "${label}" bullet ${el.id}: ${units} CJK units exceeds ${MAX_BULLET_UNITS} 要点`,
        );
      }
      if (el.type === 'paragraph' && units > MAX_PARAGRAPH_UNITS) {
        violations.push(
          `slide "${label}" paragraph ${el.id}: ${units} CJK units exceeds ${MAX_PARAGRAPH_UNITS} 段`,
        );
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

const ELLIPSIS = '…';

/** Truncate to `maxUnits` including a trailing … (CJK unit = 1). */
function truncateToBudget(text: string, maxUnits: number): string {
  if (cjkBudgetUnits(text) <= maxUnits) return text;
  const keep = Math.max(0, maxUnits - cjkBudgetUnits(ELLIPSIS));
  let out = '';
  let n = 0;
  for (const ch of text) {
    if (n >= keep) break;
    out += ch;
    n += 1;
  }
  return out + ELLIPSIS;
}

function repairSlide(slide: SlideSpec): SlideSpec {
  const capBullets = isContentLayout(slide.layout);
  let keptBullets = 0;
  const elements: SlideElementSpec[] = [];
  for (const el of slide.elements) {
    if (el.type === 'bullet') {
      if (capBullets && keptBullets >= MAX_BULLETS_PER_CONTENT_SLIDE) continue;
      keptBullets += 1;
      elements.push({ ...el, text: truncateToBudget(el.text ?? '', MAX_BULLET_UNITS) });
      continue;
    }
    if (el.type === 'paragraph') {
      elements.push({ ...el, text: truncateToBudget(el.text ?? '', MAX_PARAGRAPH_UNITS) });
      continue;
    }
    elements.push({ ...el });
  }
  return { ...slide, elements };
}

/**
 * Deterministic in-place-of-regenerate repair: drop extra content-slide bullets
 * and truncate over-budget bullets/paragraphs with …. Pure; does not mutate `spec`.
 */
export function repairDeckTextBudget(spec: DeckSpec): DeckSpec {
  return {
    ...spec,
    slides: spec.slides.map(repairSlide),
  };
}
