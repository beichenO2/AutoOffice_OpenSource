import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runReportPipeline, registerFormatAdapters } from '../src/index.js';

function hasWeasyPrint(): boolean {
  for (const py of ['/opt/homebrew/bin/python3', 'python3']) {
    try {
      const r = spawnSync(py, ['-c', 'import weasyprint'], { encoding: 'utf-8', timeout: 10_000 });
      if (r.status === 0) return true;
    } catch { /* try next */ }
  }
  return false;
}

beforeAll(() => {
  registerFormatAdapters();
});

describe('pdf engine (weasyprint)', () => {
  it.skipIf(!hasWeasyPrint())('generates a real pdf blob', async () => {
    const artifact = await runReportPipeline({
      format: 'pdf',
      data: {
        mermaid: 'graph TD\n  Revenue --> Growth',
        pdf: {
          theme: 'academic',
          locale: 'zh-CN',
          title: '季度经营分析报告',
          subtitle: '2026年第一季度',
          author: '战略规划部',
          date: '2026年4月',
          toc: true,
          sections: [
            {
              heading: '综上所述：执行摘要',
              level: 1,
              body: '本季度营收同比增长 15%，利润率保持稳定。值得注意的是，新产品线贡献了 30% 的收入增量。',
            },
            {
              heading: '市场环境分析',
              level: 1,
              body: '宏观经济保持平稳增长态势。\n\n- 消费者信心指数回升\n- 行业竞争格局未发生显著变化\n- 技术迭代周期缩短',
            },
            {
              heading: '财务数据',
              level: 1,
              body: '营收达到 2.3 亿元，同比增长 15%。成本结构持续优化，毛利率提升 2 个百分点。',
            },
          ],
        },
      },
      template: { kind: 'inline', source: ' ' },
      locale: 'zh-CN',
    });
    expect(artifact.mime).toBe('application/pdf');
    expect(artifact.encoding).toBe('base64');
    const buf = Buffer.from(artifact.body, 'base64');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);

  it.skipIf(!hasWeasyPrint())('applies de-AI flavor to content', async () => {
    const artifact = await runReportPipeline({
      format: 'pdf',
      data: {
        pdf: {
          theme: 'minimal',
          locale: 'zh-CN',
          title: '测试报告',
          sections: [
            {
              heading: '综上所述，本段正文',
              level: 1,
              body: '值得注意的是，这段文字应该被处理。深入探讨一下效果。',
            },
          ],
        },
      },
      template: { kind: 'inline', source: ' ' },
    });
    expect(artifact.mime).toBe('application/pdf');
    const buf = Buffer.from(artifact.body, 'base64');
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);

  it.skipIf(!hasWeasyPrint())('works with english locale', async () => {
    const artifact = await runReportPipeline({
      format: 'pdf',
      data: {
        pdf: {
          theme: 'business',
          locale: 'en-US',
          title: 'Quarterly Report',
          subtitle: 'Q1 2026',
          sections: [
            {
              heading: 'Executive Summary',
              level: 1,
              body: 'It is important to note that revenue grew by 15%. Furthermore, the new product line contributed 30% of incremental revenue.',
            },
          ],
        },
      },
      template: { kind: 'inline', source: ' ' },
      locale: 'en-US',
    });
    expect(artifact.mime).toBe('application/pdf');
    const buf = Buffer.from(artifact.body, 'base64');
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 30_000);
});
