import type { FormatAdapter, ReportRenderContext, RenderArtifact } from '../format/types.js';
import { extractMermaidCode, withPptxMermaid } from '../chart/embed.js';
import { renderMermaid } from '../chart/mermaid-render.js';
import { stripAiFlavorDeep } from '../text/deai.js';
import type { PptxDeckPayload } from './types.js';
import { getPptxPayloadFromContext } from './types.js';
import { renderPptxWithPptxGenJS } from './run-pptxgenjs.js';
import { MAX_BULLETS_PER_SLIDE, validatePptxPayload } from './validate.js';

export function enforceBulletLimit(payload: PptxDeckPayload): PptxDeckPayload {
  const slides = payload.slides.map((s) => ({
    ...s,
    bullets: s.bullets.slice(0, MAX_BULLETS_PER_SLIDE),
  }));
  return { ...payload, slides };
}

export function createPptxAdapter(): FormatAdapter {
  return {
    format: 'pptx',
    async finalize(_intermediate: string, ctx: ReportRenderContext): Promise<RenderArtifact> {
      const raw = getPptxPayloadFromContext(ctx);
      if (!raw) {
        throw new Error(
          'pptx format requires ctx.data.pptx with theme, title, slides (see PptxDeckPayload)',
        );
      }
      const mermaidCode = extractMermaidCode(ctx.data as Record<string, unknown>);
      const rendered = mermaidCode
        ? await renderMermaid(mermaidCode, { target: 'png', allowRemote: false })
        : null;
      const payload = enforceBulletLimit(
        withPptxMermaid(stripAiFlavorDeep(raw) as PptxDeckPayload, mermaidCode, rendered),
      );
      const check = validatePptxPayload(payload);
      if (!check.ok) {
        const first = check.issues.find((i) => i.severity === 'error');
        throw new Error(first?.message ?? 'pptx payload validation failed');
      }
      const buf = await renderPptxWithPptxGenJS(payload);
      return {
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        body: buf.toString('base64'),
        encoding: 'base64',
      };
    },
  };
}
