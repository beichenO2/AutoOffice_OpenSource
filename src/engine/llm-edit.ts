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
    { capability: '1000', temperature: 0.4, maxTokens: 600 },
  );
  const out = stripToLine(raw);
  if (!out) throw new Error('LLM returned empty rewrite');
  return out;
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
      { capability: '1000', temperature: forceful ? 0.6 : 0.4, maxTokens: 2000 },
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
    { capability: '1000', temperature: 0.5, maxTokens: 120 },
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
