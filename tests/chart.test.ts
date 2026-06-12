import { describe, it, expect, vi } from 'vitest';
import { renderMermaid, wrapMermaidHtml } from '../src/chart/mermaid-render.js';

describe('chart — mermaid render', () => {
  const SIMPLE_DIAGRAM = 'graph TD\n  A["Start"] --> B["End"]';

  it('wrapMermaidHtml produces valid HTML with mermaid script', () => {
    const html = wrapMermaidHtml(SIMPLE_DIAGRAM);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('mermaid.min.js');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('Start');
  });

  it('wrapMermaidHtml escapes angle brackets', () => {
    const code = 'graph TD\n  A["<script>alert(1)</script>"] --> B["End"]';
    const html = wrapMermaidHtml(code);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renderMermaid with html-embed target', async () => {
    const result = await renderMermaid(SIMPLE_DIAGRAM, { target: 'html-embed' });
    expect(result.target).toBe('html-embed');
    expect(result.encoding).toBe('utf-8');
    expect(result.mime).toBe('text/html');
    expect(result.data).toContain('mermaid');
  });

  it('renderMermaid with html-embed custom theme', async () => {
    const result = await renderMermaid(SIMPLE_DIAGRAM, { target: 'html-embed', theme: 'dark' });
    expect(result.data).toContain('dark');
  });

  it('wrapMermaidHtml falls back to default for unsafe theme values', () => {
    const html = wrapMermaidHtml(SIMPLE_DIAGRAM, "dark');alert('xss')");
    expect(html).not.toContain('alert');
    expect(html).toContain("theme: 'default'");
  });

  it('renderMermaid svg falls back gracefully when mmdc/kroki unavailable', async () => {
    const result = await renderMermaid(SIMPLE_DIAGRAM, { target: 'svg' });
    expect(['svg', 'html-embed']).toContain(result.target);
    expect(result.data.length).toBeGreaterThan(0);
  }, 20000);

  it('renderMermaid defaults to svg target', async () => {
    const result = await renderMermaid(SIMPLE_DIAGRAM);
    expect(['svg', 'html-embed']).toContain(result.target);
  }, 20000);

  it('renderMermaid keeps remote fallback opt-in by default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await renderMermaid(SIMPLE_DIAGRAM, { target: 'png' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 20000);

  it('renderMermaid skips remote fallback when allowRemote is false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await renderMermaid(SIMPLE_DIAGRAM, { target: 'png', allowRemote: false });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(['png', 'html-embed']).toContain(result.target);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 20000);
});
