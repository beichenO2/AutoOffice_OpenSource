import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execFileMock, execFileAsyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileAsyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock,
  });
  return {
    execFile,
    spawnSync: spawnSyncMock,
  };
});

import {
  KNOWLEVERAGE_SEARCH_V2_ENV,
  KNOWLEVERAGE_API_URL_ENV,
  KNOWLEVERAGE_TOPIC_ENV,
  getSearchV2Config,
  queryRAG,
} from '../src/integrations/knowleverage.js';

const fetchMock = vi.fn();
let tmpDir: string;
let pageFile: string;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  tmpDir = mkdtempSync(join(tmpdir(), 'kl-v2-'));
  pageFile = join(tmpDir, 'concept-demo.md');
  writeFileSync(pageFile, '---\ntitle: 演示概念\n---\n\n演示正文内容，供 v2 上下文拼装。\n');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[KNOWLEVERAGE_SEARCH_V2_ENV];
  delete process.env[KNOWLEVERAGE_API_URL_ENV];
  delete process.env[KNOWLEVERAGE_TOPIC_ENV];
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('search v2 grayscale', () => {
  it('开关关闭时 getSearchV2Config 返回 null（默认走 v1，零行为变化）', () => {
    expect(getSearchV2Config()).toBeNull();
    process.env[KNOWLEVERAGE_SEARCH_V2_ENV] = 'on';
    // 缺 topic 仍然不启用
    expect(getSearchV2Config()).toBeNull();
  });

  it('开关+topic 就绪时 queryRAG 走 /api/search/v2 并拼装页面正文，不调 subprocess', async () => {
    process.env[KNOWLEVERAGE_SEARCH_V2_ENV] = 'on';
    process.env[KNOWLEVERAGE_TOPIC_ENV] = 'futures-tqsdk';
    process.env[KNOWLEVERAGE_API_URL_ENV] = 'http://127.0.0.1:18080/';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ slug: 'concept-demo', title: '演示概念', type: 'concept', file: pageFile }],
      }),
    });

    const result = await queryRAG('演示查询', 3);

    expect(result.engine).toBe('v2');
    expect(result.success).toBe(true);
    expect(result.context).toContain('演示概念（concept-demo）');
    expect(result.context).toContain('演示正文内容');
    expect(execFileAsyncMock).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:18080/api/search/v2');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      query: '演示查询',
      topic: 'futures-tqsdk',
      top: 3,
    });
  });

  it('v2 HTTP 失败时自动回退 v1 subprocess 路径', async () => {
    process.env[KNOWLEVERAGE_SEARCH_V2_ENV] = 'on';
    process.env[KNOWLEVERAGE_TOPIC_ENV] = 'futures-tqsdk';

    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    spawnSyncMock.mockReturnValue({ status: 0 });
    execFileAsyncMock.mockResolvedValue({ stdout: 'v1 context\n', stderr: '' });

    const result = await queryRAG('回退查询', 2);

    expect(result.engine).toBeUndefined();
    expect(result).toMatchObject({ context: 'v1 context', success: true });
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
  });
});
