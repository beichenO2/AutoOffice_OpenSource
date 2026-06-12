import { describe, expect, it } from 'vitest';
import { validatePptxPayload } from '../src/ppt/validate.js';
import type { PptxDeckPayload } from '../src/ppt/types.js';

function baseDeck(over: Partial<PptxDeckPayload> = {}): PptxDeckPayload {
  return {
    theme: 'minimal',
    locale: 'zh-CN',
    title: '测试',
    slides: [{ title: '一页', bullets: ['a', 'b'] }],
    ...over,
  };
}

describe('validatePptxPayload (REQ-A07)', () => {
  it('rejects invalid theme', () => {
    const r = validatePptxPayload(baseDeck({ theme: 'fancy' as PptxDeckPayload['theme'] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.theme.invalid')).toBe(true);
  });

  it('rejects invalid locale', () => {
    const r = validatePptxPayload(baseDeck({ locale: 'ja-JP' as PptxDeckPayload['locale'] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.locale.invalid')).toBe(true);
  });

  it('rejects empty deck title', () => {
    const r = validatePptxPayload(baseDeck({ title: '   ' }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'meta.title.missing')).toBe(true);
  });

  it('rejects more than 6 bullets', () => {
    const r = validatePptxPayload(
      baseDeck({
        slides: [{ title: '多要点', bullets: ['1', '2', '3', '4', '5', '6', '7'] }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'bullets.too_many')).toBe(true);
  });

  it('warns on missing slide title', () => {
    const r = validatePptxPayload(baseDeck({ slides: [{ title: '', bullets: ['x'] }] }));
    expect(r.issues.some((i) => i.code === 'title.missing')).toBe(true);
  });

  it('warns on very long bullet', () => {
    const long = 'x'.repeat(201);
    const r = validatePptxPayload(baseDeck({ slides: [{ title: 't', bullets: [long] }] }));
    expect(r.issues.some((i) => i.code === 'bullet.too_long')).toBe(true);
  });

  it('accepts valid minimal deck', () => {
    const r = validatePptxPayload(
      baseDeck({
        theme: 'business',
        locale: 'en-US',
        title: 'Q1',
        slides: [
          { title: 'Scope', bullets: ['A', 'B'] },
          { title: 'Next', bullets: ['C'] },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('accepts extended themes (REQ-008)', () => {
    for (const theme of ['nord', 'tech', 'warm', 'slate'] as const) {
      const r = validatePptxPayload(baseDeck({ theme }));
      expect(r.ok).toBe(true);
    }
  });
});
