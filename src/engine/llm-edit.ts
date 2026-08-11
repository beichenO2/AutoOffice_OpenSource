/**
 * LLM-backed local edit for box selections.
 *
 * The deterministic edit path only applies *literal* instructions ("把标题改成X").
 * Real users frame a region and say things like「这句太啰嗦」「我不满意，换个更专业的说法」
 * —— non-literal intent. When AUTOOFFICE_LLM_EDIT=1 and a confident target node is
 * resolved, we ask the PolarPrivate LLM Proxy (GLM) to produce a concrete
 * replacement for *that node only*, then reuse the same scoped, collateral-checked
 * edit machinery to commit it. Opt-in flag keeps deterministic/offline tests intact.
 */
import { JSDOM } from 'jsdom';
import { chatCompletion } from '../integrations/llm-proxy.js';
import type { SourceFile } from './types.js';

/** Master switch. Off by default so tests / offline runs keep exact behaviour. */
export function llmEditEnabled(): boolean {
  return (process.env.AUTOOFFICE_LLM_EDIT ?? '').trim() === '1';
}

function cssEscape(id: string): string {
  return id.replace(/["\\]/g, '\\$&');
}

/** Current visible text of a node, read from the revision's HTML-ish source. */
export function nodeCurrentText(source: SourceFile[], nodeId: string): string {
  for (const f of source) {
    if (!/[<]/.test(f.content)) continue; // skip non-HTML (e.g. raw LaTeX) sources
    const dom = new JSDOM(`<body>${f.content}</body>`);
    const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
    if (el) return (el.textContent ?? '').trim();
  }
  return '';
}

/** Is this node an <img> element in the revision source? */
export function nodeIsImage(source: SourceFile[], nodeId: string): boolean {
  for (const f of source) {
    if (!/[<]/.test(f.content)) continue;
    const dom = new JSDOM(`<body>${f.content}</body>`);
    const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
    if (el) return el.tagName.toLowerCase() === 'img';
  }
  return false;
}

function stripToLine(s: string): string {
  let t = s.trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```$/,'').trim();
  t = t.replace(/^[「『"'“”]+/, '').replace(/[」』"'“”]+$/,'').trim();
  t = t.replace(/^[-*•·]\s*/, '').trim();
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  return t;
}

/**
 * Rewrite one text node per a free-form instruction. Returns the replacement text
 * (single line, no markup). Throws if the proxy fails — caller decides fallback.
 */
export async function llmRewriteText(current: string, instruction: string): Promise<string> {
  const system = [
    '你是 AutoOffice 的中文文案编辑。用户在幻灯片/文档里框选了一段文字，并提出修改意见。',
    '只输出"修改后的这一段文字本身"：不要解释、不要引号、不要 Markdown、不要项目符或序号、不要换行。',
    '保持与原文相同的语言；除非用户明确要求变长/变短，长度大致相当；务必专业、准确、通顺。',
  ].join('');
  const user = `原文：\n${current || '(空)'}\n\n修改意见：${instruction}\n\n直接输出修改后的文字：`;
  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.4, maxTokens: 600 },
  );
  const out = stripToLine(raw);
  if (!out) throw new Error('LLM returned empty rewrite');
  return out;
}

// ---------------------------------------------------------------------------
// Visual style micro-edits (元素级"微调": line weight / alignment / size /
// spacing / color / radius …). A bounded whitelist keeps both GLM output and the
// deterministic fast-path to safe, self-contained inline-style props applied to
// the framed node only (the collateral guard keeps it scoped).
// ---------------------------------------------------------------------------

/** Current inline `style` attribute of a node (empty string if none / no HTML). */
export function nodeCurrentStyle(source: SourceFile[], nodeId: string): string {
  for (const f of source) {
    if (!/[<]/.test(f.content)) continue;
    const dom = new JSDOM(`<body>${f.content}</body>`);
    const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
    if (el) return (el.getAttribute('style') ?? '').trim();
  }
  return '';
}

const NAMED_COLORS: Record<string, string> = {
  红: '#c0392b', 红色: '#c0392b', 大红: '#c0392b', 蓝: '#2563eb', 蓝色: '#2563eb', 绿: '#159e5b', 绿色: '#159e5b',
  黄: '#e6a700', 黄色: '#e6a700', 橙: '#e8590c', 橙色: '#e8590c', 紫: '#7c3aed', 紫色: '#7c3aed',
  黑: '#111827', 黑色: '#111827', 白: '#ffffff', 白色: '#ffffff', 灰: '#6b7280', 灰色: '#6b7280', 金: '#c8a02c', 金色: '#c8a02c',
  red: '#c0392b', blue: '#2563eb', green: '#159e5b', yellow: '#e6a700', orange: '#e8590c', purple: '#7c3aed',
  black: '#111827', white: '#ffffff', gray: '#6b7280', grey: '#6b7280', gold: '#c8a02c',
};

function sanitizeColor(v: string): string | null {
  const t = (v ?? '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) return t.toLowerCase();
  if (/^rgba?\(\s*[\d.\s,%/]+\)$/i.test(t)) return t;
  return NAMED_COLORS[t] ?? NAMED_COLORS[t.toLowerCase()] ?? null;
}

function sanitizeSize(
  v: string,
  spec: { kw?: string[]; px?: [number, number]; vw?: [number, number]; em?: [number, number] },
): string | null {
  const t = (v ?? '').trim();
  if (spec.kw?.includes(t)) return t;
  const m = /^(-?\d*\.?\d+)\s*(px|vw|em)?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const unit = m[2] ?? '';
  const inRange = (r?: [number, number]) => !!r && n >= r[0] && n <= r[1];
  if (unit === 'px' && inRange(spec.px)) return `${n}px`;
  if (unit === 'vw' && inRange(spec.vw)) return `${n}vw`;
  if (unit === 'em' && inRange(spec.em)) return `${n}em`;
  if (!unit && inRange(spec.px)) return `${n}px`;
  return null;
}

const numRange = (lo: number, hi: number) => (v: string): string | null => {
  const t = (v ?? '').trim();
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return n >= lo && n <= hi ? String(n) : null;
};

/** Whitelist: CSS prop → validator returning a safe value (or null to drop). */
const STYLE_PROPS: Record<string, (v: string) => string | null> = {
  'text-align': (v) => (/^(left|right|center|justify)$/.test(v.trim()) ? v.trim() : null),
  'font-weight': (v) => (/^(normal|bold|bolder|lighter|[1-9]00)$/.test(v.trim()) ? v.trim() : null),
  'font-style': (v) => (/^(normal|italic|oblique)$/.test(v.trim()) ? v.trim() : null),
  // Explicit sizes only — the relative keywords (larger/smaller) resolve against
  // the PARENT font-size, which would shrink a vw-sized title; size nudges instead
  // go through sizeNudgeFactor()×roleBaseFontVw() to a concrete vw.
  'font-size': (v) => sanitizeSize(v, { px: [8, 200], vw: [0.6, 12], em: [0.4, 6] }),
  'line-height': numRange(1, 3),
  'letter-spacing': (v) => (v.trim() === 'normal' ? 'normal' : sanitizeSize(v, { px: [-3, 24], vw: [0, 2], em: [-0.06, 0.8] })),
  color: sanitizeColor,
  'background-color': sanitizeColor,
  opacity: numRange(0.05, 1),
  'border-style': (v) => (/^(solid|dashed|dotted|double|none)$/.test(v.trim()) ? v.trim() : null),
  'border-width': (v) => sanitizeSize(v, { px: [0, 24], vw: [0, 2.5], em: [0, 2] }),
  'border-left-width': (v) => sanitizeSize(v, { px: [0, 24], vw: [0, 2.5], em: [0, 2] }),
  'border-color': sanitizeColor,
  'border-radius': (v) => sanitizeSize(v, { px: [0, 80], vw: [0, 5], em: [0, 5] }),
  'text-transform': (v) => (/^(none|uppercase|lowercase|capitalize)$/.test(v.trim()) ? v.trim() : null),
  'margin-top': (v) => sanitizeSize(v, { px: [0, 200], vw: [0, 10], em: [0, 10] }),
  'margin-bottom': (v) => sanitizeSize(v, { px: [0, 200], vw: [0, 10], em: [0, 10] }),
  padding: (v) => sanitizeSize(v, { px: [0, 120], vw: [0, 8], em: [0, 8] }),
};

/** Keep only whitelisted, validated style declarations. */
export function sanitizeStyleMap(map: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kRaw, vRaw] of Object.entries(map ?? {})) {
    const k = String(kRaw).trim().toLowerCase();
    const val = STYLE_PROPS[k]?.(String(vRaw));
    if (val != null) out[k] = val;
  }
  return out;
}

/** Common visual phrases → deterministic style map (no LLM needed). */
export function deterministicStyleOps(instruction: string): Record<string, string> {
  const s = (instruction ?? '').toLowerCase();
  const out: Record<string, string> = {};
  const any = (arr: string[]) => arr.some((h) => s.includes(h));
  if (any(['居中', '水平居中', 'center', 'centre'])) out['text-align'] = 'center';
  else if (any(['左对齐', 'left align', 'align left'])) out['text-align'] = 'left';
  else if (any(['右对齐', 'right align', 'align right'])) out['text-align'] = 'right';
  else if (any(['两端对齐', 'justify'])) out['text-align'] = 'justify';
  if (any(['取消加粗', '不加粗', '别加粗', '不要加粗'])) out['font-weight'] = '400';
  else if (any(['加粗', '变粗', '更粗一点', '更粗', 'bold'])) out['font-weight'] = '800';
  if (any(['斜体', 'italic'])) out['font-style'] = 'italic';
  // font-size is added by the caller via sizeNudgeFactor()×roleBaseFontVw (reliable
  // concrete vw), because a relative keyword here would resolve against the parent.
  if (any(['行距大', '行距松', '行高大', '行间距大', '宽松'])) out['line-height'] = '1.9';
  else if (any(['行距小', '行距紧', '行高小', '紧凑'])) out['line-height'] = '1.25';
  if (any(['字距大', '字距松', '字间距大'])) out['letter-spacing'] = '0.12em';
  else if (any(['字距小', '字距紧', '字间距小'])) out['letter-spacing'] = '-0.02em';
  return out;
}

/**
 * GLM maps a free-form visual instruction (「这条线细一点」「标题标红居中」) → a small
 * whitelisted inline-style map for the framed node. Everything is validated by
 * sanitizeStyleMap, so an out-of-list or malformed value is simply dropped.
 */
export async function llmStyleEdit(
  currentStyle: string,
  currentText: string,
  instruction: string,
  opts: { isImage?: boolean } = {},
): Promise<Record<string, string>> {
  const props = Object.keys(STYLE_PROPS).join(', ');
  const system = [
    '你是 AutoOffice 幻灯片的"视觉微调"助手。用户框选了一个元素，提出视觉/排版上的修改意见（不是改文字内容）。',
    `只输出一个 JSON：{"style":{"CSS属性":"值"}}，属性只能取自白名单：[${props}]。`,
    '不要解释、不要 Markdown、不要多余字段；值要具体合法（颜色用 #RRGGBB 或常见色名；尺寸带单位 px/vw/em；font-size 也可用 larger/smaller）。',
    '只给需要改动的属性，其余别动；保持元素原有用途（标题仍是标题）。',
    opts.isImage ? '这是图片元素：可调 border-radius / border-width / border-color / opacity 等。' : '',
  ].filter(Boolean).join('');
  const user = `元素当前内容：${currentText || '(图片/无文字)'}\n当前 style：${currentStyle || '(无)'}\n修改意见：${instruction}\n输出 JSON：`;
  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.2, maxTokens: 300 },
  );
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s === -1 || e <= s) return {};
    const parsed = JSON.parse(raw.slice(s, e + 1));
    const styleObj =
      parsed && typeof parsed === 'object' && (parsed as { style?: unknown }).style && typeof (parsed as { style?: unknown }).style === 'object'
        ? (parsed as { style: Record<string, unknown> }).style
        : (parsed as Record<string, unknown>);
    return sanitizeStyleMap(styleObj as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** Lowercased tag name of a node in the revision source (''+ if not found). */
export function nodeTag(source: SourceFile[], nodeId: string): string {
  for (const f of source) {
    if (!/[<]/.test(f.content)) continue;
    const dom = new JSDOM(`<body>${f.content}</body>`);
    const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
    if (el) return el.tagName.toLowerCase();
  }
  return '';
}

/** Direction of a "make it bigger / smaller" ask → a font-size multiplier (1 = none). */
export function sizeNudgeFactor(instruction: string): number {
  const s = (instruction ?? '').toLowerCase();
  const any = (arr: string[]) => arr.some((h) => s.includes(h));
  if (any(['大一点', '大一些', '大点', '放大', '更大', '字大', '再大点', '再大一点', 'bigger', 'larger'])) return 1.18;
  if (any(['小一点', '小一些', '小点', '缩小', '更小', '字小', '再小点', '再小一点', 'smaller'])) return 0.85;
  return 1;
}

/** Approx base font-size (vw) per node role — for turning a size nudge into a concrete vw. */
export function roleBaseFontVw(tag: string): number {
  switch ((tag || '').toLowerCase()) {
    case 'h1': return 3.5;
    case 'h2': return 2.5;
    case 'li': return 2.3;
    case 'p': return 2.1;
    default: return 2.1;
  }
}

/** Merge validated style props into an existing inline-style string (add wins). */
export function mergeInlineStyle(current: string, add: Record<string, string>): string {
  const obj: Record<string, string> = {};
  for (const decl of (current ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) {
      const k = decl.slice(0, i).trim().toLowerCase();
      const v = decl.slice(i + 1).trim();
      if (k && v) obj[k] = v;
    }
  }
  for (const [k, v] of Object.entries(add)) obj[k] = v;
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(';');
}

/**
 * Deck-wide *semantic* unification: given every editable text node (id + current
 * text) and a global instruction like「整册术语和语气统一得更专业些」, ask GLM which
 * nodes to rewrite for consistency and return an id→newText map (only the nodes it
 * chose to change). Each node keeps its role (a heading stays a heading). Lenient
 * JSON parse; unknown ids are dropped. Throws only if the proxy call itself fails.
 */
export async function llmUnifyDeckText(
  nodes: { nodeId: string; text: string }[],
  instruction: string,
): Promise<Record<string, string>> {
  if (!nodes.length) return {};
  const list = nodes.map((n) => `- ${n.nodeId}: ${n.text}`).join('\n');
  const valid = new Set(nodes.map((n) => n.nodeId));

  const parse = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      if (s === -1 || e <= s) return out;
      const parsed = JSON.parse(raw.slice(s, e + 1));
      const edits = Array.isArray(parsed?.edits) ? parsed.edits : [];
      for (const ed of edits) {
        const id = String(ed?.id ?? '');
        const text = stripToLine(String(ed?.text ?? ''));
        // only keep real changes to known nodes (a rewrite equal to the original is a no-op)
        if (valid.has(id) && text && text !== nodes.find((n) => n.nodeId === id)?.text) out[id] = text;
      }
    } catch {
      /* graceful: malformed JSON → no edits */
    }
    return out;
  };

  const ask = async (forceful: boolean): Promise<string> => {
    const system = [
      '你是 AutoOffice 的中文演示文稿主编。用户对"整册"提出统一性意见（统一术语 / 统一语气 / 统一表述风格 / 更专业等）。',
      '下面给你整册所有可编辑文字节点（id + 原文）。请据意见对需要提升一致性 / 专业度的节点给出改写。',
      forceful
        ? '**务必给出改写**：即使原文尚可，也要在术语、句式、语气上做一致性与专业度润色；至少改写多处（能改进的都改），严禁返回空的 edits；每条 text 必须与原文不同。'
        : '尽量提升整册一致性与专业度；确实无需改动的节点可省略，但不要因"已经不错"而整体不改。',
      '只输出 JSON：{"edits":[{"id":"节点id","text":"改写后的该节点文字"}]}。不要解释、不要 Markdown、不要多余字段。',
      '每条 text 为纯文本单行、与原文同语言，保持该节点原有角色与含义（标题仍是标题、要点仍是要点）。',
    ].join('');
    const user = `整册文字节点：\n${list}\n\n统一性意见：${instruction}\n\n输出 JSON：`;
    return chatCompletion(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: forceful ? 0.6 : 0.4, maxTokens: 2000 },
    );
  };

  let out = parse(await ask(false));
  // Vague intents ("统一一下") sometimes get "already consistent, no change". One
  // forceful retry makes the whole-deck pass reliably produce edits.
  if (Object.keys(out).length === 0) out = parse(await ask(true));
  return out;
}

/** Ask GLM for a single accent color (hex) + short label for an illustration swap. */
export async function llmPickImageColor(
  instruction: string,
  currentLabel = '示意图',
): Promise<{ hex: string; label: string }> {
  const system =
    '你在为幻灯片挑一张"色卡占位图"的主色。只返回 JSON：{"hex":"#RRGGBB","label":"不超过6字的中文短标题"}，不要多余文字。';
  const user = `当前图标题：${currentLabel}\n用户意见：${instruction}\n给出配色 JSON：`;
  const raw = await chatCompletion(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.5, maxTokens: 120 },
  );
  const hex = /#([0-9a-fA-F]{6})/.exec(raw)?.[0] ?? '#3a63e8';
  const label = /"label"\s*:\s*"([^"]{1,12})"/.exec(raw)?.[1]?.trim() || currentLabel;
  return { hex: hex.toLowerCase(), label };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * amt);
  const g = clamp(((n >> 8) & 255) * amt);
  const b = clamp((n & 255) * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** A self-contained SVG "color card" as a data URI — the placeholder illustration. */
export function colorCardDataUri(hex = '#3a63e8', label = '架构示意'): string {
  const dark = shade(hex, 0.62);
  const light = shade(hex, 1.25);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>` +
    `<rect width="960" height="420" rx="28" fill="url(#g)"/>` +
    `<circle cx="230" cy="150" r="70" fill="#ffffff" opacity="0.16"/>` +
    `<circle cx="760" cy="300" r="120" fill="#ffffff" opacity="0.10"/>` +
    `<text x="60" y="360" font-family="PingFang SC, sans-serif" font-size="56" font-weight="700" fill="#ffffff" opacity="0.95">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}
