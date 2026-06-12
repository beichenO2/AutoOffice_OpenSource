import type { FormatAdapter, ReportRenderContext, RenderArtifact } from './types.js';
import { renderTemplateFile, renderTemplateString } from '../template/engine.js';

const adapters = new Map<string, FormatAdapter>();

export function registerFormatAdapter(adapter: FormatAdapter): void {
  adapters.set(adapter.format, adapter);
}

export function getFormatAdapter(format: string): FormatAdapter | undefined {
  return adapters.get(format);
}

/**
 * 统一管线：数据 → Handlebars 字符串 → 各格式适配器 finalize（当前为可替换桩，便于后续接 python-pptx / WeasyPrint / xelatex 等）
 */
export async function runReportPipeline<T extends Record<string, unknown>>(
  ctx: ReportRenderContext<T>,
): Promise<RenderArtifact> {
  let intermediate: string;
  if (ctx.template.kind === 'inline') {
    intermediate = await renderTemplateString(ctx.template.source, ctx.data);
  } else {
    intermediate = await renderTemplateFile(ctx.template.path, ctx.data);
  }

  const adapter = adapters.get(ctx.format);
  if (!adapter) {
    return {
      mime: 'text/html',
      body: intermediate,
      encoding: 'utf-8',
    };
  }
  return adapter.finalize(intermediate, ctx);
}
