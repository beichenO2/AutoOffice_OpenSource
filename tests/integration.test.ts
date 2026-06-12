import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarize } from '../src/summarize/pipeline.js';
import { renderMermaid } from '../src/chart/mermaid-render.js';
import { stripAiFlavor, stripAiFlavorDeep } from '../src/text/deai.js';
import { runReportPipeline, registerFormatAdapter } from '../src/format/pipeline.js';
import { registerFormatAdapters } from '../src/format/format-adapters.js';
import type { RawInput } from '../src/summarize/types.js';

describe('integration — end-to-end workflows', () => {
  it('summarize → mermaid render → html report', async () => {
    const inputs: RawInput[] = [
      {
        kind: 'text',
        value: '# 项目架构\n\n## 前端\n\n**React** + **TypeScript**\n\n- 组件化设计\n- 状态管理\n\n## 后端\n\n**Node.js** + **Express**\n\n- RESTful API\n- 数据库层',
      },
    ];

    const summary = await summarize(inputs);
    expect(summary.evaluation.route).toBe('llmwiki');
    expect(summary.mermaid.code).toContain('graph TD');

    const rendered = await renderMermaid(summary.mermaid.code, { target: 'html-embed' });
    expect(rendered.data).toContain('mermaid');

    registerFormatAdapters();
    const report = await runReportPipeline({
      format: 'html',
      data: {
        sections: [
          { title: '项目概览', content: summary.combinedMarkdown.slice(0, 200) },
          { title: '架构图', content: rendered.data },
        ],
      },
      template: {
        kind: 'inline',
        source: '<html><body>{{#each sections}}<section><h2>{{title}}</h2><div>{{{content}}}</div></section>{{/each}}</body></html>',
      },
    });

    expect(report.body).toContain('项目概览');
    expect(report.body).toContain('mermaid');
  });

  it('deai strips AI flavor from report content', () => {
    const aiText = '综上所述，本文旨在深入探讨 AutoOffice 的核心功能。值得注意的是，充分利用现有基础设施能显著提升开发效率。';
    const clean = stripAiFlavor(aiText);
    expect(clean).not.toContain('综上所述');
    expect(clean).not.toContain('本文旨在');
    expect(clean).not.toContain('深入探讨');
    expect(clean).not.toContain('值得注意的是');
    expect(clean).toContain('总体来看');
    expect(clean).toContain('讨论');
  });

  it('deai deep processes nested objects', () => {
    const data = {
      title: '综上所述的标题',
      sections: [
        { heading: '值得注意的是这个章节', body: '不可或缺的内容' },
      ],
    };
    const clean = stripAiFlavorDeep(data) as Record<string, unknown>;
    expect((clean['title'] as string)).not.toContain('综上所述');
    const sections = clean['sections'] as Array<Record<string, unknown>>;
    expect((sections[0]['heading'] as string)).not.toContain('值得注意的是');
    expect((sections[0]['body'] as string)).not.toContain('不可或缺');
  });

  it('summarize handles file inputs with csv', async () => {
    const dir = join(tmpdir(), 'autooffice-integ-' + Date.now());
    await mkdir(dir, { recursive: true });
    const csvPath = join(dir, 'data.csv');
    await writeFile(csvPath, 'Product,Revenue,Growth\nWidget A,1000,15%\nWidget B,2500,22%\nWidget C,800,8%');

    try {
      const result = await summarize([{ kind: 'file', value: csvPath }]);
      expect(result.parsed[0].markdown).toContain('| Product |');
      expect(result.evaluation.route).toBe('llmwiki');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarize scales route with content volume', async () => {
    const small = await summarize([{ kind: 'text', value: 'Small content' }]);
    expect(small.evaluation.route).toBe('llmwiki');

    const medium = await summarize([{
      kind: 'text',
      value: Array.from({ length: 50 }, (_, i) =>
        `## Chapter ${i}\n\nThis chapter covers topic ${i} with enough text to push the word count higher. `.repeat(5),
      ).join('\n\n'),
    }]);
    expect(medium.evaluation.route).toBe('llmwiki');
  });
});

describe('integration — error handling', () => {
  it('summarize rejects unknown input kind gracefully', async () => {
    await expect(
      summarize([{ kind: 'invalid' as 'text', value: 'test' }]),
    ).rejects.toThrow('Unsupported input kind');
  });

  it('file parser handles non-existent file', async () => {
    await expect(
      summarize([{ kind: 'file', value: '/nonexistent/path/file.md' }]),
    ).rejects.toThrow();
  });
});
