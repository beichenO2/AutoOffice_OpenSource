/**
 * U4 / L1 — TDD RED for DeckSpec text budgets.
 *
 * Future API (U4b implements; this file must stay RED until then):
 *   import { enforceDeckTextBudget } from '../../src/engine/text-budget.js'
 *
 * Rules encoded below (comments + expects):
 *   - ≤6 bullets per content slide
 *   - ≤80 CJK chars (or count fullwidth=1) per bullet
 *   - ≤280 CJK chars per paragraph
 *   - returns { ok: boolean, violations: string[] }
 */
import { describe, it, expect } from 'vitest';
import type { DeckSpec, SlideElementSpec, SlideSpec } from '../../src/engine/html/generate.js';
import { enforceDeckTextBudget } from '../../src/engine/text-budget.js';

function slide(layout: NonNullable<SlideSpec['layout']>, title: string, elements: SlideElementSpec[]): SlideSpec {
  return { title, layout, elements };
}

function deckOf(slides: SlideSpec[]): DeckSpec {
  return { title: '预算夹具', slides };
}

function nBullets(n: number, text = '要点'): SlideElementSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    type: 'bullet' as const,
    text: `${text}${i + 1}`,
  }));
}

/** CJK ideograph — each code point is one budget unit. */
const CJK = '测';
/** Fullwidth Latin (U+FF21) — must count as 1, same as CJK. */
const FULLWIDTH = 'Ａ';

const OK_BULLET = CJK.repeat(80);
const OVER_BULLET = CJK.repeat(81);
const OK_FW_BULLET = FULLWIDTH.repeat(80);
const OVER_FW_BULLET = FULLWIDTH.repeat(81);
const OK_PARA = CJK.repeat(280);
const OVER_PARA = CJK.repeat(281);

function expectBudgetShape(result: unknown): asserts result is { ok: boolean; violations: string[] } {
  expect(result).toEqual(
    expect.objectContaining({
      ok: expect.any(Boolean),
      violations: expect.any(Array),
    }),
  );
  const r = result as { ok: boolean; violations: unknown[] };
  for (const v of r.violations) expect(typeof v).toBe('string');
}

describe('enforceDeckTextBudget — return shape', () => {
  it('returns { ok: boolean, violations: string[] }', () => {
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '合规页', [...nBullets(3), { id: 'p1', type: 'paragraph', text: '导语' }])]),
    );
    expectBudgetShape(result);
    expect(Object.keys(result).sort()).toEqual(['ok', 'violations']);
  });
});

