import { describe, it, expect } from 'vitest';
import {
  extractMermaidCode,
  withPptxMermaid,
  withPdfMermaid,
  withDocxMermaid,
  withLatexMermaid,
} from '../src/chart/embed.js';
import type { PptxDeckPayload } from '../src/ppt/types.js';
import type { PdfReportPayload } from '../src/pdf/types.js';
import type { DocxReportPayload } from '../src/docx/types.js';
import type { LatexReportPayload } from '../src/latex/types.js';

const MERMAID = 'graph TD\n  A[Start] --> B[End]';
const PNG_RENDER = { target: 'png', data: 'ZmFrZS1wbmc=', encoding: 'base64', mime: 'image/png' } as const;
const SVG_RENDER = { target: 'svg', data: '<svg><text>fake</text></svg>', encoding: 'utf-8', mime: 'image/svg+xml' } as const;

function pptxBase(): PptxDeckPayload {
  return {
    theme: 'minimal',
    locale: 'zh-CN',
    title: 'Deck',
    slides: [{ title: 'Intro', bullets: ['One'] }],
  };
}

function pdfBase(): PdfReportPayload {
  return {
    theme: 'minimal',
    locale: 'zh-CN',
    title: 'PDF',
    sections: [{ heading: '正文', body: '内容' }],
  };
}

function docxBase(): DocxReportPayload {
  return {
    theme: 'minimal',
    locale: 'zh-CN',
    title: 'DOCX',
    sections: [{ heading: '正文', body: '内容' }],
  };
}

function latexBase(): LatexReportPayload {
  return {
    theme: 'article',
    locale: 'en-US',
    title: 'LaTeX',
    sections: [{ heading: 'Intro', body: 'Body' }],
  };
}

describe('chart embed helpers', () => {
  it('extracts trimmed mermaid code', () => {
    expect(extractMermaidCode({ mermaid: `\n${MERMAID}\n` })).toBe(MERMAID);
    expect(extractMermaidCode({ mermaid: 123 })).toBeNull();
    expect(extractMermaidCode({})).toBeNull();
  });

  it('adds fallback Mermaid slide to pptx payload', () => {
    const payload = withPptxMermaid(pptxBase(), MERMAID, null);
    expect(payload.slides).toHaveLength(2);
    expect(payload.slides[1]?.title).toBe('Mermaid 架构图');
    expect(payload.slides[1]?.bullets[0]).toContain('未生成位图');
  });

  it('adds PNG Mermaid slide to pptx payload when rendered', () => {
    const payload = withPptxMermaid(pptxBase(), MERMAID, PNG_RENDER);
    expect(payload.slides[1]?.chart_png_base64).toBe(PNG_RENDER.data);
    expect(payload.slides[1]?.bullets).toEqual([]);
  });

  it('adds rendered chart payload for pdf', () => {
    const payload = withPdfMermaid(pdfBase(), MERMAID, SVG_RENDER);
    expect(payload.sections[1]?.chart?.kind).toBe('svg');
    expect(payload.sections[1]?.chart?.data).toBe(SVG_RENDER.data);
  });

  it('adds fallback Mermaid body for pdf when no render is available', () => {
    const payload = withPdfMermaid(pdfBase(), MERMAID, null);
    expect(payload.sections[1]?.body).toContain('```mermaid');
  });

  it('adds PNG chart payload for docx', () => {
    const payload = withDocxMermaid(docxBase(), MERMAID, PNG_RENDER);
    expect(payload.sections[1]?.chartPngBase64).toBe(PNG_RENDER.data);
  });

  it('adds inline PNG chart payload for latex when rendered', () => {
    const payload = withLatexMermaid(latexBase(), MERMAID, PNG_RENDER);
    expect(payload.sections[1]?.chartPngBase64).toBe(PNG_RENDER.data);
    expect(payload.sections[1]?.mermaidCode).toBe(MERMAID);
    expect(payload.sections[1]?.body).toContain('Mermaid 图如下');
  });

  it('falls back to Mermaid source block for latex when no PNG render is available', () => {
    const payload = withLatexMermaid(latexBase(), MERMAID, null);
    expect(payload.sections[1]?.mermaidCode).toBe(MERMAID);
    expect(payload.sections[1]?.body).toContain('源码');
  });
});
