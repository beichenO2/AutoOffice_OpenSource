/**
 * AI PPT generation — turns a text prompt into a PptxDeckPayload
 * using PolarPrivate LLM Proxy, then renders via PptxGenJS.
 */

import { chatCompletion, type LlmProxyOptions } from '../integrations/llm-proxy.js';
import type { PptxDeckPayload, PptxSlideInput, PptxThemeId } from './types.js';
import { isPptxThemeId, PPTX_THEME_IDS } from './types.js';

export interface AiPptInput {
  prompt: string;
  numSlides?: number;
  tone?: 'professional' | 'casual' | 'academic' | 'creative';
  language?: 'zh' | 'en';
  theme?: string;
  llm?: LlmProxyOptions;
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Use a formal, professional tone suitable for business presentations.',
  casual: 'Use a friendly, conversational tone.',
  academic: 'Use an academic tone with precise terminology.',
  creative: 'Use an engaging, creative tone with vivid language.',
};

function buildSystemPrompt(input: AiPptInput): string {
  const lang = input.language === 'en' ? 'English' : '中文';
  const slides = input.numSlides ?? 8;
  const tone = TONE_INSTRUCTIONS[input.tone ?? 'professional'] ?? TONE_INSTRUCTIONS.professional;

  return `You are a presentation content designer. Generate a structured presentation in ${lang}.

${tone}

Output ONLY valid JSON matching this schema (no markdown fences, no extra text):
{
  "title": "Presentation title",
  "subtitle": "Optional subtitle",
  "slides": [
    {
      "title": "Slide title",
      "bullets": ["Point 1", "Point 2", "Point 3"]
    }
  ]
}

Rules:
- Generate exactly ${slides} content slides (excluding title slide).
- Each slide has 3–6 bullet points. Never exceed 6.
- Bullet points should be concise (under 25 words each).
- Do NOT include a "Thank you" or "Q&A" slide.
- Make the content substantive and specific, not generic filler.`;
}

export async function generateAiPptPayload(input: AiPptInput): Promise<PptxDeckPayload> {
  const systemPrompt = buildSystemPrompt(input);

  const raw = await chatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.prompt },
    ],
    {
      temperature: 0.7,
      maxTokens: 4096,
      ...input.llm,
    },
  );

  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: { title?: string; subtitle?: string; slides?: Array<{ title?: string; bullets?: string[] }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed.title || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error('LLM response missing required fields (title, slides)');
  }

  const theme: PptxThemeId = isPptxThemeId(input.theme) ? input.theme : 'business';

  const slides: PptxSlideInput[] = parsed.slides.map((s) => ({
    title: s.title ?? '',
    bullets: (s.bullets ?? []).slice(0, 6),
  }));

  return {
    theme,
    locale: input.language === 'en' ? 'en-US' : 'zh-CN',
    title: parsed.title,
    subtitle: parsed.subtitle,
    slides,
  };
}

export { PPTX_THEME_IDS };
