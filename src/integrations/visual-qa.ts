/**
 * VLM-based visual quality assurance — via PolarPrivate L-codes (Ollama behind proxy).
 *
 * Local VLM slot: L101 only (8B VLM). L000/L100 are text chat (8B/32B).
 */

const LLM_PROXY_BASE = `http://127.0.0.1:${process.env.POLARPRIVATE_PORT ?? '12790'}`;
const LLM_PROXY_V1 = `${LLM_PROXY_BASE}/v1`;

export interface VisualQAResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Opaque L-code, never Ollama tag */
  model: string;
  backend: 'local-proxy';
  dimensions: {
    layoutConsistency: number;
    whitespace: number;
    colorHarmony: number;
    fontReadability: number;
    informationDensity: number;
  };
  issues: string[];
  suggestions: string[];
  rawResponse: string;
}

export interface VisualQAOptions {
  escalated?: boolean;
  locale?: 'zh-CN' | 'en-US';
}

const EVALUATION_PROMPT_ZH = `你是一个专业的文档设计评审专家。请评估这份文档截图的视觉质量。

请从以下 5 个维度打分（每个维度 1-10 分）：
1. 排版一致性（标题层级、对齐、间距是否统一）
2. 留白合理性（内容密度是否适中，不拥挤也不空旷）
3. 配色和谐度（颜色搭配是否协调、专业）
4. 字体可读性（字号、字重、行间距是否便于阅读）
5. 信息密度（每页信息量是否适当，重点是否突出）

请严格按以下 JSON 格式回复（不要添加其他文字）：
{"layoutConsistency":N,"whitespace":N,"colorHarmony":N,"fontReadability":N,"informationDensity":N,"issues":["问题1","问题2"],"suggestions":["建议1","建议2"]}`;

const EVALUATION_PROMPT_EN = `You are an expert document design reviewer. Evaluate the visual quality of this document screenshot.

Score each dimension (1-10):
1. Layout Consistency (heading hierarchy, alignment, spacing uniformity)
2. Whitespace (content density — not too cramped, not too sparse)
3. Color Harmony (color palette coordination and professionalism)
4. Font Readability (font size, weight, line spacing)
5. Information Density (appropriate info per page, key points highlighted)

Reply STRICTLY in this JSON format (no other text):
{"layoutConsistency":N,"whitespace":N,"colorHarmony":N,"fontReadability":N,"informationDensity":N,"issues":["issue1","issue2"],"suggestions":["suggestion1","suggestion2"]}`;

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 8.5) return 'A';
  if (score >= 7) return 'B';
  if (score >= 5.5) return 'C';
  if (score >= 4) return 'D';
  return 'F';
}

function visionModelId(_escalated?: boolean): string {
  return 'L101';
}

export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LLM_PROXY_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** @deprecated llama-server removed; always false */
export async function checkLlamaServerAvailable(): Promise<boolean> {
  return false;
}

export async function checkVisualQABackends(): Promise<{
  ollama: boolean;
  llamaServer: boolean;
  preferred: 'ollama' | null;
}> {
  const ok = await checkOllamaAvailable();
  return { ollama: ok, llamaServer: false, preferred: ok ? 'ollama' : null };
}

function emptyResult(issues: string[], rawResponse: string, model: string): VisualQAResult {
  return {
    score: 0,
    grade: 'F',
    model,
    backend: 'local-proxy',
    dimensions: {
      layoutConsistency: 0,
      whitespace: 0,
      colorHarmony: 0,
      fontReadability: 0,
      informationDensity: 0,
    },
    issues,
    suggestions: [],
    rawResponse,
  };
}

async function evaluateViaProxy(
  imageBase64: string,
  prompt: string,
  modelId: string,
): Promise<string> {
  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const dataUri = `data:image/png;base64,${cleanBase64}`;
  const res = await fetch(`${LLM_PROXY_V1}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Local VLM proxy error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function evaluateDocumentVisual(
  imageBase64: string,
  options: VisualQAOptions = {},
): Promise<VisualQAResult> {
  const prompt = options.locale === 'en-US' ? EVALUATION_PROMPT_EN : EVALUATION_PROMPT_ZH;
  const modelId = visionModelId(!!options.escalated);
  const { preferred } = await checkVisualQABackends();

  if (!preferred) {
    throw new Error(
      'Local VLM unavailable. Ensure PolarPrivate (:12790) and Ollama are running.',
    );
  }

  const rawResponse = await evaluateViaProxy(imageBase64, prompt, modelId);
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return emptyResult(['VLM response did not contain valid JSON'], rawResponse, modelId);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      layoutConsistency?: number;
      whitespace?: number;
      colorHarmony?: number;
      fontReadability?: number;
      informationDensity?: number;
      issues?: string[];
      suggestions?: string[];
    };

    const dims = {
      layoutConsistency: parsed.layoutConsistency ?? 5,
      whitespace: parsed.whitespace ?? 5,
      colorHarmony: parsed.colorHarmony ?? 5,
      fontReadability: parsed.fontReadability ?? 5,
      informationDensity: parsed.informationDensity ?? 5,
    };

    const avg =
      (dims.layoutConsistency + dims.whitespace + dims.colorHarmony + dims.fontReadability + dims.informationDensity) /
      5;

    return {
      score: Math.round(avg * 10) / 10,
      grade: scoreToGrade(avg),
      model: modelId,
      backend: 'local-proxy',
      dimensions: dims,
      issues: parsed.issues ?? [],
      suggestions: parsed.suggestions ?? [],
      rawResponse,
    };
  } catch {
    return emptyResult(['Failed to parse VLM JSON response'], rawResponse, modelId);
  }
}
