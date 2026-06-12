import type { FormatAdapter, ReportRenderContext, RenderArtifact } from '../format/types.js';
import { extractMermaidCode, withLatexMermaid } from '../chart/embed.js';
import { renderMermaid } from '../chart/mermaid-render.js';
import { stripAiFlavorDeep } from '../text/deai.js';
import type { LatexReportPayload } from './types.js';
import { getLatexPayloadFromContext } from './types.js';
import { assertValidLatexPayload } from './validate.js';
import { renderLatexSource, renderLatexToPdf } from './run-xelatex.js';

export function createLatexPdfAdapter(): FormatAdapter {
  return {
    format: 'latex-pdf',
    async finalize(_intermediate: string, ctx: ReportRenderContext): Promise<RenderArtifact> {
      const raw = getLatexPayloadFromContext(ctx);
      if (!raw) {
        throw new Error(
          'latex-pdf format requires ctx.data.latex with theme, title, sections (see LatexReportPayload)',
        );
      }
      const mermaidCode = extractMermaidCode(ctx.data as Record<string, unknown>);
      let rendered = null;
      if (mermaidCode) {
        try {
          rendered = await renderMermaid(mermaidCode, { target: 'png', allowRemote: false });
        } catch {
          rendered = null;
        }
      }
      const payload = withLatexMermaid(
        stripAiFlavorDeep(raw) as LatexReportPayload,
        mermaidCode,
        rendered?.target === 'png' ? rendered : null,
      );
      assertValidLatexPayload(payload);
      const pdfBuffer = await renderLatexToPdf(payload);
      return {
        mime: 'application/pdf',
        body: pdfBuffer.toString('base64'),
        encoding: 'base64',
      };
    },
  };
}

export function createLatexAdapter(): FormatAdapter {
  return {
    format: 'latex',
    async finalize(_intermediate: string, ctx: ReportRenderContext): Promise<RenderArtifact> {
      const raw = getLatexPayloadFromContext(ctx);
      if (!raw) {
        throw new Error(
          'latex format requires ctx.data.latex with theme, title, sections (see LatexReportPayload)',
        );
      }
      const mermaidCode = extractMermaidCode(ctx.data as Record<string, unknown>);
      // Keep LaTeX rendering local-only so Mermaid source never leaves the machine.
      let rendered = null;
      if (mermaidCode) {
        try {
          rendered = await renderMermaid(mermaidCode, { target: 'png', allowRemote: false });
        } catch {
          rendered = null;
        }
      }
      const payload = withLatexMermaid(
        stripAiFlavorDeep(raw) as LatexReportPayload,
        mermaidCode,
        rendered?.target === 'png' ? rendered : null,
      );
      // `math` is emitted verbatim into the LaTeX template, so validate after enrichment.
      assertValidLatexPayload(payload);
      const texSource = await renderLatexSource(payload);
      return {
        mime: 'application/x-tex',
        body: texSource,
        encoding: 'utf-8',
      };
    },
  };
}
