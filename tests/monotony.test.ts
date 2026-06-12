import { describe, it, expect } from 'vitest';
import { analyzeMonotony } from '../src/text/monotony.js';

describe('monotony detection', () => {
  it('gives high score for varied natural text', () => {
    const natural = `
项目启动阶段已经完成。团队花了两周时间做需求分析。

这不是一个简单的任务。
很多细节需要反复确认，有些甚至推倒重来了。但最终结果令人满意。

我们采用了模块化的架构设计，每个模块独立开发和测试。前端使用 React，后端选择了 Node.js。数据库方面，经过讨论决定用 PostgreSQL 而不是 MongoDB，主要考虑到数据一致性的要求。

接下来的重点是性能优化。
    `.trim();

    const report = analyzeMonotony(natural);
    expect(report.score).toBeGreaterThanOrEqual(70);
  });

  it('detects monotonous AI-style text', () => {
    const aiText = `
首先，我们需要了解项目的背景和需求。其次，我们要分析当前的技术栈。然后，我们需要设计系统架构。接下来，我们要实现核心功能模块。此外，我们还需要编写单元测试。同时，我们要进行代码审查工作。另外，我们需要部署到测试环境。最后，我们要进行用户验收测试。因此，整个项目将按计划推进。
    `.trim();

    const report = analyzeMonotony(aiText);
    expect(report.score).toBeLessThan(80);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('detects sentence length uniformity', () => {
    const uniform = Array.from({ length: 10 }, () =>
      '这是一个长度完全相同的测试句子。',
    ).join('');

    const report = analyzeMonotony(uniform);
    const slIssue = report.issues.find((i) => i.type === 'sentence-length');
    expect(slIssue).toBeDefined();
  });

  it('detects starter repetition', () => {
    const repetitive = `
我们需要做A。我们需要做B。我们需要做C。我们需要做D。我们需要做E。
    `.trim();

    const report = analyzeMonotony(repetitive);
    const srIssue = report.issues.find((i) => i.type === 'starter-repetition');
    expect(srIssue).toBeDefined();
  });

  it('handles short text gracefully', () => {
    const short = '短文本。';
    const report = analyzeMonotony(short);
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  it('handles empty text', () => {
    const report = analyzeMonotony('');
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  it('provides suggestions for detected issues', () => {
    const aiText = `
首先，我们分析数据。其次，我们处理数据。然后，我们验证数据。接下来，我们存储数据。此外，我们备份数据。同时，我们监控数据。另外，我们清理数据。最后，我们归档数据。
    `.trim();

    const report = analyzeMonotony(aiText);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });
});
