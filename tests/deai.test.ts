import { describe, expect, it } from 'vitest';
import { stripAiFlavor, stripAiFlavorDeep } from '../src/text/deai.js';

describe('stripAiFlavor', () => {
  it('replaces common Chinese AI-ish phrases', () => {
    expect(stripAiFlavor('综上所述，结论成立')).toContain('总体来看');
    expect(stripAiFlavor('值得注意的是，此处有风险')).toContain('另外');
  });

  it('rewrites some English stock phrases', () => {
    expect(stripAiFlavor('Leverage the API to delve into data')).toMatch(/use/i);
  });

  it('stripAiFlavorDeep maps strings in nested objects', () => {
    const o = stripAiFlavorDeep({
      a: '综上所述',
      b: ['值得注意的是'],
    }) as { a: string; b: string[] };
    expect(o.a).toContain('总体');
    expect(o.b[0]).toContain('另外');
  });
});
