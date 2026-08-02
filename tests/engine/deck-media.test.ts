/**
 * Two-column media layout ("字左·图右"): image aspect detection + the
 * data-ao-media wiring that drives the CSS. Guards the regression where the
 * renderer emitted data-ao-media="tall|wide|square" but the CSS only matched
 * a (never-emitted) "split" value, so the layout never triggered and tall
 * images fell back to the shrunk-thumbnail rule.
 */
import { describe, it, expect } from 'vitest';
import { imageAspect, renderSlidesMd, previewHtmlFromSlidesMd } from '../../src/engine/slidev/generate.js';
import type { DeckSpec } from '../../src/engine/html/generate.js';

const svg = (w: number, h: number, viewBoxOnly = false): string => {
  const dims = viewBoxOnly ? `viewBox="0 0 ${w} ${h}"` : `width="${w}" height="${h}"`;
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${dims}></svg>`).toString('base64');
};

const pngDataUri = (w: number, h: number): string => {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; // \x89PNG
  buf.writeUInt32BE(w, 16); // IHDR width
  buf.writeUInt32BE(h, 20); // IHDR height
  return 'data:image/png;base64,' + buf.toString('base64');
};

const gifDataUri = (w: number, h: number): string => {
  const buf = Buffer.alloc(24);
  buf[0] = 0x47; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x38; // GIF8
  buf.writeUInt16LE(w, 6);
  buf.writeUInt16LE(h, 8);
  return 'data:image/gif;base64,' + buf.toString('base64');
};

const jpegDataUri = (w: number, h: number, withApp0 = false): string => {
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  if (withApp0) {
    const app0 = Buffer.alloc(18);
    app0[0] = 0xff; app0[1] = 0xe0; app0.writeUInt16BE(16, 2); // APP0, len 16 → skip 18 bytes total
    chunks.push(app0);
  }
  const sof = Buffer.alloc(11);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 0x08; // SOF0
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  chunks.push(sof, Buffer.alloc(16)); // pad past the length guard
  return 'data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64');
};

describe('imageAspect', () => {
  it('measures SVG data URIs by width/height and by viewBox fallback', () => {
    expect(imageAspect(svg(460, 1100))).toBeCloseTo(460 / 1100, 5);
    expect(imageAspect(svg(1000, 400, true))).toBeCloseTo(1000 / 400, 5);
  });

  it('measures raster data URIs — PNG / GIF / JPEG headers', () => {
    expect(imageAspect(pngDataUri(400, 1000))).toBeCloseTo(0.4, 5); // tall screenshot
    expect(imageAspect(gifDataUri(300, 150))).toBeCloseTo(2.0, 5);
    expect(imageAspect(jpegDataUri(600, 600))).toBeCloseTo(1.0, 5);
    expect(imageAspect(jpegDataUri(1600, 900, true))).toBeCloseTo(1600 / 900, 5); // skips APP0
  });

  it('returns null for unmeasurable / non-data srcs', () => {
    expect(imageAspect(undefined)).toBeNull();
    expect(imageAspect('https://example.com/photo.png')).toBeNull();
    expect(imageAspect('data:image/svg+xml;base64,' + Buffer.from('<svg></svg>').toString('base64'))).toBeNull();
  });
});

// A long, GLM-style bullet (~40 CJK chars) — wraps to multiple lines in any media
// column, so a few of them make a slide text-dense (mirrors the real p9 case).
const LONG_BULLET = '这是一条比较长的要点用来模拟真实生成的密集文案需要换行到第二行甚至第三行占用更多竖直空间';

const deckWith = (
  imgSrc: string | null,
  opts: { bullets?: boolean; bulletCount?: number; bulletText?: string; layout?: string; paragraph?: boolean } = {},
): DeckSpec => {
  const elements: DeckSpec['slides'][number]['elements'] = [];
  if (opts.paragraph) elements.push({ id: 'p', type: 'paragraph', text: '引导段' });
  const n = opts.bulletCount ?? (opts.bullets === false ? 0 : 2);
  for (let i = 0; i < n; i++) elements.push({ id: `b${i + 1}`, type: 'bullet', text: opts.bulletText ?? `要点${i + 1}` });
  if (imgSrc) elements.push({ id: 'img', type: 'image', src: imgSrc, alt: '图' });
  return { title: 't', slides: [{ layout: (opts.layout ?? 'content') as never, title: '标题', elements }] };
};

describe('renderSlidesMd — data-ao-media (two-column trigger)', () => {
  it('emits tall / square / wide from the image aspect when paired with text', () => {
    expect(renderSlidesMd(deckWith(svg(460, 1100)))).toContain('data-ao-media="tall"');
    expect(renderSlidesMd(deckWith(svg(640, 640)))).toContain('data-ao-media="square"');
    expect(renderSlidesMd(deckWith(svg(1000, 420)))).toContain('data-ao-media="wide"');
  });

  it('classifies a tall RASTER screenshot as tall (not the old wide default)', () => {
    const md = renderSlidesMd(deckWith(pngDataUri(500, 1400)));
    expect(md).toContain('data-ao-media="tall"');
  });

  it('falls back to a balanced split for an unmeasurable image', () => {
    const md = renderSlidesMd(deckWith('https://example.com/x.png'));
    expect(md).toContain('data-ao-media="square"');
  });

  it('does not split when the image has no accompanying text, or on a title slide', () => {
    expect(renderSlidesMd(deckWith(svg(460, 1100), { bullets: false }))).not.toContain('data-ao-media');
    expect(renderSlidesMd(deckWith(svg(460, 1100), { layout: 'title' }))).not.toContain('data-ao-media');
  });
});

describe('preview CSS matches the emitted attribute (regression guard)', () => {
  it('the emitted data-ao-media value is actually styled, and the dead "split" rule is gone', () => {
    const md = renderSlidesMd(deckWith(svg(460, 1100)));
    expect(md).toContain('data-ao-media="tall"');
    const html = previewHtmlFromSlidesMd(md);
    // attribute-presence selector matches every emitted value → layout always triggers
    expect(html).toContain('.ao-slide[data-ao-media]');
    // the figure is placed as a full-height right-hand column
    expect(html).toMatch(/\.ao-slide\[data-ao-media\][^{]*img\.ao-el\{[^}]*position:absolute/);
    // the never-emitted, dead selector must not come back
    expect(html).not.toContain('data-ao-media="split"');
  });
});

describe('renderSlidesMd — data-ao-dense (density-adaptive figure sizing)', () => {
  it('keeps a light-copy figure slide full-height (no data-ao-dense)', () => {
    // a tall screenshot with only a few short bullets fits beside a full-height
    // figure → stays big (the user's "看得清" case)
    expect(renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 4 }))).not.toContain('data-ao-dense');
    // a couple of short bullets + a lead paragraph is still light
    expect(
      renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 3, paragraph: true })),
    ).not.toContain('data-ao-dense');
  });

  it('marks a text-dense figure slide so the figure floats and the copy reflows', () => {
    // a long list of bullets → dense
    expect(renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 8 }))).toContain('data-ao-dense="1"');
    // FEW but LONG bullets are also dense — the real GLM p9 case (4 long bullets that
    // wrap to many lines and overflowed 284px at full height)
    expect(
      renderSlidesMd(deckWith(svg(1000, 420), { bulletCount: 4, bulletText: LONG_BULLET })),
    ).toContain('data-ao-dense="1"');
    expect(
      renderSlidesMd(deckWith(pngDataUri(500, 1400), { bulletCount: 5, bulletText: LONG_BULLET })),
    ).toContain('data-ao-dense="1"');
  });

  it('never marks density without the two-column media layout (needs an image)', () => {
    // a text-only slide (no image) has no media column, so no density either
    expect(renderSlidesMd(deckWith(null, { bulletCount: 8 }))).not.toContain('data-ao-media');
    expect(renderSlidesMd(deckWith(null, { bulletCount: 8 }))).not.toContain('data-ao-dense');
  });
});

describe('renderSlidesMd — ultra-dense auto-condense (文案自动精简)', () => {
  it('condenses copy on an over-dense slide so it fits', () => {
    // many long bullets overflow even the float+reflow layout → auto-trim each
    const md = renderSlidesMd(deckWith(svg(1000, 420), { bulletCount: 6, bulletText: LONG_BULLET }));
    expect(md).toContain('data-ao-dense="1"'); // still the dense (float) layout
    expect(md).not.toContain(LONG_BULLET); // the full long text is no longer present verbatim
    expect(md).toContain('…'); // trimmed with an ellipsis
  });

  it('leaves a merely-dense slide (a few long bullets) full text — only tightens the type', () => {
    // 4 long bullets beside a TALL figure (wide left column) fit once tightened, so the
    // copy is kept intact — dense (tightened) but not condensed
    const md = renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 4, bulletText: LONG_BULLET }));
    expect(md).toContain('data-ao-dense="1"');
    expect(md).toContain(LONG_BULLET); // text preserved intact
  });

  it('never condenses a light slide', () => {
    // 2 long bullets beside a TALL figure (wide text column) is genuinely light → untouched
    const md = renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 2, bulletText: LONG_BULLET }));
    expect(md).not.toContain('data-ao-dense');
    expect(md).toContain(LONG_BULLET);
  });
});

describe('preview CSS — density-adaptive figure', () => {
  it('figure stays a big centred right panel; dense only tightens the copy (never floats)', () => {
    const html = previewHtmlFromSlidesMd(renderSlidesMd(deckWith(svg(460, 1100), { bulletCount: 8 })));
    // the dense slide carries the marker …
    expect(html).toContain('data-ao-dense="1"');
    // … the figure is an absolutely-positioned, vertically-centred panel (the "soul") …
    expect(html).toMatch(/\.ao-slide\[data-ao-media\] > img\.ao-el\{[^}]*position:absolute/);
    expect(html).toMatch(/\.ao-slide\[data-ao-media\] > img\.ao-el\{[^}]*translateY\(-50%\)/);
    // … the figure is NEVER floated (that made it a small corner box) …
    expect(html).not.toContain('float:right');
    // … dense only shrinks the type so more copy fits its left column.
    expect(html).toMatch(/data-ao-dense\] li\.ao-el\{[^}]*font-size:1\.9vw/);
  });
});
