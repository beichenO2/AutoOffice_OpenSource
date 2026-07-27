import { describe, it, expect } from 'vitest';
import {
  parseSynctexView,
  lineRangeOfNode,
  synctexBoxesForLines,
  unionByPage,
  toNormRect,
  buildPdfBoxes,
  pageCountOf,
  PAGE_A4_PT,
  type SynctexBox,
} from '../../src/engine/boxmap.js';
import type { SemanticNode, SourceBox } from '../../src/engine/types.js';

/**
 * Verbatim `synctex view` output, captured from synctex 1.21 / TeX Live 2026
 * on a real xelatex compile. Kept byte-for-byte on purpose: the parser's whole
 * job is to survive this exact shape, so a fabricated fixture would prove
 * nothing. Note the record is emitted *twice* for the same position — real
 * behaviour that the parser has to de-duplicate.
 */
const REAL_VIEW_PAGE1 = `This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:/tmp/aoide-latex-Utoiis/main.pdf
Page:1
x:89.292259
y:111.986710
h:89.292259
v:112.158852
W:416.691071
H:10.185786
before:
offset:-1
middle:
after:
Output:/tmp/aoide-latex-Utoiis/main.pdf
Page:1
x:89.292259
y:111.986710
h:89.292259
v:112.158852
W:416.691071
H:10.185786
before:
offset:-1
middle:
after:
SyncTeX result end
`;

/** Same, for a paragraph that LaTeX pushed onto page 2. */
const REAL_VIEW_PAGE2 = `This is SyncTeX command line utility, version 1.5
SyncTeX result begin
Output:/tmp/aoide-latex-Utoiis/main.pdf
Page:2
x:114.197701
y:136.350098
h:89.292259
v:138.597366
W:416.691071
H:9.938165
before:
offset:-1
middle:
after:
SyncTeX result end
`;

/**
 * What `synctex view` prints when the input file is named the way it appears
 * in the query but *not* the way it was recorded — the trap that makes this
 * whole path fail silently. Exit status is 0, so only the absence of records
 * distinguishes it from success.
 */
const REAL_VIEW_NO_TAG = `This is SyncTeX command line utility, version 1.5
SyncTeX Warning: No tag for main.tex
`;

const node = (over: Partial<SemanticNode> = {}): SemanticNode => ({
  id: 'n1',
  type: 'paragraph',
  file: 'main.tex',
  range: { start: 0, end: 10 },
  excerpt: '正文内容',
  ...over,
});

describe('boxmap — parseSynctexView against real CLI output', () => {
  it('extracts one de-duplicated box from a doubly-emitted record', () => {
    const boxes = parseSynctexView(REAL_VIEW_PAGE1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.page).toBe(1);
    expect(boxes[0]!.left).toBeCloseTo(89.292259, 5);
    expect(boxes[0]!.width).toBeCloseTo(416.691071, 5);
    expect(boxes[0]!.height).toBeCloseTo(10.185786, 5);
  });

  it('converts the baseline `v` into a top edge', () => {
    // synctex reports `v` as the baseline; a box's top is `v - H`.
    const [box] = parseSynctexView(REAL_VIEW_PAGE1);
    expect(box!.top).toBeCloseTo(112.158852 - 10.185786, 5);
  });

  it('reads the page number from the record, not from a line-number guess', () => {
    const [box] = parseSynctexView(REAL_VIEW_PAGE2);
    expect(box!.page).toBe(2);
  });

  it('ignores the `x`/`y` fields, which are the click point rather than the box', () => {
    // x:114.197701 differs from h:89.292259 in the page-2 fixture; taking `x`
    // by mistake would shift every box right by ~25pt.
    const [box] = parseSynctexView(REAL_VIEW_PAGE2);
    expect(box!.left).toBeCloseTo(89.292259, 5);
  });

  it('returns nothing for the silent "No tag" failure', () => {
    expect(parseSynctexView(REAL_VIEW_NO_TAG)).toEqual([]);
  });

  it('returns nothing for empty output rather than throwing', () => {
    expect(parseSynctexView('')).toEqual([]);
  });

  it('drops an incomplete trailing record', () => {
    expect(parseSynctexView('Page:1\nh:10\nv:20\n')).toEqual([]);
  });

  it('keeps two distinct boxes reported under one Page header', () => {
    const boxes = parseSynctexView(
      ['Page:1', 'h:10', 'v:30', 'W:100', 'H:10', 'h:10', 'v:60', 'W:100', 'H:10'].join('\n'),
    );
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.top)).toEqual([20, 50]);
  });
});

describe('boxmap — line ranges', () => {
  const source = 'line one\nline two\nline three\nline four\n';

  it('maps a single-line node to one line', () => {
    const r = lineRangeOfNode(source, node({ range: { start: 0, end: 8 } }));
    expect(r).toEqual({ startLine: 1, endLine: 1 });
  });

  it('spans the lines a multi-line node covers', () => {
    const r = lineRangeOfNode(source, node({ range: { start: 9, end: 28 } }));
    expect(r).toEqual({ startLine: 2, endLine: 3 });
  });

  it('never reports an end before the start', () => {
    const r = lineRangeOfNode(source, node({ range: { start: 20, end: 0 } }));
    expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
  });
});

