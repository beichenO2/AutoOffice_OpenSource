/**
 * LLM Proxy SDK adapter for AutoOffice.
 *
 * Follows Protocol N1: caller sends capability code only, never model names.
 * LLM Proxy (PolarPrivate) decides which model to use internally.
 */

const LLM_PROXY_BASE = 'http://127.0.0.1:12790';
const LLM_PROXY_V1 = `${LLM_PROXY_BASE}/v1`;

/**
 * Default QCSA capability code for text tasks — the single source of truth for
 * AutoOffice. PolarPrivate's routing table changes generations occasionally
 * (2026-08: legacy 0001/1000/1001 bindings were removed; '0110' = fast direct
 * text; '1110' = thinking model that leaks <think> into content, unusable for
 * surgical rewrites). When the table moves again, override with the
 * AUTOOFFICE_LLM_CAPABILITY env var instead of editing call sites.
 */
export function defaultTextCapability(): string {
  const env = (process.env.AUTOOFFICE_LLM_CAPABILITY ?? '').trim();
  return env || '0110';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProxyOptions {
  /** QCSA capability code (e.g. '0110'); defaults to defaultTextCapability(). */
  capability?: string;
  tier?: 'cloud' | 'local';
  temperature?: number;
  maxTokens?: number;
}

function cloudCapabilityToModelId(code: string): string {
  const c = (code ?? '').trim();
  if (c.toUpperCase().startsWith('V') && c.length === 5) return c.toUpperCase();
  if (/^[01]{4}$/.test(c)) return c;
  return defaultTextCapability();
}

function localCapabilityToModelId(_code: string): string {
  return 'L0000';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chatCompletion(
  messages: ChatMessage[],
  opts: LlmProxyOptions = {},
): Promise<string> {
  const capability = cloudCapabilityToModelId(opts.capability ?? defaultTextCapability());
  const model = (opts.tier ?? 'cloud') === 'local'
    ? localCapabilityToModelId(capability)
    : capability;

  // PolarPrivate resolves capability codes through a pool of upstream bindings;
  // a single broken pool member surfaces as an intermittent 5xx (e.g. 503
  // BINDING_NOT_FOUND) while sibling requests succeed. Bounded retry absorbs
  // that per-request roulette; non-5xx errors still fail immediately.
  const attempts = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${LLM_PROXY_V1}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = new Error(`LLM Proxy error ${res.status}: ${body.slice(0, 300)}`);
      if (res.status >= 500 && attempt < attempts - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastError;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM Proxy returned empty response');
    return content;
  }
  throw lastError ?? new Error('LLM Proxy error: retries exhausted');
}

export async function checkLlmProxyHealth(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${LLM_PROXY_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return { available: res.ok };
  } catch (err: unknown) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deep probe: /health only proves the proxy process is up — a missing model
 * binding still 503s on real completions (BINDING_NOT_FOUND). Live-GLM tests
 * use this to skip honestly when the text-LLM path is genuinely unavailable.
 */
export async function checkLlmChatAvailable(): Promise<{
  available: boolean;
  error?: string;
}> {
  try {
    const out = await chatCompletion(
      [{ role: 'user', content: 'ping — reply with: pong' }],
      { temperature: 0, maxTokens: 8 },
    );
    return { available: out.trim().length > 0 };
  } catch (err: unknown) {
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}
