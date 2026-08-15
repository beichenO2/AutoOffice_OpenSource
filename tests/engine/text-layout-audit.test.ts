import { describe, it, expect } from 'vitest';
import { auditTextLayout } from '../../src/engine/standards/index.js';
import type { DocumentElementBox, DocumentElementFact, DocumentFacts } from '../../src/engine/standards/types.js';

function factsOf(elements: DocumentElementFact[]): DocumentFacts {
  return { kind: 'presentation', elements };
}

function textBox(
  nodeId: string,
  page: number,
  box: DocumentElementBox,
  extra: Partial<
    Pick<DocumentElementFact, 'type' | 'contentBoxNorm' | 'scrollOverflow' | 'textLength' | 'parentId'>
  > = {},
): DocumentElementFact {
  return {
    nodeId,
    type: extra.type ?? 'text',
    page,
    boxNorm: box,
    ...(extra.contentBoxNorm !== undefined ? { contentBoxNorm: extra.contentBoxNorm } : {}),
    ...(extra.scrollOverflow !== undefined ? { scrollOverflow: extra.scrollOverflow } : {}),
    ...(extra.textLength !== undefined ? { textLength: extra.textLength } : {}),
    ...(extra.parentId !== undefined ? { parentId: extra.parentId } : {}),
  };
}

