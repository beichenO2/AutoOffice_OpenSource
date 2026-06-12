import type { ChartRenderResult } from './types.js';
import type { PptxDeckPayload, PptxSlideInput } from '../ppt/types.js';
import type { PdfReportPayload, PdfSectionInput } from '../pdf/types.js';
import type { DocxReportPayload, DocxSectionInput } from '../docx/types.js';
import type { LatexReportPayload, LatexSectionInput } from '../latex/types.js';

type MermaidRenderable = Pick<ChartRenderResult, 'target' | 'data' | 'encoding' | 'mime'>;

function trimCode(code: string): string {
  return code.trim();
}

function fallbackBullets(code: string): string[] {
  const lines = trimCode(code)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => (line.length > 80 ? `${line.slice(0, 77)}...` : line));

  return [
    'Mermaid 图在当前环境中未生成位图，以下附源码摘要。',
    ...(lines.length > 0 ? lines : ['graph TD']),
  ];
}

function fallbackBody(code: string): string {
  return ['Mermaid 图源码如下：', '```mermaid', trimCode(code), '```'].join('\n');
}

export function extractMermaidCode(data: Record<string, unknown>): string | null {
  const raw = data['mermaid'];
  if (typeof raw !== 'string') return null;
  const code = trimCode(raw);
  return code.length > 0 ? code : null;
}

export function withPptxMermaid(
  payload: PptxDeckPayload,
  mermaidCode: string | null,
  rendered: MermaidRenderable | null,
): PptxDeckPayload {
  if (!mermaidCode) return payload;

  const slide: PptxSlideInput =
    rendered?.target === 'png'
      ? {
          title: 'Mermaid 架构图',
          bullets: [],
          chart_png_base64: rendered.data,
          chart_alt: mermaidCode,
        }
      : {
          title: 'Mermaid 架构图',
          bullets: fallbackBullets(mermaidCode),
        };

  return { ...payload, slides: [...payload.slides, slide] };
}

export function withPdfMermaid(
  payload: PdfReportPayload,
  mermaidCode: string | null,
  rendered: MermaidRenderable | null,
): PdfReportPayload {
  if (!mermaidCode) return payload;

  const section: PdfSectionInput =
    rendered && (rendered.target === 'svg' || rendered.target === 'png')
      ? {
          heading: 'Mermaid 架构图',
          level: 1,
          body: '',
          chart: {
            kind: rendered.target,
            data: rendered.data,
            encoding: rendered.encoding,
            mime: rendered.mime,
          },
        }
      : {
          heading: 'Mermaid 架构图',
          level: 1,
          body: fallbackBody(mermaidCode),
        };

  return { ...payload, sections: [...payload.sections, section] };
}

export function withDocxMermaid(
  payload: DocxReportPayload,
  mermaidCode: string | null,
  rendered: MermaidRenderable | null,
): DocxReportPayload {
  if (!mermaidCode) return payload;

  const section: DocxSectionInput =
    rendered?.target === 'png'
      ? {
          heading: 'Mermaid 架构图',
          level: 1,
          body: 'Mermaid 图已嵌入下方。',
          chartPngBase64: rendered.data,
        }
      : {
          heading: 'Mermaid 架构图',
          level: 1,
          body: fallbackBody(mermaidCode),
        };

  return { ...payload, sections: [...payload.sections, section] };
}

export function withLatexMermaid(
  payload: LatexReportPayload,
  mermaidCode: string | null,
  rendered: MermaidRenderable | null,
): LatexReportPayload {
  if (!mermaidCode) return payload;

  const trimmedCode = trimCode(mermaidCode);
  const section: LatexSectionInput =
    rendered?.target === 'png'
      ? {
          heading: 'Mermaid 架构图',
          level: 1,
          body: 'Mermaid 图如下。',
          chartPngBase64: rendered.data,
          mermaidCode: trimmedCode,
        }
      : {
          heading: 'Mermaid 架构图',
          level: 1,
          body: 'Mermaid 图源码见下方。',
          mermaidCode: trimmedCode,
        };

  return { ...payload, sections: [...payload.sections, section] };
}
