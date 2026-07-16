import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('coordination capability metadata', () => {
  it('tracks the published autooffice.report_gen capability in-repo', async () => {
    const raw = await readFile(
      resolve('coordination/capabilities/autooffice.report_gen.json'),
      'utf-8',
    );
    const packageRaw = await readFile(resolve('package.json'), 'utf-8');
    const capability = JSON.parse(raw) as {
      capability: string;
      version: string;
      status: string;
      features: string[];
      entry_points: { cli?: string; http_server?: string; project_dir?: string };
    };
    const pkg = JSON.parse(packageRaw) as { version: string };

    expect(capability.capability).toBe('autooffice.report_gen');
    expect(capability.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe(capability.version);
    expect(capability.status).toBe('ready');
    expect(capability.features).toEqual(
      expect.arrayContaining([
        'generate: 结构化数据→专业报告(pptx/pdf/docx/latex/html)',
        'summarize: 多格式输入→智能分流→Mermaid图→handoff',
        'wiki: LLMWiki项目脚手架自动生成',
      ]),
    );
    expect(capability.entry_points.cli).toBe('node dist/cli.js');
    expect(capability.entry_points.http_server).toBe('PolarProcess service autooffice');
    expect(capability.entry_points.project_dir).toContain('AutoOffice');
  });
});