describe('auditTextLayout — pass', () => {
  it('accepts well-spaced non-overlapping measured boxes inside the slide', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('title', 1, { x: 0.08, y: 0.08, w: 0.84, h: 0.12 }),
        textBox('body', 1, { x: 0.08, y: 0.28, w: 0.84, h: 0.4 }),
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('ignores char-count-only elements when no measured box exists', () => {
    const result = auditTextLayout({
      kind: 'presentation',
      elements: [{ nodeId: 'n_long', type: 'text', page: 1, textLength: 9_999 }],
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('does not treat same geometry on different pages as overlap', () => {
    const box = { x: 0.1, y: 0.1, w: 0.4, h: 0.3 };
    const result = auditTextLayout(factsOf([textBox('a', 1, box), textBox('b', 2, box)]));
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('allows adjacent boxes that only touch (zero overlap area)', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('left', 1, { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }),
        textBox('right', 1, { x: 0.4, y: 0.2, w: 0.3, h: 0.3 }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('passes when a measured content box stays inside its cell', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('cell', 1, { x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, {
          contentBoxNorm: { x: 0.21, y: 0.21, w: 0.38, h: 0.18 },
        }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overflow')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('treats a box sitting exactly on the 2% edge margin as sufficient', () => {
    const result = auditTextLayout(
      factsOf([textBox('edge', 1, { x: 0.02, y: 0.02, w: 0.96, h: 0.2 })]),
    );
    expect(result.findings.filter((f) => f.category === 'insufficient-margin')).toEqual([]);
  });

  it('returns ok with no findings when elements are missing', () => {
    const result = auditTextLayout({ kind: 'presentation' });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('does not flag a ul that overlaps its li children (parentId ancestry)', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('slide-1-bullets', 1, { x: 0.1, y: 0.3, w: 0.6, h: 0.3 }, { type: 'list', parentId: 'slide-1' }),
        textBox('slide-1-b0', 1, { x: 0.1, y: 0.3, w: 0.6, h: 0.12 }, { type: 'listitem', parentId: 'slide-1-bullets' }),
        textBox('slide-1-b1', 1, { x: 0.1, y: 0.45, w: 0.6, h: 0.12 }, { type: 'listitem', parentId: 'slide-1-bullets' }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('skips ancestor/descendant overlap even when the child is not fully contained', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('slide-1-bullets', 1, { x: 0.1, y: 0.3, w: 0.4, h: 0.2 }, { type: 'list' }),
        textBox('slide-1-b0', 1, { x: 0.15, y: 0.35, w: 0.5, h: 0.2 }, {
          type: 'listitem',
          parentId: 'slide-1-bullets',
        }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts an aligned numbered series with even gaps (n≥3)', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('card-1', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }),
        textBox('card-2', 1, { x: 0.1, y: 0.3, w: 0.2, h: 0.15 }),
        textBox('card-3', 1, { x: 0.1, y: 0.5, w: 0.2, h: 0.15 }),
      ]),
    );
    expect(result.findings.filter((f) => f.category.startsWith('repeated-series'))).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('auditTextLayout — fail', () => {
  it('flags a measured box that leaves the slide as outside-page (hard)', () => {
    const result = auditTextLayout(
      factsOf([textBox('n_out', 1, { x: 0.8, y: 0.1, w: 0.3, h: 0.2 })]),
    );
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.category === 'outside-page');
    expect(finding).toMatchObject({
      category: 'outside-page',
      severity: 'hard',
      nodeIds: ['n_out'],
      page: 1,
    });
    expect(finding?.message).toMatch(/n_out/);
  });

  it('flags insufficient margin from the slide edge below 2%', () => {
    const result = auditTextLayout(
      factsOf([textBox('n_tight', 1, { x: 0.01, y: 0.1, w: 0.3, h: 0.2 })]),
    );
    const finding = result.findings.find((f) => f.category === 'insufficient-margin');
    expect(finding).toMatchObject({
      category: 'insufficient-margin',
      severity: 'warning',
      nodeIds: ['n_tight'],
      page: 1,
    });
    expect(finding?.message).toMatch(/2%/);
    expect(result.ok).toBe(true);
  });

  it('still flags sibling list items that overlap each other', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('slide-1-bullets', 1, { x: 0.1, y: 0.3, w: 0.6, h: 0.3 }, { type: 'list' }),
        textBox('slide-1-b0', 1, { x: 0.1, y: 0.3, w: 0.6, h: 0.2 }, { type: 'listitem', parentId: 'slide-1-bullets' }),
        textBox('slide-1-b1', 1, { x: 0.1, y: 0.4, w: 0.6, h: 0.15 }, { type: 'listitem', parentId: 'slide-1-bullets' }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.findings.find((f) => f.category === 'text-overlap')?.nodeIds).toEqual([
      'slide-1-b0',
      'slide-1-b1',
    ]);
  });

  it('flags overlapping text boxes on the same page (AABB)', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('a', 1, { x: 0.1, y: 0.1, w: 0.4, h: 0.3 }),
        textBox('b', 1, { x: 0.35, y: 0.2, w: 0.4, h: 0.3 }),
      ]),
    );
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.category === 'text-overlap');
    expect(finding?.severity).toBe('hard');
    expect(finding?.page).toBe(1);
    expect(finding?.nodeIds).toEqual(['a', 'b']);
  });

  it('flags measured text overflow when the content bbox exceeds the cell', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('n_clip', 1, { x: 0.2, y: 0.2, w: 0.3, h: 0.15 }, {
          contentBoxNorm: { x: 0.2, y: 0.2, w: 0.35, h: 0.15 },
        }),
      ]),
    );
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.category === 'text-overflow');
    expect(finding).toMatchObject({
      category: 'text-overflow',
      severity: 'hard',
      nodeIds: ['n_clip'],
      page: 1,
    });
  });

  it('flags text-overflow from scrollOverflow on the real fact type', () => {
    const result = auditTextLayout(
      factsOf([textBox('n_scroll', 1, { x: 0.2, y: 0.2, w: 0.3, h: 0.15 }, { scrollOverflow: true })]),
    );
    expect(result.ok).toBe(false);
    expect(result.findings.find((f) => f.category === 'text-overflow')).toMatchObject({
      category: 'text-overflow',
      severity: 'hard',
      nodeIds: ['n_scroll'],
      page: 1,
    });
  });

  it('does not treat two overlapping images as text-box overlap', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('img-a', 1, { x: 0.1, y: 0.1, w: 0.4, h: 0.3 }, { type: 'image' }),
        textBox('img-b', 1, { x: 0.3, y: 0.2, w: 0.4, h: 0.3 }, { type: 'image' }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
  });

  it('does not treat bare type=element as text without overflow or length evidence', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('el-a', 1, { x: 0.1, y: 0.1, w: 0.4, h: 0.3 }, { type: 'element' }),
        textBox('el-b', 1, { x: 0.3, y: 0.2, w: 0.4, h: 0.3 }, { type: 'element' }),
      ]),
    );
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
  });

  it('treats type=element as text when contentBoxNorm or textLength is present', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('el-a', 1, { x: 0.1, y: 0.1, w: 0.4, h: 0.3 }, { type: 'element', textLength: 12 }),
        textBox('el-b', 1, { x: 0.3, y: 0.2, w: 0.4, h: 0.3 }, { type: 'element', textLength: 8 }),
      ]),
    );
    expect(result.findings.find((f) => f.category === 'text-overlap')?.nodeIds).toEqual(['el-a', 'el-b']);
  });
});

