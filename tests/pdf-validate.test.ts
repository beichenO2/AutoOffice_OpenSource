import { describe, expect, it } from 'vitest';
import { validatePdfPayload } from '../src/pdf/validate.js';
import type { PdfReportPayload } from '../src/pdf/types.js';

function validPayload(overrides: Partial<PdfReportPayload> = {}): PdfReportPayload {
  return {
    theme: 'academic',
    locale: 'zh-CN',
    title: '测试报告',
    sections: [{ heading: '引言', body: '这是引言正文。' }],
    ...overrides,
  };
}

describe('validatePdfPayload', () => {
  it('accepts a valid payload', () => {
    const r = validatePdfPayload(validPayload());
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects invalid theme', () => {
    const r = validatePdfPayload(validPayload({ theme: 'nope' as never }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.theme.invalid')).toBe(true);
  });

  it('rejects empty title', () => {
    const r = validatePdfPayload(validPayload({ title: '' }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.title.missing')).toBe(true);
  });

  it('rejects empty sections', () => {
    const r = validatePdfPayload(validPayload({ sections: [] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'sections.empty')).toBe(true);
  });

  it('warns on missing heading', () => {
    const r = validatePdfPayload(
      validPayload({ sections: [{ heading: '', body: '有正文但没标题' }] }),
    );
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'heading.missing')).toBe(true);
  });

  it('warns on empty body', () => {
    const r = validatePdfPayload(
      validPayload({ sections: [{ heading: '空正文', body: '' }] }),
    );
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'body.empty')).toBe(true);
  });

  it('accepts all four themes', () => {
    for (const theme of ['academic', 'business', 'minimal', 'elegant'] as const) {
      const r = validatePdfPayload(validPayload({ theme }));
      expect(r.ok).toBe(true);
    }
  });

  it('accepts both locales', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const r = validatePdfPayload(validPayload({ locale }));
      expect(r.ok).toBe(true);
    }
  });

  it('rejects invalid locale', () => {
    const r = validatePdfPayload(validPayload({ locale: 'fr-FR' as never }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.locale.invalid')).toBe(true);
  });
});
