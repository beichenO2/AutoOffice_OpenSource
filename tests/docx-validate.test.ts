import { describe, it, expect } from 'vitest';
import { validateDocxPayload } from '../src/docx/validate.js';
import type { DocxReportPayload } from '../src/docx/types.js';

function base(): DocxReportPayload {
  return {
    theme: 'business',
    locale: 'zh-CN',
    title: '测试报告',
    sections: [{ heading: '第一节', body: '正文内容' }],
  };
}

describe('docx validation', () => {
  it('accepts valid payload', () => {
    expect(validateDocxPayload(base()).ok).toBe(true);
  });

  it('rejects missing title', () => {
    const p = { ...base(), title: '' };
    const r = validateDocxPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.title.missing')).toBe(true);
  });

  it('rejects invalid theme', () => {
    const p = { ...base(), theme: 'fancy' as DocxReportPayload['theme'] };
    const r = validateDocxPayload(p);
    expect(r.ok).toBe(false);
  });

  it('rejects empty sections', () => {
    const p = { ...base(), sections: [] };
    expect(validateDocxPayload(p).ok).toBe(false);
  });

  it('warns on empty body', () => {
    const p = base();
    p.sections = [{ heading: '空节', body: '' }];
    const r = validateDocxPayload(p);
    expect(r.issues.some((i) => i.code === 'body.empty')).toBe(true);
  });

  it('validates table column count', () => {
    const p = base();
    p.sections = [{
      heading: '表格节',
      body: '',
      table: { headers: ['A', 'B'], rows: [['1', '2', '3']] },
    }];
    const r = validateDocxPayload(p);
    expect(r.issues.some((i) => i.code === 'table.col_mismatch')).toBe(true);
  });

  it('accepts payload with table', () => {
    const p = base();
    p.sections = [{
      heading: '数据',
      body: '表格如下',
      table: { headers: ['名称', '值'], rows: [['A', '1'], ['B', '2']] },
    }];
    expect(validateDocxPayload(p).ok).toBe(true);
  });

  it('rejects non-PNG chartPngBase64', () => {
    const p = base();
    p.sections = [{
      heading: '图表',
      body: '示例',
      chartPngBase64: Buffer.from('this is not a png').toString('base64'),
    }];
    const r = validateDocxPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.not_png')).toBe(true);
  });

  it('rejects truncated PNG (signature only)', () => {
    const p = base();
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    p.sections = [{ heading: '图表', body: '示例', chartPngBase64: sig.toString('base64') }];
    const r = validateDocxPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.not_png')).toBe(true);
  });

  it('rejects PNG signature + garbage IHDR', () => {
    const p = base();
    const buf = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    buf.write('XXXX', 12, 'ascii');
    p.sections = [{ heading: '图表', body: '示例', chartPngBase64: buf.toString('base64') }];
    const r = validateDocxPayload(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'chart.not_png')).toBe(true);
  });

  it('accepts valid minimal PNG', () => {
    const p = base();
    const buf = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 'ascii');
    p.sections = [{ heading: '图表', body: '示例', chartPngBase64: buf.toString('base64') }];
    expect(validateDocxPayload(p).ok).toBe(true);
  });

  it('accepts payload without chartPngBase64', () => {
    const p = base();
    expect(validateDocxPayload(p).ok).toBe(true);
  });
});
