/**
 * U-PAGINATE — wrap + theme pagination instead of ellipsis condense.
 *
 * High-density body copy must stay intact (CSS wraps) and overflow by
 * splitting slides: theme boundaries when subheadings exist, else line-budget
 * chunks. Continuation pages keep the title; images stay on the first page.
 */
import { describe, it, expect } from 'vitest';
import { paginateDeckSpec } from '../../src/engine/paginate.js';
import { renderSlidesMd, splitSlidevPages } from '../../src/engine/slidev/generate.js';
import type { DeckSpec, SlideElementSpec } from '../../src/engine/html/generate.js';

const LONG_BULLET =
  '这是一条比较长的要点用来模拟真实生成的密集文案需要换行到第二行甚至第三行占用更多竖直空间';

const svg = (w: number, h: number): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`).toString(
    'base64',
  );

function bullets(n: number, text = LONG_BULLET, prefix = 'b'): SlideElementSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    type: 'bullet' as const,
    text,
  }));
}

function contentDeck(elements: SlideElementSpec[], title = '高密度'): DeckSpec {
  return { title: 't', slides: [{ layout: 'content' as never, title, elements }] };
}

function bodyEllipsis(md: string): boolean {
  return /…<\/(?:li|p)>/.test(md);
}

describe('paginateDeckSpec — 8 long CJK bullets', () => {
  it('splits into ≥2 content pages and keeps every full bullet (no trailing …)', () => {
    const deck = contentDeck(bullets(8));
    const snapshot = JSON.stringify(deck);
    const paged = paginateDeckSpec(deck);

    expect(JSON.stringify(deck)).toBe(snapshot);
    expect(paged.slides.length).toBeGreaterThanOrEqual(2);

    const texts = paged.slides.flatMap((s) => s.elements.filter((e) => e.type === 'bullet').map((e) => e.text ?? ''));
    expect(texts).toHaveLength(8);
    expect(texts.every((t) => t === LONG_BULLET)).toBe(true);
    expect(texts.some((t) => t.endsWith('…'))).toBe(false);

    const md = renderSlidesMd(deck);
    expect(splitSlidevPages(md).length).toBeGreaterThanOrEqual(2);
    expect(md.split(LONG_BULLET).length - 1).toBe(8);
    expect(bodyEllipsis(md)).toBe(false);
    expect(paged.slides[1]!.title).toMatch(/高密度（(?:续|\d+\/\d+)）/);
  });
});

describe('paginateDeckSpec — theme boundaries', () => {
  it('splits on two subheadings and keeps the slide title on each page', () => {
    const deck = contentDeck(
      [
        { id: 'th-a', type: 'subheading', text: '主题甲' },
        ...bullets(4, LONG_BULLET, 'a'),
        { id: 'th-b', type: 'subheading', text: '主题乙' },
        ...bullets(4, LONG_BULLET, 'b'),
      ],
      '总题',
    );

    const paged = paginateDeckSpec(deck);
    expect(paged.slides.length).toBeGreaterThanOrEqual(2);

    const pageOf = (label: string) =>
      paged.slides.find((s) => s.elements.some((e) => e.type === 'subheading' && e.text === label));

    const a = pageOf('主题甲');
    const b = pageOf('主题乙');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(a!.elements.some((e) => e.type === 'subheading' && e.text === '主题乙')).toBe(false);
    expect(b!.elements.some((e) => e.type === 'subheading' && e.text === '主题甲')).toBe(false);

    expect(a!.title).toContain('总题');
    expect(b!.title).toMatch(/总题（(?:续|\d+\/\d+)）/);
    expect(a!.elements.some((e) => e.type === 'heading' && (e.text ?? '').includes('总题'))).toBe(true);
    expect(b!.elements.some((e) => e.type === 'heading' && /总题/.test(e.text ?? ''))).toBe(true);

    const md = renderSlidesMd(deck);
    expect(splitSlidevPages(md).length).toBeGreaterThanOrEqual(2);
    expect(md.split(LONG_BULLET).length - 1).toBe(8);
    expect(bodyEllipsis(md)).toBe(false);
  });
});

describe('paginateDeckSpec — image + light copy', () => {
  it('puts the figure on the first chunk page only', () => {
    const img = { id: 'img', type: 'image' as const, src: svg(1000, 420), alt: '图' };
    const deck = contentDeck([...bullets(6), img]);
    const md = renderSlidesMd(deck);
    const pages = splitSlidevPages(md);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.filter((p) => /<img\b/.test(p))).toHaveLength(1);
    expect(pages[0]).toMatch(/<img\b/);
    expect(md.split(LONG_BULLET).length - 1).toBe(6);
    expect(bodyEllipsis(md)).toBe(false);
  });

  it('does not paginate a merely-dense text-only slide (4 long bullets)', () => {
    const deck = contentDeck(bullets(4));
    expect(paginateDeckSpec(deck).slides).toHaveLength(1);
    const md = renderSlidesMd(deck);
    expect(splitSlidevPages(md)).toHaveLength(1);
    expect(md).toContain(LONG_BULLET);
    expect(bodyEllipsis(md)).toBe(false);
  });
});
