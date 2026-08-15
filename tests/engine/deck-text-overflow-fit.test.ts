/**
 * U3 / L3 — Playwright measure-and-shrink ladder for text overflow.
 *
 * After preview render, real overflow (scrollHeight > clientHeight or child
 * bottoms past the slide box) must step --ao-body-font down to a readable
 * floor (~1.5vw / 18px). Heuristic path covers CI without Chromium; one
 * real Chromium test still exercises detect + fit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import {
  renderSlidesMd,
  previewHtmlFromSlidesMd,
  previewHtmlFittedFromSlidesMd,
} from '../../src/engine/slidev/generate.js';
import type { DeckSpec } from '../../src/engine/html/generate.js';
import {
  FIT_FLOOR_VW,
  FIT_FLOOR_PX,
  FIT_TITLE_FLOOR_VW,
  applyFitCssVars,
  applyFitLadder,
  detectSlideOverflow,
  applyFitLadderOnPage,
  fitPreviewHtml,
  nextFitStep,
  readFitBodyFontVw,
  readFitTitleFontVw,
} from '../../src/engine/text-fit.js';

const LONG_BULLET = '这是一条比较长的要点用来模拟真实生成的密集文案需要换行到第二行甚至第三行占用更多竖直空间';

function overflowingFixture(opts?: { bullets?: number; font?: string }): string {
  const n = opts?.bullets ?? 12;
  const font = opts?.font ?? '48px';
  const items = Array.from({ length: n }, (_, i) => `<li class="ao-el">${LONG_BULLET}${i + 1}</li>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{
  position:relative;width:1280px;height:720px;overflow:hidden;
  box-sizing:border-box;padding:48px 64px;
  --ao-body-font:${font};
  font-family:sans-serif;
}
.ao-slide li,.ao-slide p{font-size:var(--ao-body-font,48px);line-height:1.35;margin:0 0 8px}
ul{margin:0;padding:0;list-style:none}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-layout="content">
<ul class="ao-el">${items}</ul>
</div>
</body></html>`;
}

function sparseFixture(): string {
  return overflowingFixture({ bullets: 2, font: '20px' }).replace(LONG_BULLET, '短要点');
}

const LONG_TITLE =
  '这是一个超级超级超级超级超级长的封面标题需要很多行才能完整显示而且字号特别大所以会撑破幻灯片画布'.repeat(3);

function overflowingTitleFixture(opts?: { font?: string; layout?: 'title' | 'content' }): string {
  const font = opts?.font ?? '96px';
  const layout = opts?.layout ?? 'title';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{
  position:relative;width:1280px;height:720px;overflow:hidden;
  box-sizing:border-box;padding:48px 64px;
  --ao-title-font:${font};
  --ao-body-font:20px;
  font-family:sans-serif;
}
.ao-slide h1{font-size:var(--ao-title-font,96px);line-height:1.05;margin:0;max-width:92%}
.ao-slide[data-ao-fit] h1,.ao-slide[data-ao-fit] > h1.ao-el{font-size:var(--ao-title-font,2.4vw)}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-layout="${layout}">
<h1 class="ao-el" data-ao-id="slide-1-title">${LONG_TITLE}</h1>
</div>
</body></html>`;
}

describe('fit ladder constants + nextFitStep', () => {
  it('keeps a readable floor at 1.5vw / 18px', () => {
    expect(FIT_FLOOR_VW).toBe(1.5);
    expect(FIT_FLOOR_PX).toBe(18);
  });

  it('steps body font down and stops at the floor', () => {
    const next = nextFitStep(2.3);
    expect(next).not.toBeNull();
    expect(next!).toBeLessThan(2.3);
    expect(next!).toBeGreaterThanOrEqual(FIT_FLOOR_VW);
    expect(nextFitStep(FIT_FLOOR_VW)).toBeNull();
    expect(nextFitStep(1.2)).toBeNull();
  });
});

describe('applyFitCssVars — mutate dense CSS / inline vars', () => {
  it('stamps data-ao-fit and --ao-body-font on .ao-slide', () => {
    const html = applyFitCssVars(overflowingFixture(), 1.8);
    expect(html).toContain('data-ao-fit="1"');
    expect(html).toMatch(/--ao-body-font:\s*1\.8vw/);
    expect(readFitBodyFontVw(html)).toBeCloseTo(1.8, 5);
  });

  it('clamps requested font to the readable floor', () => {
    const html = applyFitCssVars(overflowingFixture(), 1.0);
    expect(readFitBodyFontVw(html)).toBe(FIT_FLOOR_VW);
    expect(html).toMatch(/--ao-body-font:\s*1\.5vw/);
  });

  it('stamps --ao-title-font so [data-ao-fit] h1 can bind', () => {
    const html = applyFitCssVars(overflowingTitleFixture(), 2.0, { titleFontVw: 3.2 });
    expect(html).toContain('data-ao-fit="1"');
    expect(html).toMatch(/--ao-title-font:\s*3\.2vw/);
    expect(readFitTitleFontVw(html)).toBeCloseTo(3.2, 5);
  });

  it('clamps requested title font to the title floor', () => {
    const html = applyFitCssVars(overflowingTitleFixture(), 2.0, { titleFontVw: 1.0 });
    expect(readFitTitleFontVw(html)).toBe(FIT_TITLE_FLOOR_VW);
  });
});

describe('applyFitLadder — heuristic (no browser)', () => {
  it('shrinks an overflowing text-only slide until the estimate fits or hits the floor', () => {
    const result = applyFitLadder(overflowingFixture({ bullets: 14, font: '4vw' }));
    expect(result.html).toContain('data-ao-fit="1"');
    expect(result.slides.length).toBeGreaterThanOrEqual(1);
    expect(result.slides[0]!.bodyFontVw).toBeGreaterThanOrEqual(FIT_FLOOR_VW);
    expect(result.slides[0]!.bodyFontVw).toBeLessThan(4);
    expect(result.slides[0]!.steps).toBeGreaterThan(0);
    expect(result.fitted || result.slides[0]!.hitFloor).toBe(true);
  });

  it('leaves a sparse slide alone', () => {
    const src = sparseFixture();
    const result = applyFitLadder(src);
    expect(result.fitted).toBe(true);
    expect(result.slides[0]!.steps).toBe(0);
    expect(result.html).not.toContain('data-ao-fit');
  });

  it('does not skip title-layout when the title overflows', () => {
    const result = applyFitLadder(overflowingTitleFixture({ font: '8vw', layout: 'title' }));
    expect(result.html).toContain('data-ao-fit="1"');
    expect(result.slides[0]!.steps).toBeGreaterThan(0);
    expect(result.slides[0]!.titleFontVw).toBeGreaterThanOrEqual(FIT_TITLE_FLOOR_VW);
    expect(result.slides[0]!.titleFontVw).toBeLessThan(8);
    expect(result.fitted || result.slides[0]!.hitTitleFloor).toBe(true);
  });
});

describe('Playwright detectSlideOverflow + applyFitLadderOnPage', () => {
  let browser: Browser | null = null;

  beforeAll(async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    browser = null;
  });

  async function open(html: string): Promise<Page> {
    const page = await browser!.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    return page;
  }

  it('detects real overflow on an intentionally overflowing text-only slide', async () => {
    const page = await open(overflowingFixture({ bullets: 12, font: '48px' }));
    try {
      const report = await detectSlideOverflow(page, '.ao-slide');
      expect(report.overflowing).toBe(true);
      expect(report.scrollOverflow || report.childOverflow).toBe(true);
      expect(report.scrollHeight).toBeGreaterThan(report.clientHeight);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('does not flag a sparse slide as overflowing', async () => {
    const page = await open(sparseFixture());
    try {
      const report = await detectSlideOverflow(page, '.ao-slide');
      expect(report.overflowing).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('applyFitLadderOnPage clears overflow and stays at or above the floor', async () => {
    const page = await open(overflowingFixture({ bullets: 12, font: '48px' }));
    try {
      const before = await detectSlideOverflow(page, '.ao-slide');
      expect(before.overflowing).toBe(true);

      const results = await applyFitLadderOnPage(page, '.ao-slide');
      expect(results).toHaveLength(1);
      expect(results[0]!.bodyFontVw).toBeGreaterThanOrEqual(FIT_FLOOR_VW);
      expect(results[0]!.steps).toBeGreaterThan(0);

      const after = await detectSlideOverflow(page, '.ao-slide');
      expect(after.overflowing).toBe(false);
      expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 1);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('applyFitLadderOnPage steps --ao-title-font on an overflowing title-layout slide', async () => {
    const page = await open(overflowingTitleFixture({ font: '96px', layout: 'title' }));
    try {
      const before = await detectSlideOverflow(page, '.ao-slide');
      expect(before.overflowing).toBe(true);

      const results = await applyFitLadderOnPage(page, '.ao-slide');
      expect(results).toHaveLength(1);
      expect(results[0]!.steps).toBeGreaterThan(0);
      expect(results[0]!.titleFontVw).toBeGreaterThanOrEqual(FIT_TITLE_FLOOR_VW);
      expect(results[0]!.titleFontVw).toBeLessThan(96 * (100 / 1280));

      const after = await detectSlideOverflow(page, '.ao-slide');
      expect(after.overflowing).toBe(false);
    } finally {
      await page.close();
    }
  }, 30_000);

  it('fitPreviewHtml mutates preview CSS vars so a forced-overflow deck fits', async () => {
    const deck: DeckSpec = {
      title: 't',
      slides: [
        {
          layout: 'content' as never,
          title: '标题',
          elements: Array.from({ length: 8 }, (_, i) => ({
            id: `b${i + 1}`,
            type: 'bullet' as const,
            text: LONG_BULLET,
          })),
        },
      ],
    };
    const preview = previewHtmlFromSlidesMd(renderSlidesMd(deck));
    const forced = preview.replace(
      /class="ao-slide"/,
      'class="ao-slide" data-ao-fit="1" style="--ao-body-font:3.8vw"',
    );
    expect(forced).toContain('--ao-body-font:3.8vw');

    const result = await fitPreviewHtml(forced);
    expect(result.html).toMatch(/--ao-body-font:\s*[\d.]+vw/);
    expect(result.slides[0]!.bodyFontVw).toBeGreaterThanOrEqual(FIT_FLOOR_VW);
    expect(result.slides[0]!.bodyFontVw).toBeLessThan(3.8);
    expect(result.fitted).toBe(true);

    const page = await open(result.html);
    try {
      const report = await detectSlideOverflow(page, '.ao-slide');
      expect(report.overflowing).toBe(false);
    } finally {
      await page.close();
    }
  }, 45_000);
});

describe('previewHtmlFittedFromSlidesMd — persist fit into served preview', () => {
  function overflowingDeckMd(): string {
    const deck: DeckSpec = {
      title: 'overflow-preview',
      slides: [
        {
          layout: 'content' as never,
          title: '密集页',
          elements: Array.from({ length: 14 }, (_, i) => ({
            id: `b${i + 1}`,
            type: 'bullet' as const,
            text: LONG_BULLET,
          })),
        },
      ],
    };
    return renderSlidesMd(deck);
  }

  it('bakes data-ao-fit into overflowing preview HTML (or clears overflow)', async () => {
    const md = overflowingDeckMd();
    const raw = previewHtmlFromSlidesMd(md);
    expect(raw).not.toMatch(/<div\b[^>]*\bao-slide\b[^>]*\bdata-ao-fit=/);

    const fitted = await previewHtmlFittedFromSlidesMd(md);
    const stamped = /<div\b[^>]*\bao-slide\b[^>]*\bdata-ao-fit=/.test(fitted)
      || /<div\b[^>]*\bdata-ao-fit=[^>]*\bao-slide\b/.test(fitted);
    if (stamped) {
      expect(fitted).toMatch(/data-ao-fit="1"/);
      const vw = readFitBodyFontVw(fitted);
      if (vw != null) expect(vw).toBeGreaterThanOrEqual(FIT_FLOOR_VW);
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await page.setContent(fitted, { waitUntil: 'load' });
        const report = await detectSlideOverflow(page, '.ao-slide');
        expect(report.overflowing).toBe(false);
      } finally {
        await page.close();
        await browser.close();
      }
    }
  }, 45_000);
});

describe('preview CSS — [data-ao-fit] h1 binds --ao-title-font', () => {
  it('emits a fit-selector that sizes h1 from --ao-title-font', () => {
    const deck: DeckSpec = {
      title: 't',
      slides: [
        {
          layout: 'title' as never,
          title: '封面',
          elements: [{ id: 'h', type: 'heading' as const, text: '封面标题' }],
        },
      ],
    };
    const html = previewHtmlFromSlidesMd(renderSlidesMd(deck));
    expect(html).toMatch(/\[data-ao-fit\][^{]*h1[^{]*\{[^}]*--ao-title-font/);
    expect(html).toMatch(/--ao-title-font\s*:/);
  });
});