describe('boxmap — synctexBoxesForLines naming fallback', () => {
  const opts = { workDir: '/w', texName: 'main.tex', pdfName: 'main.pdf' };

  it('falls back to the bare name when the absolute query finds nothing', () => {
    const seen: string[] = [];
    const boxes = synctexBoxesForLines([4], {
      ...opts,
      run: (args) => {
        const input = args[2]!;
        seen.push(input);
        // The absolute form is what fails here; the bare name is what answers.
        return input.includes('/w/') ? REAL_VIEW_NO_TAG : REAL_VIEW_PAGE1;
      },
    });
    expect(seen).toEqual(['4:1:/w/main.tex', '4:1:main.tex']);
    expect(boxes).toHaveLength(1);
  });

  it('does not issue the fallback query once the absolute form succeeds', () => {
    const seen: string[] = [];
    synctexBoxesForLines([4], {
      ...opts,
      run: (args) => {
        seen.push(args[2]!);
        return REAL_VIEW_PAGE1;
      },
    });
    expect(seen).toEqual(['4:1:/w/main.tex']);
  });

  it('treats a null run (non-zero exit) as no boxes rather than crashing', () => {
    expect(synctexBoxesForLines([1, 2], { ...opts, run: () => null })).toEqual([]);
  });
});

describe('boxmap — geometry', () => {
  it('unions boxes per page and leaves pages independent', () => {
    const input: SynctexBox[] = [
      { page: 1, left: 10, top: 10, width: 20, height: 10 },
      { page: 1, left: 50, top: 40, width: 20, height: 10 },
      { page: 2, left: 5, top: 5, width: 10, height: 10 },
    ];
    const merged = unionByPage(input);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ page: 1, left: 10, top: 10, width: 60, height: 40 });
    expect(merged[1]!.page).toBe(2);
  });

  it('normalizes A4 points into 0..1', () => {
    const rect = toNormRect({ page: 1, left: 0, top: 0, width: PAGE_A4_PT.w, height: PAGE_A4_PT.h });
    expect(rect.x).toBe(0);
    expect(rect.w).toBeCloseTo(1, 6);
    expect(rect.h).toBeCloseTo(1, 6);
  });

  it('clamps a box that overruns the page instead of emitting w > 1', () => {
    const rect = toNormRect({ page: 1, left: 500, top: 800, width: 400, height: 400 });
    expect(rect.x + rect.w).toBeLessThanOrEqual(1);
    expect(rect.y + rect.h).toBeLessThanOrEqual(1);
    expect(rect.w).toBeGreaterThan(0);
  });

  it('places a real section heading in the upper-left text block', () => {
    const [box] = parseSynctexView(REAL_VIEW_PAGE1);
    const rect = toNormRect(box!);
    expect(rect.x).toBeCloseTo(0.15, 2);
    expect(rect.y).toBeCloseTo(0.121, 2);
    expect(rect.w).toBeCloseTo(0.7, 2);
  });
});

describe('boxmap — buildPdfBoxes', () => {
  const tex = ['\\section{One}', 'Body text.', '', '\\section{Two}', 'More body.'].join('\n');
  const nodes = [
    node({ id: 'sec-1', type: 'section', excerpt: 'One', range: { start: 0, end: 13 } }),
    node({ id: 'para-1', type: 'paragraph', excerpt: 'Body text.', range: { start: 14, end: 24 } }),
  ];

  it('emits one labelled box per node, carrying the synctex page', () => {
    const boxes = buildPdfBoxes(tex, nodes, {
      workDir: '/w',
      texName: 'main.tex',
      pdfName: 'main.pdf',
      run: () => REAL_VIEW_PAGE2,
    });
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.nodeId)).toEqual(['sec-1', 'para-1']);
    expect(boxes.every((b) => b.page === 2)).toBe(true);
    expect(boxes[0]!.label).toBe('第 2 页 · 章节标题「One」');
    expect(boxes[1]!.label).toBe('第 2 页 · 正文段落「Body text.」');
  });

  it('labels by the synctex page, not by the source line number', () => {
    // Both nodes sit on source lines 1-2 but land on PDF page 2. A line-number
    // estimate would have said page 1 — the bug this replaces.
    const boxes = buildPdfBoxes(tex, nodes, {
      workDir: '/w',
      texName: 'main.tex',
      pdfName: 'main.pdf',
      run: () => REAL_VIEW_PAGE2,
    });
    expect(boxes.every((b) => b.label?.startsWith('第 2 页'))).toBe(true);
  });

  it('yields an empty map when synctex finds nothing, instead of fake boxes', () => {
    const boxes = buildPdfBoxes(tex, nodes, {
      workDir: '/w',
      texName: 'main.tex',
      pdfName: 'main.pdf',
      run: () => REAL_VIEW_NO_TAG,
    });
    expect(boxes).toEqual([]);
  });

  it('bounds the number of synctex spawns for a pathological node span', () => {
    const huge = 'x\n'.repeat(5000);
    let calls = 0;
    buildPdfBoxes(huge, [node({ range: { start: 0, end: huge.length } })], {
      workDir: '/w',
      texName: 'main.tex',
      pdfName: 'main.pdf',
      run: () => {
        calls += 1;
        return REAL_VIEW_PAGE1;
      },
    });
    // MAX_LINES_PER_NODE caps a single node well below its 5000-line span.
    expect(calls).toBeLessThanOrEqual(60);
    expect(calls).toBeGreaterThan(0);
  });
});

describe('boxmap — pageCountOf', () => {
  it('is 0 for an empty map', () => {
    expect(pageCountOf([])).toBe(0);
  });

  it('reports the highest page present', () => {
    const boxes = [
      { nodeId: 'a', page: 1, x: 0, y: 0, w: 1, h: 1 },
      { nodeId: 'b', page: 3, x: 0, y: 0, w: 1, h: 1 },
    ] satisfies SourceBox[];
    expect(pageCountOf(boxes)).toBe(3);
  });
});
