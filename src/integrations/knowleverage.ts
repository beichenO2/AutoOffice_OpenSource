/**
 * KnowLeverage RAG Engine integration.
 * Enriches report content with context from the knowledge base.
 * Uses KnowLeverage's python_library API via subprocess call.
 */

import { execFile, spawnSync, type ExecFileException } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PYTHON_CANDIDATES = ['/opt/homebrew/bin/python3', 'python3'];

export const KNOWLEVERAGE_DIR_ENV = 'AUTOOFFICE_KNOWLEVERAGE_DIR';
export const DEFAULT_KNOWLEVERAGE_DIR = resolve(__dirname, '..', '..', '..', 'KnowLever');

/** 检索 v2 灰度开关（'on' 启用；默认 off 走 v1 subprocess 路径） */
export const KNOWLEVERAGE_SEARCH_V2_ENV = 'AUTOOFFICE_KNOWLEVERAGE_SEARCH_V2';
/** KnowLever HTTP API 地址（v2 路径用） */
export const KNOWLEVERAGE_API_URL_ENV = 'AUTOOFFICE_KNOWLEVERAGE_API_URL';
/** v2 检索的 substrate topic（v2 是主题域检索，必须指定才启用） */
export const KNOWLEVERAGE_TOPIC_ENV = 'AUTOOFFICE_KNOWLEVERAGE_TOPIC';
export const DEFAULT_KNOWLEVERAGE_API_URL = 'http://127.0.0.1:18080';

/** Must match KnowLever `rag/pipeline.py` — shared by subprocess scripts and summarize handoff metadata. */
export const KNOWLEVERAGE_RAG_MODULE = 'rag.pipeline' as const;
export const KNOWLEVERAGE_RAG_CLASS = 'RAGPipeline' as const;

/** Python `-c` probe used by {@link findPythonForKnowLeverage} (exported for tests). */
export function knowleveragePythonImportProbeScript(): string {
  return `import sys
import importlib
sys.path.insert(0, sys.argv[1])
importlib.import_module("${KNOWLEVERAGE_RAG_MODULE}")
`;
}

export function getKnowLeverageDir(): string {
  const configured = process.env[KNOWLEVERAGE_DIR_ENV];
  return resolve(configured && configured.trim() ? configured : DEFAULT_KNOWLEVERAGE_DIR);
}

function canRunPython(candidate: string, args: string[]): boolean {
  try {
    const { status } = spawnSync(candidate, args, { stdio: 'pipe' });
    return status === 0;
  } catch {
    return false;
  }
}

export function findPythonForKnowLeverage(knowleverageDir: string = getKnowLeverageDir()): string {
  const importProbe = ['-c', knowleveragePythonImportProbeScript(), knowleverageDir];

  for (const candidate of PYTHON_CANDIDATES) {
    if (canRunPython(candidate, importProbe)) {
      return candidate;
    }
  }

  for (const candidate of PYTHON_CANDIDATES) {
    if (canRunPython(candidate, ['--version'])) {
      return candidate;
    }
  }

  return 'python3';
}

const QUERY_RAG_SCRIPT = `
import json
import sys

sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])

try:
    from ${KNOWLEVERAGE_RAG_MODULE} import ${KNOWLEVERAGE_RAG_CLASS}
    pipeline = ${KNOWLEVERAGE_RAG_CLASS}()
    context = pipeline.build_context(query=payload["query"], top_k=payload["top_k"])
    print(context)
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;

const INGEST_DOCUMENT_SCRIPT = `
import json
import sys

sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])

try:
    from ${KNOWLEVERAGE_RAG_MODULE} import ${KNOWLEVERAGE_RAG_CLASS}
    pipeline = ${KNOWLEVERAGE_RAG_CLASS}()
    pipeline.ingest_document(text=payload["text"], doc_id=payload["doc_id"])
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;

async function runKnowLeverageScript(
  script: string,
  payload: Record<string, string | number>,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  const knowleverageDir = getKnowLeverageDir();
  const python = findPythonForKnowLeverage(knowleverageDir);
  // Keep the Python source static and pass user-derived values as argv JSON.
  return execFileAsync(python, ['-c', script, knowleverageDir, JSON.stringify(payload)], {
    timeout,
    cwd: knowleverageDir,
  });
}

function extractExecFileErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const execError = error as ExecFileException;
    if (typeof execError.stderr === 'string' && execError.stderr.trim() !== '') {
      return execError.stderr.trim();
    }
    if (typeof execError.stdout === 'string' && execError.stdout.trim() !== '') {
      return execError.stdout.trim();
    }
  }

  return error instanceof Error ? error.message : String(error);
}

export interface RAGQueryResult {
  context: string;
  query: string;
  success: boolean;
  error?: string;
  /** 命中的检索引擎；v1 路径不写该字段（兼容既有消费方） */
  engine?: 'v2';
}

/** v2 灰度配置；开关未开或缺 topic 时返回 null（继续走 v1） */
export function getSearchV2Config(): { url: string; topic: string } | null {
  if ((process.env[KNOWLEVERAGE_SEARCH_V2_ENV] ?? '').trim().toLowerCase() !== 'on') return null;
  const topic = process.env[KNOWLEVERAGE_TOPIC_ENV]?.trim();
  if (!topic) return null;
  const url = (process.env[KNOWLEVERAGE_API_URL_ENV]?.trim() || DEFAULT_KNOWLEVERAGE_API_URL).replace(/\/+$/, '');
  return { url, topic };
}

