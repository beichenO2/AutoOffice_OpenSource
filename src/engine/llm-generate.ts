/**
 * LLM-backed deck generation: turn a topic (+ optional research notes) into a
 * rich, structured DeckSpec via the PolarPrivate LLM Proxy (GLM). This is what
 * lets the "app" produce a real, information-dense presentation from a prompt,
 * instead of the sparse deterministic 3-page fallback. Offline / proxy-down or
 * malformed output falls back to `fallbackDeckSpec`, so it never throws.
 */
import { chatCompletion } from '../integrations/llm-proxy.js';
import type { DeckSpec, SlideSpec, SlideElementSpec } from './html/generate.js';

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    return JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toSlideSpec(s: Record<string, unknown>, idx: number, deckTitle: string, topic: string): SlideSpec {
  const heading = String((s.heading ?? s.title ?? '') as string).trim();
  if (idx === 0 || s.layout === 'title') {
    const title = heading || deckTitle || topic;
    const elements: SlideElementSpec[] = [{ id: 'title', type: 'heading', text: title }];
    const sub = String((s.subtitle ?? '') as string).trim();
    if (sub) elements.push({ id: 'sub', type: 'paragraph', text: sub });
    return { title, layout: 'title', elements };
  }
  const elements: SlideElementSpec[] = [];
  const bullets = Array.isArray(s.bullets) ? (s.bullets as unknown[]).map((b) => String(b).trim()).filter(Boolean) : [];
  bullets.forEach((b, i) => elements.push({ id: `b${i}`, type: 'bullet', text: b }));
  const para = String((s.paragraph ?? '') as string).trim();
  if (para) elements.push({ id: bullets.length ? `p${bullets.length}` : 'p0', type: 'paragraph', text: para });
  const formulas = Array.isArray(s.formulas) ? (s.formulas as unknown[]).map((f) => String(f).trim()).filter(Boolean) : [];
  formulas.forEach((f, i) => elements.push({ id: `f${i}`, type: 'formula', text: f }));
  if (!elements.length) elements.push({ id: 'p0', type: 'paragraph', text: '（本页内容待补充）' });
  return { title: heading || `第 ${idx + 1} 页`, layout: 'content', elements };
}

/**
 * Ask GLM for a full deck outline and map it into a DeckSpec. Returns null when
 * the proxy is unavailable or returns unusable output (caller should fall back).
 */
