import type { FormatAdapter, RenderArtifact } from './types.js';
import { registerFormatAdapter } from './pipeline.js';
import { createPptxAdapter } from '../ppt/pptx-adapter.js';
import { createPdfAdapter } from '../pdf/pdf-adapter.js';
import { createDocxAdapter } from '../docx/docx-adapter.js';
import { createLatexAdapter, createLatexPdfAdapter } from '../latex/latex-adapter.js';

function htmlAdapter(): FormatAdapter {
  return {
    format: 'html',
    async finalize(intermediate: string): Promise<RenderArtifact> {
      return { mime: 'text/html', body: intermediate, encoding: 'utf-8' };
    },
  };
}

export function registerFormatAdapters(): void {
  registerFormatAdapter(htmlAdapter());
  registerFormatAdapter(createPptxAdapter());
  registerFormatAdapter(createPdfAdapter());
  registerFormatAdapter(createDocxAdapter());
  registerFormatAdapter(createLatexAdapter());
  registerFormatAdapter(createLatexPdfAdapter());
}
