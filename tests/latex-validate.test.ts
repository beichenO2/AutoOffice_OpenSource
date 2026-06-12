import { describe, it, expect } from 'vitest';
import { MAX_TITLE_CHARS, validateLatexPayload } from '../src/latex/validate.js';
import type { LatexReportPayload } from '../src/latex/types.js';

function base(): LatexReportPayload {
  return {
    theme: 'article',
    locale: 'en-US',
    title: 'Test Paper',
    sections: [{ heading: 'Introduction', body: 'Some content here.' }],
  };
}

function minimalPngBase64(): string {
  const buf = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  return buf.toString('base64');
}

describe('latex validation', () => {
  it('accepts valid payload', () => {
    expect(validateLatexPayload(base()).ok).toBe(true);
  });

  it('rejects missing title', () => {
    const p = { ...base(), title: '' };
    expect(validateLatexPayload(p).ok).toBe(false);
  });

  it('rejects titles that exceed the configured maximum length', () => {
    const p = { ...base(), title: 'T'.repeat(MAX_TITLE_CHARS + 1) };
    const r = validateLatexPayload(p);
    expect(r.issues.some((i) => i.code === 'meta.title.too_long')).toBe(true);
  });

  it('rejects invalid theme', () => {
    const p = { ...base(), theme: 'thesis' as LatexReportPayload['theme'] };
    expect(validateLatexPayload(p).ok).toBe(false);
  });

  it('rejects empty sections', () => {
    const p = { ...base(), sections: [] };
    expect(validateLatexPayload(p).ok).toBe(false);
  });

  it('rejects dangerous \\input command', () => {
    const p = base();
    p.sections = [{ heading: 'Hack', body: '\\input{/etc/passwd}' }];
    const r = validateLatexPayload(p);
    expect(r.issues.some((i) => i.code === 'security.dangerous_cmd')).toBe(true);
  });

  it('rejects dangerous commands in math payloads', () => {
    const p = base();
    p.sections = [{ heading: 'Equation', body: 'Safe body', math: '\\write18{touch /tmp/pwned}' }];
    const r = validateLatexPayload(p);
    expect(r.issues.some((i) => i.code === 'security.dangerous_cmd')).toBe(true);
  });

  it('rejects TeX file I/O primitives in math payloads', () => {
    const p = base();
    p.sections = [{
      heading: 'Equation',
      body: 'Safe body',
      math: '\\openout1=owned.txt\\write1{pwned}\\closeout1 x+y',
    }];
    const r = validateLatexPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'security.dangerous_cmd')).toBe(true);
  });

  it('accepts zh-CN locale', () => {
    const p = { ...base(), locale: 'zh-CN' as const };
    expect(validateLatexPayload(p).ok).toBe(true);
  });

  it('accepts beamer theme', () => {
    const p = { ...base(), theme: 'beamer' as const };
    expect(validateLatexPayload(p).ok).toBe(true);
  });

  it('warns on empty body', () => {
    const p = base();
    p.sections = [{ heading: 'Empty', body: '' }];
    const r = validateLatexPayload(p);
    expect(r.issues.some((i) => i.code === 'body.empty')).toBe(true);
  });

  it('rejects invalid chart PNG data', () => {
    const p = base();
    p.sections = [{ heading: 'Chart', body: 'Diagram', chartPngBase64: 'not-base64!' }];
    const r = validateLatexPayload(p);
    expect(r.issues.some((i) => i.code === 'chart.invalid_base64')).toBe(true);
  });

  it('rejects base64 chart data that is not a png', () => {
    const p = base();
    p.sections = [{
      heading: 'Chart',
      body: 'Diagram',
      chartPngBase64: Buffer.from('this is not a png').toString('base64'),
    }];
    const r = validateLatexPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.invalid_base64')).toBe(true);
  });

  it('rejects truncated PNG chart data', () => {
    const p = base();
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    p.sections = [{ heading: 'Chart', body: 'Diagram', chartPngBase64: sig.toString('base64') }];
    const r = validateLatexPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.invalid_base64')).toBe(true);
  });

  it('rejects PNG chart data without IHDR', () => {
    const p = base();
    const buf = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    buf.write('XXXX', 12, 'ascii');
    p.sections = [{ heading: 'Chart', body: 'Diagram', chartPngBase64: buf.toString('base64') }];
    const r = validateLatexPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.invalid_base64')).toBe(true);
  });

  it('accepts valid minimal PNG chart data', () => {
    const p = base();
    p.sections = [{ heading: 'Chart', body: 'Diagram', chartPngBase64: minimalPngBase64() }];
    expect(validateLatexPayload(p).ok).toBe(true);
  });
});
