import { describe, expect, it, vi } from 'vitest';
import { MAX_BULLETS_PER_SLIDE } from '../src/ppt/validate.js';
import type { PptxDeckPayload } from '../src/ppt/types.js';

const renderMermaidMock = vi.hoisted(() =>
  vi.fn(async () => ({
    target: 'png' as const,
    data: 'ZmFrZS1wbmc=',
    encoding: 'base64' as const,
    mime: 'image/png',
  })),
);

const renderPptxMock = vi.hoisted(() =>
  vi.fn(async () => Buffer.from('fake-pptx')),
);

vi.mock('../src/chart/mermaid-render.js', () => ({
  renderMermaid: renderMermaidMock,
}));

vi.mock('../src/ppt/run-pptxgenjs.js', () => ({
  renderPptxWithPptxGenJS: renderPptxMock,
}));

import { createPptxAdapter, enforceBulletLimit } from '../src/ppt/pptx-adapter.js';

describe('pptx adapter', () => {
  it('preserves mermaid chart fields while truncating bullets', () => {
    const payload: PptxDeckPayload = {
      theme: 'minimal',
      locale: 'zh-CN',
      title: 'Deck',
      slides: [
        {
          title: 'Intro',
          bullets: ['1', '2', '3', '4', '5', '6', '7'],
        },
        {
          title: 'Mermaid 架构图',
          bullets: [],
          chart_png_base64: 'ZmFrZS1wbmc=',
          chart_alt: 'graph TD\n  A --> B',
        },
      ],
    };

    const limited = enforceBulletLimit(payload);

    expect(limited.slides[0]?.bullets).toEqual(payload.slides[0]?.bullets.slice(0, MAX_BULLETS_PER_SLIDE));
    expect(limited.slides[1]).toEqual(payload.slides[1]);
    expect(payload.slides[0]?.bullets).toHaveLength(7);
  });

  it('disables remote mermaid fallback during ppt export', async () => {
    renderMermaidMock.mockClear();
    renderPptxMock.mockClear();

    const adapter = createPptxAdapter();
    await adapter.finalize('ignored', {
      format: 'pptx',
      data: {
        mermaid: 'graph TD\n  A --> B',
        pptx: {
          theme: 'minimal',
          locale: 'zh-CN',
          title: 'Deck',
          slides: [{ title: 'Intro', bullets: ['Overview'] }],
        },
      },
      template: { kind: 'inline', source: 'ignored' },
      locale: 'zh-CN',
    });

    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD\n  A --> B', {
      target: 'png',
      allowRemote: false,
    });

    expect(renderPptxMock).toHaveBeenCalledTimes(1);
    expect(renderPptxMock.mock.calls[0]?.[0]).toMatchObject({
      slides: [
        { title: 'Intro', bullets: ['Overview'] },
        {
          title: 'Mermaid 架构图',
          chart_png_base64: 'ZmFrZS1wbmc=',
          chart_alt: 'graph TD\n  A --> B',
        },
      ],
    });
  });
});
