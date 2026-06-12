import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  runReportPipeline,
  registerFormatAdapters,
} from '../src/index.js';

const { VALID_PNG_BASE64, renderMermaidMock } = vi.hoisted(() => {
  const buf = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  const validPngBase64 = buf.toString('base64');
  return {
    VALID_PNG_BASE64: validPngBase64,
    renderMermaidMock: vi.fn(async () => ({
      target: 'png' as const,
      data: validPngBase64,
      encoding: 'base64' as const,
      mime: 'image/png',
    })),
  };
});

vi.mock('../src/chart/mermaid-render.js', () => ({
  renderMermaid: renderMermaidMock,
  wrapMermaidHtml: (code: string) => `<pre class="mermaid">${code}</pre>`,
}));

beforeAll(() => {
  registerFormatAdapters();
});

describe('report pipeline', () => {
  it('returns html passthrough when format is html', async () => {
    const artifact = await runReportPipeline({
      format: 'html',
      data: { headline: '测试' },
      template: { kind: 'inline', source: '<h1>{{headline}}</h1>' },
      locale: 'zh-CN',
    });
    expect(artifact.mime).toBe('text/html');
    expect(artifact.body).toContain('测试');
  });

  it('latex adapter generates tex source from structured payload', async () => {
    const artifact = await runReportPipeline({
      format: 'latex',
      data: {
        latex: {
          theme: 'article',
          locale: 'en-US',
          title: 'Test Paper',
          sections: [{ heading: 'Introduction', body: 'Some content here.' }],
        },
      },
      template: { kind: 'inline', source: 'ignored' },
    });
    expect(artifact.mime).toBe('application/x-tex');
    expect(artifact.body).toContain('\\documentclass');
    expect(artifact.body).toContain('Test Paper');
  });

  it('latex adapter embeds Mermaid PNG when provided', async () => {
    renderMermaidMock.mockClear();
    const artifact = await runReportPipeline({
      format: 'latex',
      data: {
        mermaid: 'graph TD\n  A --> B',
        latex: {
          theme: 'article',
          locale: 'en-US',
          title: 'Diagram Note',
          sections: [{ heading: 'Overview', body: 'Some content here.' }],
        },
      },
      template: { kind: 'inline', source: 'ignored' },
    });
    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD\n  A --> B', {
      target: 'png',
      allowRemote: false,
    });
    expect(artifact.body).toContain('\\inlineimg{mermaid-diagram-2.png}{%');
    expect(artifact.body).toContain(VALID_PNG_BASE64);
  });

  it('latex adapter falls back to Mermaid source when local rendering throws', async () => {
    renderMermaidMock.mockClear();
    renderMermaidMock.mockRejectedValueOnce(new Error('mmdc failed'));

    const artifact = await runReportPipeline({
      format: 'latex',
      data: {
        mermaid: 'graph TD\n  A --> B',
        latex: {
          theme: 'article',
          locale: 'en-US',
          title: 'Diagram Note',
          sections: [{ heading: 'Overview', body: 'Some content here.' }],
        },
      },
      template: { kind: 'inline', source: 'ignored' },
    });

    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD\n  A --> B', {
      target: 'png',
      allowRemote: false,
    });
    expect(artifact.body).toContain('\\begin{verbatim}');
    expect(artifact.body).toContain('graph TD');
    expect(artifact.body).not.toContain('\\inlineimg{mermaid-diagram-2.png}{%');
  });
});