export async function llmGenerateDeckSpec(
  topic: string,
  research = '',
  opts: { slides?: number; outline?: string; guidance?: string; allowFormulas?: boolean } = {},
): Promise<DeckSpec | null> {
  const n = Math.min(12, Math.max(4, opts.slides ?? 6));
  const researchText = typeof research === 'string' ? research : '';
  const outline = (opts.outline ?? '').trim();
  const guidance = (opts.guidance ?? '').trim();
  const system = [
    '你是资深演示文稿作者。根据「主题」「调研资料/指导」（可能还有「大纲」）产出一份结构化中文幻灯片大纲。',
    outline
      ? '必须严格按给定「大纲」组织页面顺序与主题，不要增删主线页；在每页内把内容做准确、详细的展开。'
      : `共约 ${n} 页：第 1 页为封面（一个标题 + 一句凝练副标题）；其余为内容页。`,
    '内容页每页一个小标题 + 3~6 条要点（bullets），或一段较详细的论述（paragraph）；可两者兼有。',
    '严谨性铁律：所有数据、数字、时间、比例、结论必须来自「调研资料/指导」，忠实引用、不得杜撰或臆测；缺乏依据时给定性描述、不编造具体数字。要点要具体、有信息量、可核对。',
    opts.allowFormulas
      ? '公式排版铁律：所有独立数学公式一律放进该页 "formulas":["LaTeX公式"] 数组（标准 LaTeX，如 "E=mc^2"、"\\\\frac{\\\\partial L}{\\\\partial w}"、"\\\\int_0^1 x\\\\,dx"，会渲染为排版数学）；**不要把裸 LaTeX 直接写进 bullets/paragraph 正文**（会显示成源码）；正文若确需引用行内公式，务必用 $...$ 包裹（如 "半衰期 $t_{1/2}=\\\\frac{\\\\ln 2}{k_e}$"）。仅在数学/公式确有必要时给出，宁缺毋滥。'
      : '不要输出公式字段，正文也不要写 LaTeX。',
    '只输出 JSON（不要解释、不要 Markdown 围栏）：',
    '{"title":"整册标题","slides":[{"layout":"title","heading":"封面主标题","subtitle":"副标题"},{"heading":"小标题","bullets":["要点1","要点2"],"paragraph":"可选论述","formulas":["可选LaTeX"]}]}',
  ].join('\n');
  const grounding = [researchText.trim(), guidance ? `重点指导（须严格遵循）：\n${guidance}` : ''].filter(Boolean).join('\n\n');
  const user = [
    `主题：${topic}`,
    outline ? `\n大纲（严格遵循）：\n${outline}` : '',
    `\n调研资料/指导：\n${grounding || '（无额外资料，请基于可靠常识严谨作答，不要编造具体数字）'}`,
    '\n输出 JSON：',
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { capability: '1000', temperature: 0.45, maxTokens: 3600 },
    );
  } catch {
    return null;
  }
  const parsed = parseJsonLoose(raw);
  const rawSlides = parsed && Array.isArray(parsed.slides) ? (parsed.slides as Record<string, unknown>[]) : [];
  if (!rawSlides.length) return null;

  const deckTitle = String((parsed?.title ?? '') as string).trim() || topic;
  const slides = rawSlides.map((s, i) => toSlideSpec(s, i, deckTitle, topic)).filter((s) => s.elements.length);
  if (slides.length < 2) return null;
  // Guarantee a title cover as slide 1.
  if (slides[0]!.layout !== 'title') {
    slides.unshift({ title: deckTitle, layout: 'title', elements: [{ id: 'title', type: 'heading', text: deckTitle }] });
  }
  return { title: deckTitle, slides };
}

/**
 * Deterministic fallback deck from the topic + research lines — richer than the
 * 3-page brief default, so the app still produces something usable offline.
 */
export function fallbackDeckSpec(topic: string, research = ''): DeckSpec {
  const lines = research
    .split(/\r?\n|[。;；]\s*/)
    .map((l) => l.replace(/^[-*•·\d.、)\s]+/, '').trim())
    .filter((l) => l.length >= 6)
    .slice(0, 18);
  const slides: SlideSpec[] = [
    { title: topic, layout: 'title', elements: [{ id: 'title', type: 'heading', text: topic }, { id: 'sub', type: 'paragraph', text: '基于调研资料自动生成的演示提纲' }] },
  ];
  const perPage = 4;
  const headings = ['背景与现状', '关键要点', '数据与进展', '影响与展望', '要点补充'];
  for (let i = 0; i < lines.length && slides.length < 6; i += perPage) {
    const chunk = lines.slice(i, i + perPage);
    slides.push({
      title: headings[slides.length - 1] ?? `要点 ${slides.length}`,
      layout: 'content',
      elements: chunk.map((t, j) => ({ id: `b${j}`, type: 'bullet' as const, text: t })),
    });
  }
  if (slides.length === 1) {
    slides.push({ title: '概述', layout: 'content', elements: [{ id: 'p0', type: 'paragraph', text: `关于「${topic}」的演示提纲（暂无调研资料）。` }] });
  }
  return { title: topic, slides };
}

/**
 * Insert caller-chosen images into a deck at the requested (1-based) slide indices
 * — the "选好的插图" input. Only `data:image/*` and http(s) sources are allowed;
 * out-of-range/absent slide indices default to the first content slide.
 */
