import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { queryRAG, enrichWithRAG } from '../src/integrations/knowleverage.js';
import { createWikiScaffold } from '../src/integrations/llmwiki.js';
import { summarize } from '../src/summarize/pipeline.js';

describe('integrations — knowleverage RAG', () => {
  it('queryRAG handles unavailable service gracefully', async () => {
    const result = await queryRAG('test query', 3);
    expect(result.query).toBe('test query');
    expect(typeof result.success).toBe('boolean');
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  }, 20000);

  it('queryRAG escapes crafted trailing backslashes without Python syntax errors', async () => {
    const result = await queryRAG('bad\\', 3);
    expect(result.query).toBe('bad\\');
    expect(typeof result.success).toBe('boolean');
    expect(result.error ?? '').not.toMatch(/SyntaxError|EOL while scanning string literal/);
  }, 20000);

  it('enrichWithRAG returns original content when RAG unavailable', async () => {
    const markdown = '# Test\n\n## Section\n\nSome content here.';
    const result = await enrichWithRAG(markdown, { maxQueries: 1 });
    expect(result.original).toBe(markdown);
    expect(result.ragContexts).toHaveLength(1);
    if (result.enrichmentCount === 0) {
      expect(result.enriched).toBe(markdown);
    }
  }, 20000);
});

describe('integrations — llmwiki scaffold', () => {
  it('creates complete wiki scaffold from summarize result', async () => {
    const dir = join(tmpdir(), 'autooffice-wiki-test-' + Date.now());

    try {
      const result = await summarize([{
        kind: 'text',
        value: '# 测试项目\n\n## 前端\n\n**React** 框架\n\n- 组件化\n- 状态管理\n\n## 后端\n\n**Node.js** 服务',
      }]);

      const scaffold = await createWikiScaffold(result, dir);
      expect(scaffold.success).toBe(true);
      expect(scaffold.filesCreated.length).toBeGreaterThanOrEqual(3);
      expect(scaffold.buildCommand).toBe('node scripts/build.js');

      const overviewExists = scaffold.filesCreated.some((f) => f.includes('overview.md'));
      expect(overviewExists).toBe(true);

      const graphExists = scaffold.filesCreated.some((f) => f.includes('graph.json'));
      expect(graphExists).toBe(true);

      const graphContent = await readFile(
        scaffold.filesCreated.find((f) => f.includes('graph.json'))!,
        'utf-8',
      );
      const graph = JSON.parse(graphContent);
      expect(graph.tree).toBeDefined();
      expect(graph.tree.label).toBe('测试项目');
      expect(graph.glossary).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('escapes quoted titles in wiki overview front matter', async () => {
    const dir = join(tmpdir(), 'autooffice-wiki-quoted-title-' + Date.now());

    try {
      const result = await summarize([{
        kind: 'text',
        value: '# He said "Hi"\n\nBody content.',
      }]);

      const scaffold = await createWikiScaffold(result, dir);
      expect(scaffold.success).toBe(true);

      const overviewPath = scaffold.filesCreated.find((f) => f.includes('overview.md'));
      expect(overviewPath).toBeDefined();

      const overview = await readFile(overviewPath!, 'utf-8');
      expect(overview).toContain('title: "He said \\"Hi\\""');
      expect(overview).toContain('# He said "Hi"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates source files for each parsed input', async () => {
    const dir = join(tmpdir(), 'autooffice-wiki-multi-' + Date.now());

    try {
      const result = await summarize([
        { kind: 'text', value: '# Doc 1\n\nContent one.' },
        { kind: 'text', value: '# Doc 2\n\nContent two.' },
      ]);

      const scaffold = await createWikiScaffold(result, dir);
      expect(scaffold.success).toBe(true);

      const sourceFiles = scaffold.filesCreated.filter((f) => f.includes('source-'));
      expect(sourceFiles.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('handles empty summarize result', async () => {
    const dir = join(tmpdir(), 'autooffice-wiki-empty-' + Date.now());

    try {
      const result = await summarize([{ kind: 'text', value: 'short' }]);
      const scaffold = await createWikiScaffold(result, dir);
      expect(scaffold.success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