describe('enforceDeckTextBudget — ≤6 bullets per content slide', () => {
  it('accepts a content slide with exactly 6 bullets', () => {
    // Rule: ≤6 bullets per content slide — 6 is the inclusive ceiling.
    const result = enforceDeckTextBudget(deckOf([slide('content', '六点页', nBullets(6))]));
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a content slide with 7 bullets', () => {
    // Rule: ≤6 bullets per content slide — 7th bullet is a hard violation.
    const result = enforceDeckTextBudget(deckOf([slide('content', '七点页', nBullets(7))]));
    expectBudgetShape(result);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => /6|bullet|要点/i.test(v))).toBe(true);
  });

  it('does not apply the 6-bullet cap to title / section slides', () => {
    // Rule is per *content* slide only — title/section layouts are exempt.
    const result = enforceDeckTextBudget(
      deckOf([
        slide('title', '封面', nBullets(7, '封面条')),
        slide('section', '篇章', nBullets(8, '篇章条')),
      ]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('does not count heading / image / formula as bullets', () => {
    const result = enforceDeckTextBudget(
      deckOf([
        slide('content', '混排页', [
          { id: 'h', type: 'heading', text: '标题' },
          { id: 's', type: 'subheading', text: '副题' },
          ...nBullets(6),
          { id: 'img', type: 'image', src: 'about:blank', alt: '图' },
          { id: 'f', type: 'formula', text: 'E=mc^2' },
        ]),
      ]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('enforceDeckTextBudget — ≤80 CJK / fullwidth=1 per bullet', () => {
  it('accepts a bullet of exactly 80 CJK chars', () => {
    // Rule: ≤80 CJK chars per bullet — 80 is the inclusive ceiling.
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '满额要点', [{ id: 'b1', type: 'bullet', text: OK_BULLET }])]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a bullet of 81 CJK chars', () => {
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '超长要点', [{ id: 'b1', type: 'bullet', text: OVER_BULLET }])]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => /80|bullet|要点/i.test(v))).toBe(true);
  });

  it('counts each fullwidth glyph as 1 (same budget as CJK)', () => {
    // Rule: count fullwidth=1 — U+FF21「Ａ」is one unit, not 0.5 and not 2.
    const ok = enforceDeckTextBudget(
      deckOf([slide('content', '满额全角', [{ id: 'b1', type: 'bullet', text: OK_FW_BULLET }])]),
    );
    expectBudgetShape(ok);
    expect(ok.ok).toBe(true);
    expect(ok.violations).toEqual([]);

    const over = enforceDeckTextBudget(
      deckOf([slide('content', '超长全角', [{ id: 'b1', type: 'bullet', text: OVER_FW_BULLET }])]),
    );
    expectBudgetShape(over);
    expect(over.ok).toBe(false);
    expect(over.violations.length).toBeGreaterThan(0);
  });

  it('counts mixed CJK + fullwidth toward the same 80-unit budget', () => {
    const mixedOk = CJK.repeat(40) + FULLWIDTH.repeat(40);
    const mixedOver = CJK.repeat(40) + FULLWIDTH.repeat(41);
    const ok = enforceDeckTextBudget(
      deckOf([slide('content', '混合满额', [{ id: 'b1', type: 'bullet', text: mixedOk }])]),
    );
    expectBudgetShape(ok);
    expect(ok.ok).toBe(true);

    const over = enforceDeckTextBudget(
      deckOf([slide('content', '混合超标', [{ id: 'b1', type: 'bullet', text: mixedOver }])]),
    );
    expectBudgetShape(over);
    expect(over.ok).toBe(false);
  });
});

describe('enforceDeckTextBudget — ≤280 CJK chars per paragraph', () => {
  it('accepts a paragraph of exactly 280 CJK chars', () => {
    // Rule: ≤280 CJK chars per paragraph — 280 is the inclusive ceiling.
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '满额段落', [{ id: 'p1', type: 'paragraph', text: OK_PARA }])]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a paragraph of 281 CJK chars', () => {
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '超长段落', [{ id: 'p1', type: 'paragraph', text: OVER_PARA }])]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => /280|paragraph|段/i.test(v))).toBe(true);
  });

  it('counts fullwidth=1 on paragraphs as well', () => {
    const overFwPara = FULLWIDTH.repeat(281);
    const result = enforceDeckTextBudget(
      deckOf([slide('content', '全角超长段', [{ id: 'p1', type: 'paragraph', text: overFwPara }])]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

describe('enforceDeckTextBudget — aggregation', () => {
  it('reports every distinct violation on a mixed-bad deck', () => {
    const result = enforceDeckTextBudget(
      deckOf([
        slide('content', '七点页', nBullets(7)),
        slide('content', '超长要点页', [{ id: 'b1', type: 'bullet', text: OVER_BULLET }]),
        slide('content', '超长段落页', [{ id: 'p1', type: 'paragraph', text: OVER_PARA }]),
      ]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('returns ok:true and an empty violations list for a fully in-budget deck', () => {
    const result = enforceDeckTextBudget(
      deckOf([
        slide('title', '封面', [{ id: 'h', type: 'heading', text: '封面标题' }]),
        slide('content', '合规页', [
          ...nBullets(6),
          { id: 'p1', type: 'paragraph', text: OK_PARA },
        ]),
      ]),
    );
    expectBudgetShape(result);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
