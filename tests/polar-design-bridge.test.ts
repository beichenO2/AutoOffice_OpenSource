import { describe, it, expect } from 'vitest';
import { injectPolarDesignCss, mapThemeToDesignSystem, resolveDesignSystemFromPayload } from '../src/integrations/polar-design-bridge.js';

describe('polar-design-bridge', () => {
  it('maps AutoOffice theme to PolarDesign system', () => {
    expect(mapThemeToDesignSystem('tech')).toBe('polar-tech');
    expect(mapThemeToDesignSystem('minimal')).toBe('polar-soft');
  });

  it('injects CSS into HTML head', () => {
    const html = '<html><head></head><body><p>Hi</p></body></html>';
    const out = injectPolarDesignCss(html, 'polar-tech');
    expect(out).toContain('data-polar-design="polar-tech"');
    expect(out).toContain('--pd-bg');
  });

  it('resolves design_system from payload', () => {
    expect(resolveDesignSystemFromPayload({ design_system: 'polar-dense' })).toBe('polar-dense');
    expect(resolveDesignSystemFromPayload({ theme: 'business' })).toBe('polar-dense');
  });
});
