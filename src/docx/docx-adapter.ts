import type { FormatAdapter, ReportRenderContext, RenderArtifact } from '../format/types.js';
import { extractMermaidCode, withDocxMermaid } from '../chart/embed.js';
import { renderMermaid } from '../chart/mermaid-render.js';
import { stripAiFlavorDeep } from '../text/deai.js';
import type { DocxReportPayload } from './types.js';
import { getDocxPayloadFromContext } from './types.js';
import { validateDocxPayload } from './validate.js';
import { renderDocxWithDocxJs } from './run-docx-js.js';

export function createDocxAdapter(): FormatAdapter {
  return {
    format: 'docx',
    async finalize(_intermediate: string, ctx: ReportRenderContext): Promise<RenderArtifact> {
      const raw = getDocxPayloadFromContext(ctx);
      if (!raw) {
        throw new Error(
          'docx format requires ctx.data.docx with theme, title, sections (see DocxReportPayload)',
        );
      }
      const mermaidCode = extractMermaidCode(ctx.data as Record<string, unknown>);
      const rendered = mermaidCode ? await renderMermaid(mermaidCode, { target: 'png' }) : null;
      const payload = withDocxMermaid(
        stripAiFlavorDeep(raw) as DocxReportPayload,
        mermaidCode,
        rendered,
      );
      const check = validateDocxPayload(payload);
      if (!check.ok) {
        const first = check.issues.find((i) => i.severity === 'error');
        throw new Error(first?.message ?? 'docx payload validation failed');
      }
      const buf = await renderDocxWithDocxJs(payload);
      return {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: buf.toString('base64'),
        encoding: 'base64',
      };
    },
  };
}
