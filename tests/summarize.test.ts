import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import JSZip from 'jszip';
import {
  MAX_SUMMARIZE_URL_RESPONSE_BYTES,
  countWords,
  countParagraphs,
  detectLang,
  parseInput,
  parseInputs,
} from '../src/summarize/parser.js';
import { evaluate, SMALL_CONTENT_THRESHOLD, LLMWIKI_THRESHOLD } from '../src/summarize/evaluator.js';
import { generateMermaid } from '../src/summarize/mermaid-gen.js';
import { summarize } from '../src/summarize/pipeline.js';
import type { RawInput, ParsedContent } from '../src/summarize/types.js';

const lookupMock = vi.hoisted(() =>
  vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]),
);
const httpRequestMock = vi.hoisted(() => vi.fn());
const httpsRequestMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
}));
vi.mock('node:http', () => ({
  request: httpRequestMock,
}));
vi.mock('node:https', () => ({
  request: httpsRequestMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  httpRequestMock.mockReset();
  httpsRequestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

type MockRequestOutcome = {
  status?: number;
  statusText?: string;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
  bodyChunks?: Array<string | Buffer>;
  error?: Error;
  timeout?: boolean;
  assertOptions?: (url: URL, options: Record<string, unknown>) => void | Promise<void>;
};

function queueRequestOutcomes(
  requestMock: ReturnType<typeof vi.fn>,
  outcomes: MockRequestOutcome[],
): void {
  const pending = [...outcomes];

  requestMock.mockImplementation((url: string | URL, options: Record<string, unknown>, callback?: (response: PassThrough) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
      setTimeout: (_timeout: number) => typeof request;
    };

    request.end = () => {
      const outcome = pending.shift();
      if (!outcome) {
        queueMicrotask(() => request.emit('error', new Error('No queued request outcome')));
        return;
      }

      void Promise.resolve()
        .then(() => outcome.assertOptions?.(typeof url === 'string' ? new URL(url) : url, options))
        .then(() => {
          if (outcome.timeout) {
            request.emit('timeout');
            return;
          }
          if (outcome.error) {
            request.emit('error', outcome.error);
            return;
          }

          const response = new PassThrough() as PassThrough & {
            statusCode?: number;
            statusMessage?: string;
            headers: Record<string, string | string[]>;
          };
          response.statusCode = outcome.status ?? 200;
          response.statusMessage = outcome.statusText ?? '';
          response.headers = outcome.headers ?? {};

          callback?.(response);
          const chunks = outcome.bodyChunks ?? (outcome.body === undefined ? [] : [outcome.body]);
          for (const chunk of chunks) {
            if (response.destroyed) break;
            response.write(chunk);
          }
          if (!response.destroyed) {
            response.end();
          }
        })
        .catch((error: unknown) => {
          request.emit('error', error);
        });
    };

    request.destroy = (error?: Error) => {
      if (error) {
        queueMicrotask(() => request.emit('error', error));
      }
    };
    request.setTimeout = () => request;

    return request;
  });
}

async function resolvePinnedLookup(
  lookupFn: unknown,
  hostname: string,
  family = 4,
): Promise<{ address: string; family: number }> {
  expect(typeof lookupFn).toBe('function');

  return new Promise((resolve, reject) => {
    (
      lookupFn as (
        host: string,
        options: { family: number },
        callback: (
          error: NodeJS.ErrnoException | null,
          address: string | { address: string; family: number }[],
          resolvedFamily?: number,
        ) => void,
      ) => void
    )(hostname, { family }, (error, address, resolvedFamily) => {
      if (error) {
        reject(error);
        return;
      }
      if (Array.isArray(address)) {
        reject(new Error('Expected a single pinned address'));
        return;
      }
      resolve({ address, family: resolvedFamily ?? family });
    });
  });
}

describe('parser utilities', () => {
  it('countWords handles CJK and Latin mixed text', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('hello 你好 world 世界')).toBe(6);
  });

  it('countParagraphs splits on double newlines', () => {
    expect(countParagraphs('one\n\ntwo\n\nthree')).toBe(3);
    expect(countParagraphs('single')).toBe(1);
    expect(countParagraphs('')).toBe(0);
  });

  it('detectLang identifies language', () => {
    expect(detectLang('hello world foo bar')).toBe('en');
    expect(detectLang('这是一个很长的中文句子用来测试语言检测')).toBe('zh');
    expect(detectLang('你好世界混合测试内容吧 hello world')).toBe('mixed');
  });
});

