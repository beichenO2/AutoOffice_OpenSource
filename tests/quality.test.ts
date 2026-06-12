import { describe, it, expect } from 'vitest';
import { analyzeQuality } from '../src/text/quality.js';

describe('quality analysis', () => {
  it('gives high grade for natural diverse text', () => {
    const natural = '项目进展顺利，团队士气高涨。' +
      '这次的架构方案比上次合理得多——减少了三层不必要的抽象。' +
      '前端为什么选 React？团队经验最丰富。' +
      '后端则换成了 Go，追求极致性能。' +
      '数据库方面纠结了两天，PostgreSQL 和 MongoDB 各有优劣。' +
      '最终？投票决定，PostgreSQL 胜出。';

    const report = analyzeQuality(natural);
    expect(report.grade).toMatch(/[AB]/);
    expect(report.overallScore).toBeGreaterThanOrEqual(60);
    expect(report.aiFlavorDetected).toBe(0);
  });

  it('detects and removes AI flavor', () => {
    const ai = '综上所述，本文旨在深入探讨项目管理的最佳实践。值得注意的是，充分利用现有工具能显著提升效率。';
    const report = analyzeQuality(ai);
    expect(report.aiFlavorDetected).toBeGreaterThan(0);
    expect(report.processedText).not.toContain('综上所述');
    expect(report.processedText).not.toContain('本文旨在');
    expect(report.recommendations.some((r) => r.includes('AI'))).toBe(true);
  });

  it('handles empty text', () => {
    const report = analyzeQuality('');
    expect(report.grade).toBe('A');
    expect(report.wordCount).toBe(0);
  });

  it('provides recommendations', () => {
    const repetitive = '我们做了A。我们做了B。我们做了C。我们做了D。我们做了E。我们做了F。我们做了G。我们做了H。';
    const report = analyzeQuality(repetitive);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('grades correctly across the spectrum', () => {
    const excellent = analyzeQuality('Very varied text. Short. Then a longer sentence with more detail? Yes! And more.');
    const poor = analyzeQuality('综上所述A。综上所述B。综上所述C。综上所述D。综上所述E。综上所述F。');
    expect(excellent.overallScore).toBeGreaterThanOrEqual(poor.overallScore);
  });
});
