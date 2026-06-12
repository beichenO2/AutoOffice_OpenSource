import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runReportPipeline, registerFormatAdapters } from '../src/index.js';

function hasPythonPptx(): boolean {
  for (const py of ['/opt/homebrew/bin/python3', 'python3']) {
    try {
      const r = spawnSync(py, ['-c', 'import pptx'], { encoding: 'utf-8', timeout: 10_000 });
      if (r.status === 0) {
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

beforeAll(() => {
  registerFormatAdapters();
});

describe('pptx engine (python-pptx)', () => {
  it.skipIf(!hasPythonPptx())('generates a real pptx blob', { timeout: 30000 }, async () => {
    const artifact = await runReportPipeline({
      format: 'pptx',
      data: {
        mermaid: 'graph TD\n  A[Input] --> B[Output]',
        pptx: {
          theme: 'nord',
          locale: 'zh-CN',
          title: '季度回顾',
          subtitle: '内部材料',
          slides: [
            {
              title: '值得注意的是：本页应被改写',
              bullets: ['第一点', '第二点', '第三点', '第四点', '第五点', '第六点', '第七点应截断'],
            },
            { title: '结论', bullets: ['可见，目标达成'] },
          ],
        },
      },
      template: { kind: 'inline', source: ' ' },
      locale: 'zh-CN',
    });
    expect(artifact.mime).toContain('presentationml');
    expect(artifact.encoding).toBe('base64');
    const buf = Buffer.from(artifact.body, 'base64');
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('PK\x03\x04');
  });
});