describe('parser — parseInput', () => {
  it('parses text input', async () => {
    const input: RawInput = { kind: 'text', value: '# Hello\n\nWorld paragraph.' };
    const result = await parseInput(input);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.paragraphCount).toBe(2);
    expect(result.lang).toBe('en');
    expect(result.markdown).toContain('Hello');
  });

  it('parses file input (markdown)', async () => {
    const dir = join(tmpdir(), 'autooffice-test-' + Date.now());
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'test.md');
    await writeFile(path, '这是测试标题内容\n\n这是内容段落用来做语言检测的。\n\n第二段也是中文内容。');
    try {
      const result = await parseInput({ kind: 'file', value: path });
      expect(result.paragraphCount).toBe(3);
      expect(result.lang).toBe('zh');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses file input (html)', async () => {
    const dir = join(tmpdir(), 'autooffice-test-html-' + Date.now());
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'test.html');
    await writeFile(path, '<html><body><h1>Title</h1><p>Content</p></body></html>');
    try {
      const result = await parseInput({ kind: 'file', value: path });
      expect(result.markdown).toContain('Title');
      expect(result.markdown).toContain('Content');
      expect(result.markdown).not.toContain('<');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses file input (csv)', async () => {
    const dir = join(tmpdir(), 'autooffice-test-csv-' + Date.now());
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'data.csv');
    await writeFile(path, 'Name,Age\nAlice,30\nBob,25');
    try {
      const result = await parseInput({ kind: 'file', value: path });
      expect(result.markdown).toContain('| Name | Age |');
      expect(result.markdown).toContain('Alice');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses quoted csv fields with commas, escaped quotes, and embedded newlines', async () => {
    const dir = join(tmpdir(), 'autooffice-test-csv-quoted-' + Date.now());
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'quoted.csv');
    await writeFile(
      path,
      [
        'Name,Notes,Quote',
        '"Alice, A.","Line 1',
        'Line 2","She said ""hello"""',
        'Bob,"Single line","Plain"',
      ].join('\n'),
    );
    try {
      const result = await parseInput({ kind: 'file', value: path });
      expect(result.markdown).toContain('| Name | Notes | Quote |');
      expect(result.markdown).toContain('| Alice, A. | Line 1<br>Line 2 | She said "hello" |');
      expect(result.markdown).toContain('| Bob | Single line | Plain |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses url input while pinning the validated DNS answer', async () => {
    queueRequestOutcomes(httpsRequestMock, [{
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html><head><title>Example Title</title></head><body><h1>Overview</h1><p>Fetched content.</p></body></html>',
      assertOptions: async (url, options) => {
        expect(url.toString()).toBe('https://example.com/');
        expect(options.timeout).toBe(10_000);
        expect(options.servername).toBe('example.com');

        const headers = options.headers as Record<string, string>;
        expect(headers.Accept).toContain('text/html');
        expect(headers['Accept-Encoding']).toBe('identity');

        lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
        const pinned = await resolvePinnedLookup(options.lookup, 'example.com');
        expect(pinned).toEqual({ address: '93.184.216.34', family: 4 });
      },
    }]);

    const result = await parseInput({ kind: 'url', value: 'https://example.com' });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(result.markdown).toContain('[Source URL](https://example.com)');
    expect(result.markdown).toContain('Example Title');
    expect(result.markdown).toContain('Fetched content.');
    expect(result.source.kind).toBe('url');
  });

  it('times out hung URL fetches', async () => {
    queueRequestOutcomes(httpsRequestMock, [{
      timeout: true,
      assertOptions: (url, options) => {
        expect(url.toString()).toBe('https://example.com/slow');
        expect(options.timeout).toBe(10_000);
      },
    }]);

    await expect(parseInput({ kind: 'url', value: 'https://example.com/slow' }))
      .rejects.toThrow('Timed out fetching summarize URL after 10000ms');
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects URL responses with oversized content-length headers', async () => {
    queueRequestOutcomes(httpsRequestMock, [{
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(MAX_SUMMARIZE_URL_RESPONSE_BYTES + 1),
      },
      body: 'ignored',
    }]);

    await expect(parseInput({ kind: 'url', value: 'https://example.com/large.txt' }))
      .rejects.toThrow(`Summarize URL response exceeds ${MAX_SUMMARIZE_URL_RESPONSE_BYTES} bytes`);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects URL responses that exceed the byte limit mid-stream', async () => {
    const chunkSize = Math.floor(MAX_SUMMARIZE_URL_RESPONSE_BYTES / 2) + 1;
    queueRequestOutcomes(httpsRequestMock, [{
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      bodyChunks: [
        Buffer.alloc(chunkSize, 'a'),
        Buffer.alloc(chunkSize, 'b'),
      ],
    }]);

    await expect(parseInput({ kind: 'url', value: 'https://example.com/stream.txt' }))
      .rejects.toThrow(`Summarize URL response exceeds ${MAX_SUMMARIZE_URL_RESPONSE_BYTES} bytes`);
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported remote binary formats', async () => {
    queueRequestOutcomes(httpsRequestMock, [{
      status: 200,
      headers: { 'content-type': 'application/zip' },
      body: 'PK\x03\x04',
    }]);

    await expect(parseInput({ kind: 'url', value: 'https://example.com/archive.zip' }))
      .rejects.toThrow('Unsupported remote format');
  });

  it('rejects localhost URLs before issuing fetch', async () => {
    await expect(parseInput({ kind: 'url', value: 'http://localhost:3900/health' }))
      .rejects.toThrow('Refusing to fetch private-network URL');
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects URLs that resolve to private-network addresses', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);

    await expect(parseInput({ kind: 'url', value: 'https://intranet.example.com' }))
      .rejects.toThrow('Refusing to fetch private-network URL');
    expect(httpRequestMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects redirects that target private-network URLs', async () => {
    queueRequestOutcomes(httpsRequestMock, [{
      status: 302,
      headers: { location: 'http://127.0.0.1:3900/health' },
    }]);

    await expect(parseInput({ kind: 'url', value: 'https://example.com/start' }))
      .rejects.toThrow('Refusing to fetch private-network URL');
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it('revalidates public redirects before fetching the next hop', async () => {
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === 'example.org') {
        return [{ address: '93.184.216.35', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });

    const pinnedLookups: Array<{ url: string; address: string }> = [];
    queueRequestOutcomes(httpsRequestMock, [
      {
        status: 302,
        headers: { location: 'https://example.org/final.html' },
        assertOptions: async (url, options) => {
          const pinned = await resolvePinnedLookup(options.lookup, 'example.com');
          pinnedLookups.push({ url: url.toString(), address: pinned.address });
        },
      },
      {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><body><h1>Redirected</h1><p>Redirected content.</p></body></html>',
        assertOptions: async (url, options) => {
          const pinned = await resolvePinnedLookup(options.lookup, 'example.org');
          pinnedLookups.push({ url: url.toString(), address: pinned.address });
        },
      },
    ]);

    const result = await parseInput({ kind: 'url', value: 'https://example.com/start' });
    expect(httpsRequestMock).toHaveBeenCalledTimes(2);
    expect(pinnedLookups).toEqual([
      { url: 'https://example.com/start', address: '93.184.216.34' },
      { url: 'https://example.org/final.html', address: '93.184.216.35' },
    ]);
    expect(result.markdown).toContain('Redirected content.');
  });

  it('parses archive input by unpacking zip entries', async () => {
    const dir = join(tmpdir(), 'autooffice-test-zip-' + Date.now());
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, 'data.zip');
    const zip = new JSZip();
    zip.file('notes/summary.md', '# Archive Title\n\nArchive body paragraph.');
    zip.file('tables/data.csv', 'Name,Age\nAlice,30');

    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const result = await parseInput({ kind: 'archive', value: zipPath });
      expect(result.markdown).toContain('# Archive: data.zip');
      expect(result.markdown).toContain('Archive Title');
      expect(result.markdown).toContain('| Name | Age |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats zip file input as archive input automatically', async () => {
    const dir = join(tmpdir(), 'autooffice-test-zip-file-' + Date.now());
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, 'bundle.zip');
    const zip = new JSZip();
    zip.file('plain.txt', 'Bundled text content.');

    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const result = await parseInput({ kind: 'file', value: zipPath });
      expect(result.source.kind).toBe('archive');
      expect(result.markdown).toContain('Bundled text content.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses multiple inputs', async () => {
    const inputs: RawInput[] = [
      { kind: 'text', value: 'First document content.' },
      { kind: 'text', value: '第二个文档的内容。' },
    ];
    const results = await parseInputs(inputs);
    expect(results).toHaveLength(2);
    expect(results[0].lang).toBe('en');
    expect(results[1].lang).toBe('zh');
  });
});

describe('evaluator', () => {
  function makeParsed(wordCount: number, lang: 'zh' | 'en' = 'en'): ParsedContent {
    return {
      source: { kind: 'text', value: 'x'.repeat(wordCount) },
      markdown: 'x'.repeat(wordCount),
      byteLength: wordCount,
      wordCount,
      paragraphCount: Math.max(1, Math.floor(wordCount / 100)),
      lang,
    };
  }

  it('routes llmwiki for small content', () => {
    const result = evaluate([makeParsed(500)]);
    expect(result.route).toBe('llmwiki');
    expect(result.totalWords).toBe(500);
  });

  it('routes llmwiki for medium content', () => {
    const result = evaluate([makeParsed(10000)]);
    expect(result.route).toBe('llmwiki');
  });

  it('routes knowleverage for large content', () => {
    const result = evaluate([makeParsed(50000)]);
    expect(result.route).toBe('knowleverage');
  });

  it('increases complexity with multiple sources', () => {
    const single = evaluate([makeParsed(5000)]);
    const multi = evaluate([makeParsed(2500), makeParsed(2500)]);
    expect(multi.complexity).toBeGreaterThanOrEqual(single.complexity);
  });

  it('complexity score is 0-100', () => {
    const r1 = evaluate([makeParsed(10)]);
    const r2 = evaluate([makeParsed(100000)]);
    expect(r1.complexity).toBeGreaterThanOrEqual(0);
    expect(r1.complexity).toBeLessThanOrEqual(100);
    expect(r2.complexity).toBeLessThanOrEqual(100);
  });
});

describe('mermaid-gen', () => {
  it('generates graph from headings and bold terms', () => {
    const content: ParsedContent = {
      source: { kind: 'text', value: '' },
      markdown: '# 项目概览\n\n## 模块A\n\n**关键特性**是重要的。\n\n## 模块B\n\n- 列表项1\n- 列表项2',
      byteLength: 100,
      wordCount: 50,
      paragraphCount: 4,
      lang: 'zh',
    };
    const result = generateMermaid([content]);
    expect(result.code).toContain('graph TD');
    expect(result.code).toContain('ROOT');
    expect(result.concepts.length).toBeGreaterThan(0);
    expect(result.diagramType).toBe('graph');
  });

  it('handles empty content gracefully', () => {
    const content: ParsedContent = {
      source: { kind: 'text', value: '' },
      markdown: 'plain text without structure',
      byteLength: 30,
      wordCount: 5,
      paragraphCount: 1,
      lang: 'en',
    };
    const result = generateMermaid([content]);
    expect(result.code).toContain('graph TD');
    expect(result.diagramType).toBe('graph');
  });

  it('sanitizes unsafe mermaid label characters', () => {
    const content: ParsedContent = {
      source: { kind: 'text', value: '' },
      markdown: '# %%{init:{"theme":"dark"}}%%\n\n## risky`label`;\\\\\n\n- value & detail',
      byteLength: 80,
      wordCount: 12,
      paragraphCount: 3,
      lang: 'en',
    };
    const result = generateMermaid([content]);
    expect(result.code).not.toContain('%%{');
    expect(result.code).not.toContain('`');
    expect(result.code).not.toContain(';');
    expect(result.code).toContain('and');
  });
});

describe('pipeline — summarize', () => {
  it('processes text inputs end-to-end', async () => {
    const inputs: RawInput[] = [
      { kind: 'text', value: '# 报告标题\n\n## 第一章\n\n**核心要点**：这是第一章的内容。\n\n## 第二章\n\n- 要点一\n- 要点二\n- 要点三' },
    ];
    const result = await summarize(inputs);
    expect(result.parsed).toHaveLength(1);
    expect(result.evaluation.route).toBe('llmwiki');
    expect(result.mermaid.code).toContain('graph TD');
    expect(result.combinedMarkdown).toContain('报告标题');
  });

  it('processes multiple inputs with routing', async () => {
    const bigText = '# 大型文档\n\n' + Array.from({ length: 200 }, (_, i) => `## 章节${i}\n\n${'这是一段很长的中文内容用来测试分流逻辑。'.repeat(10)}\n\n`).join('');
    const inputs: RawInput[] = [{ kind: 'text', value: bigText }];
    const result = await summarize(inputs);
    expect(['llmwiki', 'knowleverage']).toContain(result.evaluation.route);
    expect(result.evaluation.totalWords).toBeGreaterThan(SMALL_CONTENT_THRESHOLD);
  });

  it('rejects empty inputs', async () => {
    await expect(summarize([])).rejects.toThrow('At least one input');
  });
});