export function insertImagesIntoSpec(
  spec: DeckSpec,
  images: { slide?: number; src: string; alt?: string }[],
): DeckSpec {
  const slides = spec.slides.map((s) => ({ ...s, elements: [...s.elements] }));
  images.forEach((img, k) => {
    const src = String(img?.src ?? '').trim();
    if (!/^data:image\//i.test(src) && !/^https?:\/\//i.test(src)) return; // skip unsafe/empty
    let idx = Number.isInteger(img?.slide) ? (img.slide as number) - 1 : -1;
    if (idx < 0 || idx >= slides.length) idx = Math.min(slides.length - 1, 1);
    slides[idx]!.elements.push({ id: `img${k}`, type: 'image', src, alt: String(img?.alt ?? '示意图') });
  });
  return { ...spec, slides };
}

/**
 * S7 animation: turn a static deck into an animated one — a default slide
 * transition (headmatter) + step-reveal (Slidev v-click) on every content
 * slide's body. Deterministic + pure; the title/cover slide never reveals so the
 * opening reads cleanly. Inert in the sandboxed preview, real in slidev export/dev.
 */
export function applyDeckAnimation(spec: DeckSpec, transition = 'slide-left'): DeckSpec {
  return {
    ...spec,
    transition: spec.transition ?? transition,
    slides: spec.slides.map((s) => (s.layout === 'title' ? s : { ...s, reveal: true })),
  };
}

/**
 * Data-rigor report for a generated deck (#4「验证具体数据是否严谨」).
 * `checked` = specific numeric claims examined; `grounded` = those found in the
 * grounding sources; `flagged` = text nodes carrying numbers with no source.
 */
export interface GroundingReport {
  checked: number;
  grounded: number;
  flagged: { slide: number; text: string; numbers: string[] }[];
}

/** Normalize a string for numeric matching: full-width→ASCII, drop spaces/commas. */
function normalizeNumeric(s: string): string {
  return (s || '')
    .replace(/[\uFF10-\uFF19]/g, (d) => String('０１２３４５６７８９'.indexOf(d)))
    .replace(/％/g, '%')
    .replace(/[，,\s]/g, '');
}

/** The numeric core of a token, e.g. "16.6%" → "16.6", for source matching. */
function numericCore(tok: string): string {
  return normalizeNumeric(tok).replace(/%/g, '');
}

/**
 * Extract "specific" numbers worth verifying from a text run: percentages,
 * decimals, and multi-digit figures (≥10). Bare single digits (0–9) — bullet
 * counts, ordinals, "3 条" — are intentionally skipped to avoid false alarms.
 */
export function extractSpecificNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\d+(?:\.\d+)?%?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tok = m[0];
    const specific = tok.includes('.') || tok.includes('%') || Number.parseFloat(tok) >= 10;
    if (specific) out.push(tok);
  }
  return out;
}

/**
 * Scan a deck for specific numeric claims and verify each appears in the
 * grounding sources (guidance + research). Formulas and images are exempt —
 * their numbers are notation/assets, not factual claims. Advisory + deterministic
 * (pure), so it never blocks generation and is fully unit-testable.
 */
export function verifyDeckGrounding(spec: DeckSpec, sources: string): GroundingReport {
  const srcCore = numericCore(sources || '');
  const flagged: GroundingReport['flagged'] = [];
  let checked = 0;
  let grounded = 0;
  spec.slides.forEach((s, si) => {
    s.elements.forEach((elm) => {
      if (elm.type === 'image' || elm.type === 'formula') return;
      const text = elm.text ?? '';
      const nums = extractSpecificNumbers(text);
      if (!nums.length) return;
      const missing: string[] = [];
      for (const n of nums) {
        checked += 1;
        if (srcCore && srcCore.includes(numericCore(n))) grounded += 1;
        else missing.push(n);
      }
      if (missing.length) flagged.push({ slide: si + 1, text: text.slice(0, 100), numbers: missing });
    });
  });
  return { checked, grounded, flagged };
}
