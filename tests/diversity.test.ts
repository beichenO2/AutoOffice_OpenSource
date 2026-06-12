import { describe, it, expect } from 'vitest';
import { analyzeDiversity } from '../src/text/diversity.js';

describe('diversity analysis', () => {
  it('gives high score for varied natural writing', () => {
    const natural = '项目进展顺利。我们用了两周完成需求分析，这比预期快。' +
      '最终的架构方案经过三轮讨论才确定下来——不是因为分歧，而是每轮都有新的洞察。' +
      '前端选择了 React，为什么呢？主要是团队经验丰富。' +
      '后端则用了 Go，性能是第一考量。' +
      '数据库方面有些纠结。PostgreSQL 还是 MongoDB？最终选了前者。';

    const report = analyzeDiversity(natural);
    expect(report.score).toBeGreaterThanOrEqual(50);
    expect(report.metrics.starterVariety).toBeGreaterThan(0.3);
  });

  it('gives lower score for repetitive AI writing', () => {
    const ai = '我们进行了需求分析。我们完成了架构设计。我们实现了核心功能。' +
      '我们编写了单元测试。我们进行了代码审查。我们部署了测试环境。' +
      '我们完成了用户验收。我们发布了正式版本。';

    const report = analyzeDiversity(ai);
    expect(report.metrics.starterVariety).toBeLessThan(0.5);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it('handles single sentence', () => {
    const report = analyzeDiversity('Just one sentence here.');
    expect(report.score).toBe(100);
  });

  it('handles empty text', () => {
    const report = analyzeDiversity('');
    expect(report.score).toBe(100);
  });

  it('detects non-declarative sentences', () => {
    const mixed = 'This is a statement. Is this a question? Yes! Another statement. What about this?';
    const report = analyzeDiversity(mixed);
    expect(report.metrics.nonDeclarativeRatio).toBeGreaterThan(0);
  });

  it('measures length variation accurately', () => {
    const uniform = 'Short. Short. Short. Short. Short.';
    const varied = 'Short. This is a much longer sentence with many words in it. Tiny. Another very long and detailed sentence here.';

    const uniformReport = analyzeDiversity(uniform);
    const variedReport = analyzeDiversity(varied);
    expect(variedReport.metrics.lengthVariation).toBeGreaterThan(uniformReport.metrics.lengthVariation);
  });
});
