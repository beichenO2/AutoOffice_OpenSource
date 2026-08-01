/**
 * PPT editing "skills" — the bit of presentation know-how that lets a single
 * box-selected instruction generalize correctly.
 *
 * A deck is a *themed system*, not a bag of independent elements: recoloring one
 * illustration or asking for a "warmer palette" should restyle the whole deck
 * consistently, whereas rewording one sentence must stay local. This module is
 * the deterministic classifier that decides that scope (LLM does the actual
 * color/text generation elsewhere), so it is offline-safe and fully unit-tested.
 */

export type EditAxis = 'color' | 'text' | 'image';
export type EditScope = 'deck' | 'local';

export interface EditScopePlan {
  /** 'deck' → restyle the whole presentation; 'local' → only the framed node. */
  scope: EditScope;
  /** What kind of change the instruction is asking for. */
  axis: EditAxis;
  /** Short human-readable rationale (surfaced in events / UI copy). */
  reason: string;
  /**
   * For a deck-wide term unification (axis='text', scope='deck'): the parsed
   * A→B pair to replace across every slide, deterministically. Absent for a
   * free-form single rewrite (which stays local).
   */
  textReplace?: { from: string; to: string };
}

// Color / palette / theme vocabulary (zh + en). A color-axis instruction on ANY
// element is treated as a theme-level change by default (the user's choice).
const COLOR_HINTS = [
  '颜色', '配色', '色调', '色系', '色彩', '换色', '改色', '底色', '背景色', '主色', '主题色',
  '暖色', '冷色', '亮色', '暗色', '深色', '浅色', '渐变', '色卡',
  'palette', 'colour', 'color', 'recolor', 'recolour', 'hue', 'tone', 'tint', 'gradient', 'warm', 'cool',
];

// Whole-deck vocabulary — strengthens deck scope for non-color axes too.
const GLOBAL_HINTS = [
  '整体', '整册', '整个', '全册', '全篇', '通篇', '全部', '所有', '每页', '每一页', '统一', '一致', '风格', '主题',
  'whole', 'entire', 'all ', 'every', 'consistent', 'throughout', 'deck-wide', 'globally', 'unify', 'theme',
];

// Explicit "only this one" overrides — force local even for a color instruction.
const LOCAL_ONLY_HINTS = [
  '只改这', '只改此', '仅此', '仅改', '只这', '就这一', '只有这', '这一处', '单独这', '仅这一',
  'only this', 'just this', 'this one', 'this slide only', 'only here',
];

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Verbs expressing a rename / term replacement (zh). Longer forms are listed
// first so the alternation prefers「统一改成」over「改成」.
const REPLACE_VERB =
  '(?:统一改成|统一改为|统一换成|统一叫做|统一叫成|替换成|替换为|改成|改为|换成|改叫|叫成|叫做|称为|命名为)';

function stripTermQuotes(s: string): string {
  return (s ?? '')
    .trim()
    .replace(/^[「『“"'‘]+/, '')
    .replace(/[」』”"'’]+$/, '')
    .replace(/^的/, '')
    .trim();
}

/**
 * Parse a deterministic term-unification instruction into an A→B pair, e.g.
 * 「把全部『AI』统一改成『人工智能』」→ { from:'AI', to:'人工智能' }, or
 * "replace all AI with artificial intelligence". Returns null when the
 * instruction isn't a clear rename — a free-form rewrite stays local.
 */
export function parseDeckTextReplace(instruction: string): { from: string; to: string } | null {
  const raw = (instruction ?? '').trim();
  if (!raw) return null;

  // English: replace/change/rename/swap [all|every] X with/to/into Y
  const en =
    /\b(?:replace|change|rename|swap)\s+(?:all\s+|every\s+)?["'“”「」]?(.+?)["'“”「」]?\s+(?:with|to|into|for)\s+["'“”「」]?(.+?)["'“”「」]?\s*[.!]?$/i.exec(
      raw,
    );
  if (en) {
    const from = stripTermQuotes(en[1]!);
    const to = stripTermQuotes(en[2]!);
    if (from && to && from !== to && from.length <= 24 && to.length <= 24) return { from, to };
  }

  // Chinese: strip any leading scope / politeness qualifiers (把/将/所有/全部/
  // 整册… in any order), then split the remainder on the first rename verb into
  // A <verb> B. Stripping first avoids「整册把 X…」leaking 把 into the term.
  const stripped = raw
    .replace(/^(?:请|帮我|帮忙|麻烦)\s*/, '')
    .replace(/^(?:把|将|所有的?|全部的?|全册的?|整册的?|通篇的?|每一处的?|每页的?|这些|它们)+\s*/, '')
    .trim();
  const re = new RegExp(
    `^(.+?)\\s*(?:统一|全部|都|一律|通通)?\\s*${REPLACE_VERB}\\s*(.+?)\\s*[。.！!，,]?$`,
  );
  const m = re.exec(stripped);
  if (!m) return null;
  const from = stripTermQuotes(m[1]!);
  const to = stripTermQuotes(m[2]!);
  // A term swap uses short terms; a long capture is really a sentence rewrite.
  if (!from || !to || from === to || from.length > 24 || to.length > 24) return null;
  return { from, to };
}

/**
 * Decide how far a box-selected instruction should reach.
 *
 * - color/palette/theme intent → deck-wide recolor (unless "only this")
 * - explicit "only this" → local, regardless of axis
 * - everything else (wording, single image swap) → local
 */
export function classifyEditScope(
  instruction: string,
  opts: { isImage?: boolean } = {},
): EditScopePlan {
  const s = (instruction ?? '').toLowerCase();
  const forceLocal = hasAny(s, LOCAL_ONLY_HINTS);
  const hasColor = hasAny(s, COLOR_HINTS);
  const hasGlobal = hasAny(s, GLOBAL_HINTS);

  const axis: EditAxis = hasColor ? 'color' : opts.isImage ? 'image' : 'text';

  if (forceLocal) {
    return { scope: 'local', axis, reason: '用户明确只改选中的这一处' };
  }
  if (axis === 'color') {
    return {
      scope: 'deck',
      axis,
      reason: hasGlobal
        ? '配色 + 整体意图 → 统一整册主题色与所有插图'
        : '配色类改动懂 PPT：主题色应整册一致 → 统一整册',
    };
  }
  // Text with a whole-deck intent generalizes (the #4 skill for the text axis):
  //   • a parseable A→B ("统一把 A 改成 B") → deterministic deck-wide rename
  //   • otherwise ("整册语气统一得更专业些") → deck-wide LLM *semantic* unify
  // A free-form instruction WITHOUT a global word stays local on the framed node.
  if (axis === 'text' && hasGlobal) {
    const pair = parseDeckTextReplace(instruction ?? '');
    if (pair) {
      return {
        scope: 'deck',
        axis,
        reason: `术语统一（懂 PPT）：整册把「${pair.from}」改为「${pair.to}」`,
        textReplace: pair,
      };
    }
    return {
      scope: 'deck',
      axis,
      reason: '整册语义统一（懂 PPT）：按意见对全册多处文字做一致改写',
    };
  }
  return {
    scope: 'local',
    axis,
    reason: axis === 'image' ? '单张插图的非配色改动 → 仅改此图' : '文字改动 → 仅改选中处',
  };
}
