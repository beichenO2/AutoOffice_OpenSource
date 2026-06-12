import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { ChartRenderResult, ChartRendererOptions, RenderTarget } from './types.js';

const execFileAsync = promisify(execFile);
const ALLOWED_MERMAID_THEMES = new Set(['default', 'dark', 'forest', 'neutral']);

function normalizeTheme(theme?: string): string {
  return theme && ALLOWED_MERMAID_THEMES.has(theme) ? theme : 'default';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsSingleQuoted(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function wrapMermaidHtml(code: string, theme: string = 'default'): string {
  const safeTheme = normalizeTheme(theme);
  return `<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: '${escapeJsSingleQuoted(safeTheme)}' });</script>
</head><body>
<pre class="mermaid">
${escapeHtml(code)}
</pre>
</body></html>`;
}

function renderToHtmlEmbed(code: string, opts: ChartRendererOptions): ChartRenderResult {
  return {
    target: 'html-embed',
    data: wrapMermaidHtml(code, opts.theme),
    encoding: 'utf-8',
    mime: 'text/html',
  };
}

async function renderWithMmdc(
  code: string,
  target: 'svg' | 'png',
  opts: ChartRendererOptions,
): Promise<ChartRenderResult | null> {
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), 'mermaid-'));
    const inputPath = join(dir, 'input.mmd');
    const outputPath = join(dir, `output.${target}`);
    const theme = normalizeTheme(opts.theme);

    await writeFile(inputPath, code);

    // `execFile` bypasses a shell; keep the theme constrained anyway so the
    // local CLI and HTML embed paths both share the same safe parameter set.
    const args = ['-i', inputPath, '-o', outputPath, '-t', theme];
    if (target === 'png' && opts.width) {
      args.push('-w', String(opts.width));
    }

    await execFileAsync('mmdc', args, { timeout: 30000 });

    const data = await readFile(outputPath);

    if (target === 'svg') {
      return { target: 'svg', data: data.toString('utf-8'), encoding: 'utf-8', mime: 'image/svg+xml' };
    }
    return { target: 'png', data: data.toString('base64'), encoding: 'base64', mime: 'image/png' };
  } catch {
    return null;
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function renderWithKroki(
  code: string,
  target: 'svg' | 'png',
): Promise<ChartRenderResult | null> {
  try {
    const url = `https://kroki.io/mermaid/${target}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    if (target === 'svg') {
      const text = await response.text();
      return { target: 'svg', data: text, encoding: 'utf-8', mime: 'image/svg+xml' };
    }

    const buffer = await response.arrayBuffer();
    return {
      target: 'png',
      data: Buffer.from(buffer).toString('base64'),
      encoding: 'base64',
      mime: 'image/png',
    };
  } catch {
    return null;
  }
}

/**
 * Render Mermaid diagram to SVG, PNG, or embeddable HTML.
 * Strategy: mmdc (local CLI) → optional kroki.io (explicit opt-in) → HTML embed (fallback).
 */
export async function renderMermaid(
  code: string,
  opts: ChartRendererOptions = {},
): Promise<ChartRenderResult> {
  const target: RenderTarget = opts.target || 'svg';

  if (target === 'html-embed') {
    return renderToHtmlEmbed(code, opts);
  }

  const mmdcResult = await renderWithMmdc(code, target, opts);
  if (mmdcResult) return mmdcResult;

  // Privacy-safe default: only send diagram source to remote renderers when the
  // caller explicitly opts in.
  if (opts.allowRemote === true) {
    const krokiResult = await renderWithKroki(code, target);
    if (krokiResult) return krokiResult;
  }

  return renderToHtmlEmbed(code, opts);
}

export { wrapMermaidHtml };
