import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runReportPipeline, registerFormatAdapters } from '../src/index.js';

function hasPythonDocx(): boolean {
  for (const py of ['/opt/homebrew/bin/python3', 'python3']) {
    try {
      const r = spawnSync(py, ['-c', 'import docx'], { encoding: 'utf-8', timeout: 10_000 });
      if (r.status === 0) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

beforeAll(() => {
  registerFormatAdapters();
});

describe('docx engine (python-docx)', () => {
  it.skipIf(!hasPythonDocx())('generates a real docx blob with mermaid payload present', { timeout: 30000 }, async () => {
    const artifact = await runReportPipeline({
      format: 'docx',
      data: {
        mermaid: 'graph TD\n  A[Draft] --> B[Review]',
        docx: {
          theme: 'business',
          locale: 'zh-CN',
          title: '周报',
          sections: [{ heading: '摘要', body: '这是正文。' }],
        },
      },
      template: { kind: 'inline', source: ' ' },
      locale: 'zh-CN',
    });
    expect(artifact.mime).toContain('wordprocessingml');
    expect(artifact.encoding).toBe('base64');
    const buf = Buffer.from(artifact.body, 'base64');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('PK\x03\x04');
  });
});
