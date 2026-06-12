import type { FormatAdapter, ReportRenderContext, RenderArtifact } from '../format/types.js';
import { extractMermaidCode, withPdfMermaid } from '../chart/embed.js';
import { renderMermaid } from '../chart/mermaid-render.js';
import { stripAiFlavorDeep } from '../text/deai.js';
import type { PdfReportPayload } from './types.js';
import { getPdfPayloadFromContext } from './types.js';
import { validatePdfPayload } from './validate.js';
import { renderPdfWithPlaywright } from './run-playwright.js';

export function createPdfAdapter(): FormatAdapter {
  return {
    format: 'pdf',
    async finalize(_intermediate: string, ctx: ReportRenderContext): Promise<RenderArtifact> {
      const raw = getPdfPayloadFromContext(ctx);
      if (!raw) {
        throw new Error(
          'pdf format requires ctx.data.pdf with theme, title, sections (see PdfReportPayload)',
        );
      }
      const mermaidCode = extractMermaidCode(ctx.data as Record<string, unknown>);
      let rendered = null;
      if (mermaidCode) {
        const preferred = await renderMermaid(mermaidCode, { target: 'svg' });
        rendered =
          preferred.target === 'svg' || preferred.target === 'png'
            ? preferred
            : await renderMermaid(mermaidCode, { target: 'png' });
      }
      const payload = withPdfMermaid(
        stripAiFlavorDeep(raw) as PdfReportPayload,
        mermaidCode,
        rendered,
      );
      const check = validatePdfPayload(payload);
      if (!check.ok) {
        const first = check.issues.find((i) => i.severity === 'error');
        throw new Error(first?.message ?? 'pdf payload validation failed');
      }
      const buf = await renderPdfWithPlaywright(payload);
      return {
        mime: 'application/pdf',
        body: buf.toString('base64'),
        encoding: 'base64',
      };
    },
  };
}
