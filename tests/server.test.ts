import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { SUPPORTED_GENERATE_FORMATS } from '../src/index.js';

const PORT = 39880;
const CAPABILITY_PATH = join(import.meta.dirname, '..', 'coordination', 'capabilities', 'autooffice.report_gen.json');
let serverProcess: ReturnType<typeof import('node:child_process').fork> | null = null;
let apiWikiRoot = '';

async function readPublishedCapabilityVersion(): Promise<string> {
  const raw = await readFile(CAPABILITY_PATH, 'utf-8');
  const capability = JSON.parse(raw) as { version: string };
  return capability.version;
}

function httpReq(method: string, path: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('server — HTTP API', () => {
  beforeAll(async () => {
    apiWikiRoot = await mkdtemp(join(tmpdir(), 'autooffice-server-wiki-'));
    const { fork } = await import('node:child_process');
    serverProcess = fork(join(import.meta.dirname, '..', 'dist', 'cli.js'), ['serve', '-p', String(PORT)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        AUTOOFFICE_API_WIKI_ROOT: apiWikiRoot,
        AUTOOFFICE_DIRECT_PORT: '1',
      },
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        httpReq('GET', '/health')
          .then(() => resolve())
          .catch(() => setTimeout(check, 200));
      };
      setTimeout(check, 500);
    });
  }, 10000);

  afterAll(async () => {
    serverProcess?.kill();
    if (apiWikiRoot) {
      await rm(apiWikiRoot, { recursive: true, force: true });
    }
  });

  it('health endpoint', async () => {
    const res = await httpReq('GET', '/health');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('autooffice');
    expect(data.version).toBe(await readPublishedCapabilityVersion());
  });

  it('formats endpoint', async () => {
    const res = await httpReq('GET', '/api/formats');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.formats).toEqual(SUPPORTED_GENERATE_FORMATS);
  });

  it('tools endpoint returns external tool summary', async () => {
    const res = await httpReq('GET', '/api/tools');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data.tools)).toBe(true);
    expect(Array.isArray(data.formatSupport)).toBe(true);
    expect(Array.isArray(data.conversionPaths)).toBe(true);
    expect(data.formatSupport.some((item: { format: string }) => item.format === 'docx')).toBe(true);
  });

  it('generate html report', async () => {
    const res = await httpReq('POST', '/api/generate', {
      format: 'html',
      data: { sections: [{ title: 'Test', content: 'Content' }] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Test');
    expect(res.body).toContain('Content');
  });

  it('generate auto-converts generic sections for docx requests', async () => {
    const res = await httpReq('POST', '/api/generate', {
      format: 'docx',
      data: {
        title: 'API Docx',
        sections: [{ title: 'Overview', content: 'Server-side conversion path.' }],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('generate rejects missing format', async () => {
    const res = await httpReq('POST', '/api/generate', { data: {} });
    expect(res.status).toBe(400);
  });

  it('summarize endpoint', async () => {
    const res = await httpReq('POST', '/api/summarize', {
      inputs: [{ kind: 'text', value: '# Heading\n\n## Sub\n\nParagraph content.' }],
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.route).toBe('llmwiki');
    expect(data.mermaid).toContain('graph TD');
    expect(data.handoff.target).toBe('llmwiki');
    expect(data.handoff.capability).toBe('llmwiki.wiki_generator');
  });

  it('summarize endpoint treats zip file inputs as archives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autooffice-server-zip-'));
    const zipPath = join(dir, 'bundle.zip');
    const zip = new JSZip();
    zip.file('summary.md', '# Server Zip Title\n\nBundled API content.');
    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const res = await httpReq('POST', '/api/summarize', {
        inputs: [{ kind: 'file', value: zipPath }],
      });
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.combinedMarkdown).toContain('Server Zip Title');
      expect(data.mermaid).toContain('Server Zip Title');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarize rejects empty inputs', async () => {
    const res = await httpReq('POST', '/api/summarize', { inputs: [] });
    expect(res.status).toBe(400);
  });

  it('enrich endpoint falls back to defaults for invalid numeric options', async () => {
    const markdown = [
      '# Topic A',
      '',
      '## Topic B',
      '',
      '## Topic C',
      '',
      '## Topic D',
    ].join('\n');
    const res = await httpReq('POST', '/api/enrich', {
      markdown,
      maxQueries: 'oops',
      topK: { bad: true },
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ragContexts.map((item: { query: string }) => item.query)).toEqual([
      'Topic A',
      'Topic B',
      'Topic C',
    ]);
  }, 20000);

  it('enrich endpoint falls back to defaults for negative numeric options', async () => {
    const markdown = [
      '# Topic A',
      '',
      '## Topic B',
      '',
      '## Topic C',
      '',
      '## Topic D',
    ].join('\n');
    const res = await httpReq('POST', '/api/enrich', {
      markdown,
      maxQueries: -1,
      topK: -2,
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ragContexts.map((item: { query: string }) => item.query)).toEqual([
      'Topic A',
      'Topic B',
      'Topic C',
    ]);
  }, 20000);

  it('enrich endpoint preserves crafted headings without Python syntax failures', async () => {
    const markdown = ['# bad\\', '', 'Body content.'].join('\n');
    const res = await httpReq('POST', '/api/enrich', {
      markdown,
      maxQueries: 1,
      topK: 1,
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ragContexts).toHaveLength(1);
    expect(data.ragContexts[0].query).toBe('bad\\');
    expect((data.ragContexts[0].error ?? '') as string).not.toMatch(/SyntaxError|EOL while scanning string literal/);
  });

  it('wiki endpoint writes inside the controlled API root', async () => {
    const res = await httpReq('POST', '/api/wiki', {
      inputs: [{ kind: 'text', value: '# Wiki API Test\n\n## Section\n\nBody content.' }],
      outputDir: 'team-a/project-1',
    });
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.success).toBe(true);
    expect(data.projectDir).toBe(join(apiWikiRoot, 'team-a', 'project-1'));
    expect(Array.isArray(data.filesCreated)).toBe(true);
    expect(data.filesCreated.every((file: string) => file.startsWith(data.projectDir))).toBe(true);
  });

  it('wiki endpoint rejects path traversal', async () => {
    const res = await httpReq('POST', '/api/wiki', {
      inputs: [{ kind: 'text', value: '# Wiki API Test\n\nUnsafe path.' }],
      outputDir: '../escape',
    });
    expect(res.status).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('API wiki root');
  });

  it('wiki endpoint rejects absolute paths', async () => {
    const res = await httpReq('POST', '/api/wiki', {
      inputs: [{ kind: 'text', value: '# Wiki API Test\n\nAbsolute path.' }],
      outputDir: join(tmpdir(), 'autooffice-escape'),
    });
    expect(res.status).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('relative path');
  });
});
