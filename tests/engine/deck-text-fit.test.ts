/**
 * Text-only density / overflow: a content slide with no image still needs
 * data-ao-dense when the copy is too tall for the frame. Ultra-dense copy
 * paginates (wrap + extra pages) instead of condenseText ellipsis.
 */
import { describe, it, expect } from 'vitest';
import { renderSlidesMd, previewHtmlFromSlidesMd, splitSlidevPages } from '../../src/engine/slidev/generate.js';
import type { DeckSpec } from '../../src/engine/html/generate.js';

// Same GLM-style long CJK bullet used by deck-media.test.ts (~40 chars, wraps).
const LONG_BULLET = '这是一条比较长的要点用来模拟真实生成的密集文案需要换行到第二行甚至第三行占用更多竖直空间';

const svg = (w: number, h: number): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`).toString('base64');

const deckWith = (
  imgSrc: string | null,
  opts: { bulletCount: number; bulletText?: string },
): DeckSpec => {
  const elements: DeckSpec['slides'][number]['elements'] = [];
  for (let i = 0; i < opts.bulletCount; i++) {
    elements.push({ id: `b${i + 1}`, type: 'bullet', text: opts.bulletText ?? `要点${i + 1}` });
  }
  if (imgSrc) elements.push({ id: 'img', type: 'image', src: imgSrc, alt: '图' });
  return { title: 't', slides: [{ layout: 'content' as never, title: '标题', elements }] };
};

describe('renderSlidesMd — text-only density (no image)', () => {
  it('marks a text-only content slide with 6–8 long CJK bullets as dense', () => {
    const md = renderSlidesMd(deckWith(null, { bulletCount: 7, bulletText: LONG_BULLET }));
    expect(md).toContain('data-ao-dense="1"');
    expect(md.split(LONG_BULLET).length - 1).toBe(7);
    expect(md).not.toMatch(/…<\/(?:li|p)>/);
    // 7 long CJK bullets exceed one page → wrap + paginate, still dense on a chunk
    expect(splitSlidevPages(md).length).toBeGreaterThanOrEqual(2);
    const html = previewHtmlFromSlidesMd(md);
    expect(html).toContain('data-ao-dense="1"');
  });

  it('still marks an image+text slide dense when the copy is heavy (sanity)', () => {
    const md = renderSlidesMd(
      deckWith(svg(1000, 420), { bulletCount: 4, bulletText: LONG_BULLET }),
    );
    expect(md).toContain('data-ao-dense="1"');
  });

  it('does not mark a sparse text-only slide dense (2 short bullets)', () => {
    const md = renderSlidesMd(deckWith(null, { bulletCount: 2, bulletText: '短要点' }));
    expect(md).not.toContain('data-ao-dense');
    expect(md).not.toContain('data-ao-media');
  });

  it('applies dense typography CSS without requiring data-ao-media', () => {
    const md = renderSlidesMd(deckWith(null, { bulletCount: 7, bulletText: LONG_BULLET }));
    expect(md).toContain('data-ao-dense="1"');
    expect(md).not.toContain('data-ao-media');
    const html = previewHtmlFromSlidesMd(md);
    // sibling selector — dense type must not be gated on [data-ao-media]
    expect(html).toMatch(/\.ao-slide\[data-ao-dense\] > ul\.ao-el/);
    expect(html).toMatch(/\.ao-slide\[data-ao-dense\] li\.ao-el\{[^}]*font-size:1\.9vw/);
  });
});
