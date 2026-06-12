/**
 * LLM Proxy SDK adapter for AutoOffice.
 *
 * Follows Protocol N1: caller sends capability code only, never model names.
 * LLM Proxy (PolarPrivate) decides which model to use internally.
 */

const LLM_PROXY_BASE = 'http://127.0.0.1:12790';
const LLM_PROXY_V1 = `${LLM_PROXY_BASE}/v1`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProxyOptions {
  /** 4-bit QCSA capability code: '1001'=quality+agent, '0011'=fast+agent, '0100'=long-context */
  capability?: string;
  tier?: 'cloud' | 'local';
  temperature?: number;
  maxTokens?: number;
}

function cloudCapabilityToModelId(code: string): string {
  const c = (code ?? '').trim();
  if (c.toUpperCase().startsWith('V') && c.length === 5) return c.toUpperCase();
  if (/^[01]{4}$/.test(c)) return c;
  return '0001';
}

function localCapabilityToModelId(_code: string): string {
  return 'L0000';
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts: LlmProxyOptions = {},
): Promise<string> {
  const capability = cloudCapabilityToModelId(opts.capability ?? '0001');
  const model = (opts.tier ?? 'cloud') === 'local'
    ? localCapabilityToModelId(capability)
    : capability;

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
    throw new Error(`LLM Proxy error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM Proxy returned empty response');
  return content;
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
