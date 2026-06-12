import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../src/server.js';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const input = '<h1>Title</h1><script>alert("xss")</script><p>safe</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('Title');
    expect(result).toContain('safe');
  });

  it('strips event handlers', () => {
    const input = '<div onclick="alert(1)">hello</div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onclick');
    expect(result).toContain('hello');
  });

  it('preserves style tags', () => {
    const input = '<style>body { color: red; }</style><p>content</p>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<style>');
    expect(result).toContain('color: red');
  });

  it('preserves class and style attributes', () => {
    const input = '<div class="card" style="padding: 10px;">text</div>';
    const result = sanitizeHtml(input);
    expect(result).toContain('class="card"');
    expect(result).toContain('style="padding: 10px;"');
  });

  it('preserves valid HTML structure', () => {
    const input = '<h1>Title</h1><ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<h1>Title</h1>');
    expect(result).toContain('<li>Item 1</li>');
  });

  it('strips iframe tags', () => {
    const input = '<iframe src="evil.com"></iframe><p>safe</p>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('iframe');
    expect(result).toContain('safe');
  });
});