interface SearchV2Item {
  slug: string;
  title: string;
  type: string;
  file: string;
}

/**
 * v2 路径：POST /api/search/v2（转译+混合召回），命中页面按 file 路径读正文拼上下文。
 * 返回 null 表示 v2 不可用/失败，调用方回退 v1（灰度降级）。
 */
async function querySearchV2(query: string, topK: number): Promise<RAGQueryResult | null> {
  const cfg = getSearchV2Config();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/api/search/v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topic: cfg.topic, top: topK, vector: true }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: SearchV2Item[] };
    const items = data.results ?? [];
    if (items.length === 0) {
      return { context: '', query, success: true, engine: 'v2' };
    }
    const { readFile } = await import('node:fs/promises');
    const parts: string[] = [];
    for (const item of items) {
      try {
        const raw = await readFile(item.file, 'utf-8');
        const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim().slice(0, 2000);
        if (body) parts.push(`### ${item.title}（${item.slug}）\n\n${body}`);
      } catch {
        // 页面文件不可读（如跨机部署）→ 整体回退 v1
      }
    }
    if (parts.length === 0) return null;
    return { context: parts.join('\n\n'), query, success: true, engine: 'v2' };
  } catch {
    return null;
  }
}

export interface EnrichmentResult {
  original: string;
  enriched: string;
  ragContexts: RAGQueryResult[];
  enrichmentCount: number;
}

export function normalizePositiveIntegerOption(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const integer = Math.floor(numeric);
  return integer > 0 ? integer : undefined;
}

/**
 * Query KnowLeverage RAG engine for context on a topic.
 * 灰度：AUTOOFFICE_KNOWLEVERAGE_SEARCH_V2=on 且设置 topic 时优先走 /api/search/v2，失败自动回退 v1。
 */
export async function queryRAG(query: string, topK: number = 3): Promise<RAGQueryResult> {
  const safeTopKV2 = Math.min(100, normalizePositiveIntegerOption(topK) ?? 3);
  const v2 = await querySearchV2(query, safeTopKV2);
  if (v2) return v2;
  try {
    const safeTopK = Math.min(100, normalizePositiveIntegerOption(topK) ?? 3);
    const { stdout, stderr } = await runKnowLeverageScript(
      QUERY_RAG_SCRIPT,
      { query, top_k: safeTopK },
      15000,
    );

    if (stderr && stderr.includes('ERROR:')) {
      return { context: '', query, success: false, error: stderr.trim() };
    }

    return { context: stdout.trim(), query, success: true };
  } catch (err: unknown) {
    const message = extractExecFileErrorMessage(err);
    return { context: '', query, success: false, error: message };
  }
}

/**
 * Ingest a document into KnowLeverage RAG engine.
 */
export async function ingestDocument(text: string, docId: string): Promise<boolean> {
  try {
    const truncated = text.slice(0, 10000);
    const { stderr } = await runKnowLeverageScript(
      INGEST_DOCUMENT_SCRIPT,
      { text: truncated, doc_id: docId },
      30000,
    );

    return !stderr || !stderr.includes('ERROR:');
  } catch {
    return false;
  }
}

function extractTopics(markdown: string): string[] {
  const headings: string[] = [];
  const headingRe = /^#{1,3}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(markdown)) !== null) {
    const h = match[1]?.trim();
    if (h && h.length > 2) headings.push(h);
  }

  const boldRe = /\*\*([^*]+)\*\*/g;
  while ((match = boldRe.exec(markdown)) !== null) {
    const t = match[1]?.trim();
    if (t && t.length > 2 && t.length < 40) headings.push(t);
  }

  return [...new Set(headings)].slice(0, 5);
}

/**
 * Enrich report content with RAG context.
 * Extracts key topics, queries KnowLeverage, and appends relevant context.
 */
export async function enrichWithRAG(
  markdown: string,
  options: { maxQueries?: number; topK?: number } = {},
): Promise<EnrichmentResult> {
  const maxQueries = normalizePositiveIntegerOption(options.maxQueries) ?? 3;
  const topK = Math.min(100, normalizePositiveIntegerOption(options.topK) ?? 3);
  const topics = extractTopics(markdown);
  const queries = topics.slice(0, maxQueries);

  const ragResults: RAGQueryResult[] = [];

  for (const q of queries) {
    const result = await queryRAG(q, topK);
    ragResults.push(result);
  }

  const successfulContexts = ragResults.filter((r) => r.success && r.context.length > 0);

  if (successfulContexts.length === 0) {
    return {
      original: markdown,
      enriched: markdown,
      ragContexts: ragResults,
      enrichmentCount: 0,
    };
  }

  let enriched = markdown;
  enriched += '\n\n---\n\n## 知识库补充\n\n';
  enriched += '> 以下内容来自知识杠杆 RAG 引擎的自动检索结果。\n\n';

  for (const ctx of successfulContexts) {
    enriched += `### ${ctx.query}\n\n${ctx.context}\n\n`;
  }

  return {
    original: markdown,
    enriched,
    ragContexts: ragResults,
    enrichmentCount: successfulContexts.length,
  };
}