describe('auditTextLayout — repeated series (vendor live-server.mjs)', () => {
  it('flags repeated-series-misalignment when n≥3 ids matching [-_]\\d+$ drift on the cross axis', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('card-1', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }),
        textBox('card-2', 1, { x: 0.18, y: 0.3, w: 0.2, h: 0.15 }),
        textBox('card-3', 1, { x: 0.1, y: 0.5, w: 0.2, h: 0.15 }),
      ]),
    );
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.category === 'repeated-series-misalignment');
    expect(finding).toMatchObject({
      category: 'repeated-series-misalignment',
      severity: 'hard',
      page: 1,
    });
    expect(finding?.nodeIds).toEqual(['card-1', 'card-2', 'card-3']);
    expect(finding?.message).toMatch(/card-\*/);
  });

  it('flags repeated-series-unequal-spacing as warning when gap spread exceeds 2× tolerance', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('item_1', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }),
        textBox('item_2', 1, { x: 0.1, y: 0.25, w: 0.2, h: 0.1 }),
        textBox('item_3', 1, { x: 0.1, y: 0.6, w: 0.2, h: 0.1 }),
      ]),
    );
    const finding = result.findings.find((f) => f.category === 'repeated-series-unequal-spacing');
    expect(finding).toMatchObject({
      category: 'repeated-series-unequal-spacing',
      severity: 'warning',
      page: 1,
    });
    expect(finding?.nodeIds).toEqual(['item_1', 'item_2', 'item_3']);
    expect(result.ok).toBe(true);
  });

  it('does not form a series from n<3 or ids without a trailing -N/_N', () => {
    const two = auditTextLayout(
      factsOf([
        textBox('card-1', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }),
        textBox('card-2', 1, { x: 0.2, y: 0.3, w: 0.2, h: 0.15 }),
      ]),
    );
    const bare = auditTextLayout(
      factsOf([
        textBox('alpha', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }),
        textBox('bravo', 1, { x: 0.2, y: 0.3, w: 0.2, h: 0.15 }),
        textBox('charlie', 1, { x: 0.1, y: 0.5, w: 0.2, h: 0.15 }),
      ]),
    );
    expect(two.findings.filter((f) => f.category.startsWith('repeated-series'))).toEqual([]);
    expect(bare.findings.filter((f) => f.category.startsWith('repeated-series'))).toEqual([]);
  });

  it('does not merge the same *-N ids across different pages', () => {
    const result = auditTextLayout(
      factsOf([
        textBox('card-1', 1, { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }),
        textBox('card-2', 1, { x: 0.2, y: 0.3, w: 0.2, h: 0.15 }),
        textBox('card-3', 2, { x: 0.1, y: 0.5, w: 0.2, h: 0.15 }),
      ]),
    );
    expect(result.findings.filter((f) => f.category.startsWith('repeated-series'))).toEqual([]);
  });
});
