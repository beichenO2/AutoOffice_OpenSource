/**
 * Deterministic, human-readable Chinese labels for semantic nodes.
 *
 * The point of the box-select loop is that the user must be able to see *what
 * the system thinks they circled* before anything is applied. A label is that
 * surface. It is derived only from the node's type, page and text — never from
 * a screenshot and never from a model call — so it is stable, cheap, and
 * assertable in tests.
 */
import type { SemanticNode, SemanticNodeType } from './types.js';

const TYPE_LABEL: Record<SemanticNodeType, string> = {
  document: '文档',
  slide: '整页幻灯片',
  section: '章节标题',
  heading: '标题',
  paragraph: '正文段落',
  list: '列表',
  listitem: '列表项',
  table: '表格',
  image: '图片',
  formula: '公式',
  element: '元素',
  text: '文本',
};

/** Longest excerpt kept inside a label before it gets elided. */
const EXCERPT_MAX = 18;

export function typeLabel(type: SemanticNodeType): string {
  return TYPE_LABEL[type] ?? '元素';
}

/**
 * Strip TeX control sequences so a LaTeX excerpt reads as prose.
 * Without this a table label shows `\begin{tabular}{|l…` instead of its cells.
 */
function stripTex(s: string): string {
  return s
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, ' ')
    .replace(/\\hline/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[&{}$]/g, ' ');
}

/** Collapse whitespace and clip, so a label never wraps a whole paragraph. */
export function shortExcerpt(raw: string | undefined, max = EXCERPT_MAX): string {
  const source = raw ?? '';
  const text = (source.includes('\\') ? stripTex(source) : source).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export interface LabelOptions {
  /** 'pdf' says "第 N 页", 'presentation' says "第 N 页幻灯片". */
  kind?: 'pdf' | 'presentation';
  /** Omit the page prefix (e.g. the caller already groups by page). */
  omitPage?: boolean;
}

/**
 * Render a node as e.g. `第 2 页 · 正文段落「本报告根据您的需求…」`.
 * Falls back gracefully when page or excerpt are unknown.
 */
export function describeNode(node: SemanticNode, opts: LabelOptions = {}): string {
  const parts: string[] = [];
  if (!opts.omitPage && typeof node.page === 'number' && node.page > 0) {
    parts.push(opts.kind === 'presentation' ? `第 ${node.page} 页幻灯片` : `第 ${node.page} 页`);
  }
  const excerpt = shortExcerpt(node.excerpt);
  parts.push(excerpt ? `${typeLabel(node.type)}「${excerpt}」` : typeLabel(node.type));
  return parts.join(' · ');
}

/**
 * Phrase a resolved hit the way the product speaks to the user:
 * `你框住的是 第 2 页 · 正文段落「…」`.
 */
export function describeSelection(node: SemanticNode, opts: LabelOptions = {}): string {
  return `你框住的是 ${describeNode(node, opts)}`;
}
