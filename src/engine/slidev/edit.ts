/**
 * Apply EditIntent to Slidev source (`slides.md` HTML fragments).
 * Patches source files only — never dist/.vite build output.
 */
import { JSDOM } from 'jsdom';
import type { EditIntent, SourceFile } from '../types.js';
import { ScopeViolationError, type CollateralReport, type EditResult } from '../html/edit.js';
import { outerHtmlMap, locateElementRange } from '../html/dom.js';
import { escapeHtml } from '../html/generate.js';
import { SLIDES_MD } from './generate.js';

function cssEscape(id: string): string {
  return id.replace(/["\\]/g, '\\$&');
}

/** Same ancestor/descendant allowance as html/edit.applyEditIntent. */
function collectAffected(doc: Document, targetIds: string[]): Set<string> {
  const affected = new Set<string>(targetIds);
  for (const tid of targetIds) {
    const el = doc.querySelector(`[data-ao-id="${cssEscape(tid)}"]`);
    if (!el) continue;
    for (const d of Array.from(el.querySelectorAll('[data-ao-id]'))) {
      const id = d.getAttribute('data-ao-id');
      if (id) affected.add(id);
    }
    let p: Element | null = el.parentElement ? el.parentElement.closest('[data-ao-id]') : null;
    while (p) {
      const id = p.getAttribute('data-ao-id');
      if (id) affected.add(id);
      p = p.parentElement ? p.parentElement.closest('[data-ao-id]') : null;
    }
  }
  return affected;
}

function wrapMd(md: string): string {
  return `<body>${md}</body>`;
}

function replaceTextInMarkdown(md: string, nodeId: string, newText: string, file: string): string {
  const range = locateElementRange(md, nodeId, file);
  if (!range) throw new ScopeViolationError(`Target node not found: ${nodeId}`);
  const fragment = md.slice(range.start, range.end);
  const dom = new JSDOM(`<body>${fragment}</body>`);
  const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
  if (!el) throw new ScopeViolationError(`Target node not found: ${nodeId}`);
  el.textContent = newText;
  const updated = el.outerHTML;
  return md.slice(0, range.start) + updated + md.slice(range.end);
}

/** Set attributes on a node in place (used for editable images: setAttr src=...). */
function setAttrInMarkdown(md: string, nodeId: string, attrs: Record<string, unknown>, file: string): string {
  const range = locateElementRange(md, nodeId, file);
  if (!range) throw new ScopeViolationError(`Target node not found: ${nodeId}`);
  const fragment = md.slice(range.start, range.end);
  const dom = new JSDOM(`<body>${fragment}</body>`);
  const el = dom.window.document.querySelector(`[data-ao-id="${cssEscape(nodeId)}"]`);
  if (!el) throw new ScopeViolationError(`Target node not found: ${nodeId}`);
  for (const [k, v] of Object.entries(attrs)) {
    if (/^data-ao-id$/i.test(k)) continue; // never let an edit rewrite the stable id
    el.setAttribute(k, String(v));
  }
  return md.slice(0, range.start) + el.outerHTML + md.slice(range.end);
}

/**
 * Insert a new image element into a slide — append to the slide, or place it
 * right after an anchor node when one is given. Pure surgical string splice: it
 * never re-serializes the whole Markdown, so Slidev frontmatter and the `---`
 * slide separators stay byte-for-byte intact.
 */
export function insertImageIntoSlideMarkdown(
  md: string,
  opts: { slideId: string; afterNodeId?: string; imgHtml: string; file?: string },
): string {
  const file = opts.file ?? SLIDES_MD;
  if (opts.afterNodeId) {
    const range = locateElementRange(md, opts.afterNodeId, file);
    if (range) return `${md.slice(0, range.end)}\n${opts.imgHtml}${md.slice(range.end)}`;
  }
  const slideRange = locateElementRange(md, opts.slideId, file);
  if (!slideRange) throw new ScopeViolationError(`Slide not found: ${opts.slideId}`);
  const closeIdx = md.lastIndexOf('</div>', slideRange.end);
  if (closeIdx < slideRange.start) throw new ScopeViolationError(`Slide close not found: ${opts.slideId}`);
  return `${md.slice(0, closeIdx)}${opts.imgHtml}\n${md.slice(closeIdx)}`;
}

function normalizeAccent(hex: string): string {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec((hex ?? '').trim());
  if (!m) return '#3a63e8';
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toLowerCase()}`;
}

/**
 * Set / replace the deck-wide theme accent in the slides.md YAML frontmatter
 * (`aoAccent:`). The preview reads this and overrides `--ao-accent`, so titles,
 * bullets, the frame-title tick, the callout and the cover all shift together.
 * Surgical: only the frontmatter block is touched.
 */
export function setDeckAccentInFrontmatter(md: string, hex: string): string {
  const safe = normalizeAccent(hex);
  if (!md.startsWith('---')) return `---\naoAccent: ${JSON.stringify(safe)}\n---\n\n${md}`;
  const closeIdx = md.indexOf('\n---', 3);
  if (closeIdx === -1) return md;
  const front = md.slice(0, closeIdx);
  const rest = md.slice(closeIdx);
  if (/^aoAccent:\s*.*$/m.test(front)) {
    return front.replace(/^aoAccent:\s*.*$/m, `aoAccent: ${JSON.stringify(safe)}`) + rest;
  }
  return `${front}\naoAccent: ${JSON.stringify(safe)}${rest}`;
}

/**
 * Recolor every color-card placeholder illustration (`data:image/svg+xml` src)
 * in the deck via a caller-provided factory, preserving each image's own label.
 * Real photos / external URLs are left untouched. Returns the changed node ids.
 */
export function recolorColorCardImages(
  md: string,
  srcFor: (opts: { nodeId: string; label: string }) => string,
): { md: string; changed: string[] } {
  const changed: string[] = [];
  const out = md.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (!/^data:image\/svg\+xml/i.test(src)) return tag;
    const nodeId = /\sdata-ao-id="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const label = /\salt="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const nextSrc = srcFor({ nodeId, label }).replace(/"/g, '&quot;');
    changed.push(nodeId);
    return tag.replace(/\ssrc="[^"]*"/i, ` src="${nextSrc}"`);
  });
  return { md: out, changed };
}

/**
 * Deck-wide term unification (the #4 "understands PPT" skill for text): replace
 * every plain-text occurrence of `from` with `to` across the whole deck, leaving
 * YAML frontmatter, every tag and every attribute (crucially `data-ao-id`)
 * byte-for-byte intact. Slidev body text is HTML-escaped by the generator, so we
 * escape the search / replacement terms to match, and only touch text runs that
 * sit *between* tags — never inside `<...>`. Deterministic, no LLM. Returns the
 * patched Markdown and how many occurrences were replaced.
 *
 * With `syncAltLabels`, the term is additionally unified inside `<img alt="…">`
 * caption text (kept consistent with the visible copy) — but still never in
 * `data-ao-id`, `src` or any other attribute.
 */
export function deckTextReplace(
  md: string,
  from: string,
  to: string,
  opts: { syncAltLabels?: boolean } = {},
): { md: string; count: number } {
  const rawFrom = (from ?? '').trim();
  if (!rawFrom) return { md, count: 0 };
  const needle = escapeHtml(rawFrom);
  const repl = escapeHtml((to ?? '').trim());
  if (!needle || needle === repl) return { md, count: 0 };

  // Keep YAML frontmatter (title / theme / aoAccent …) untouched.
  let front = '';
  let body = md;
  if (md.startsWith('---')) {
    const closeIdx = md.indexOf('\n---', 3);
    if (closeIdx !== -1) {
      const eol = md.indexOf('\n', closeIdx + 1);
      const splitAt = eol === -1 ? md.length : eol + 1;
      front = md.slice(0, splitAt);
      body = md.slice(splitAt);
    }
  }

  let count = 0;
  let out = '';
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    const end = lt === -1 ? body.length : lt;
    const seg = body.slice(i, end); // text run between tags — safe to replace
    const parts = seg.split(needle);
    count += parts.length - 1;
    out += parts.join(repl);
    if (lt === -1) break;
    const gt = body.indexOf('>', lt);
    if (gt === -1) {
      out += body.slice(lt); // malformed tail — leave verbatim
      break;
    }
    let tag = body.slice(lt, gt + 1); // copy the tag verbatim (attrs incl. data-ao-id)
    if (opts.syncAltLabels && /^<img\b/i.test(tag)) {
      // Only the alt caption is unified — data-ao-id / src / class stay untouched.
      tag = tag.replace(/(\salt=")([^"]*)(")/i, (_full, pre: string, val: string, post: string) => {
        const parts = val.split(needle);
        count += parts.length - 1;
        return pre + parts.join(repl) + post;
      });
    }
    out += tag;
    i = gt + 1;
  }
  return { md: front + out, count };
}

/**
 * Collect every editable *text* node (heading / subheading / paragraph / bullet)
 * across the deck with its current visible text — used to drive a deck-wide LLM
 * semantic unification. Images and structural containers (slide div / list ul)
 * are excluded (leaf text elements only).
 */
export function collectDeckTextNodes(md: string): { nodeId: string; text: string }[] {
  const dom = new JSDOM(`<body>${md}</body>`);
  const out: { nodeId: string; text: string }[] = [];
  const seen = new Set<string>();
  const sel = 'h1[data-ao-id],h2[data-ao-id],h3[data-ao-id],h4[data-ao-id],p[data-ao-id],li[data-ao-id]';
  for (const el of Array.from(dom.window.document.querySelectorAll(sel))) {
    const id = el.getAttribute('data-ao-id');
    if (!id || seen.has(id)) continue;
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    seen.add(id);
    out.push({ nodeId: id, text });
  }
  return out;
}

/** Patch slides.md (and optional component files) from a validated EditIntent. */
export function applySlidevEditIntent(source: SourceFile[], intent: EditIntent): EditResult & { source: SourceFile[] } {
  const allowed = new Set(intent.allowedNodeIds);
  for (const op of intent.operations) {
    if (!allowed.has(op.nodeId)) {
      throw new ScopeViolationError(
        `Op on ${op.nodeId} is outside allowedNodeIds [${intent.allowedNodeIds.join(', ')}]`,
      );
    }
  }

  const mdIdx = source.findIndex((f) => f.path === SLIDES_MD);
  if (mdIdx === -1) throw new ScopeViolationError('slides.md missing from revision source');

  const beforeMd = source[mdIdx]!.content;
  const targetIds = Array.from(new Set(intent.operations.map((o) => o.nodeId)));
  const beforeMap = outerHtmlMap(wrapMd(beforeMd));
  const affected = collectAffected(new JSDOM(wrapMd(beforeMd)).window.document, targetIds);

  let md = beforeMd;
  const changed = new Set<string>();
  for (const op of intent.operations) {
    if (op.op === 'replaceText') {
      md = replaceTextInMarkdown(md, op.nodeId, String(op.payload.text ?? ''), SLIDES_MD);
    } else if (op.op === 'setAttr') {
      md = setAttrInMarkdown(md, op.nodeId, (op.payload.attrs as Record<string, unknown>) ?? {}, SLIDES_MD);
    } else {
      throw new ScopeViolationError(`Slidev edit op not supported: ${op.op}`);
    }
    changed.add(op.nodeId);
  }

  const afterMap = outerHtmlMap(wrapMd(md));
  const unexpectedChanged: string[] = [];
  const unexpectedRemoved: string[] = [];
  for (const [id, before] of beforeMap) {
    if (affected.has(id)) continue;
    const after = afterMap.get(id);
    if (after === undefined) unexpectedRemoved.push(id);
    else if (after !== before) unexpectedChanged.push(id);
  }
  const unexpectedAdded: string[] = [];
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id) && !affected.has(id)) unexpectedAdded.push(id);
  }

  const collateral: CollateralReport = {
    ok: unexpectedChanged.length === 0 && unexpectedRemoved.length === 0 && unexpectedAdded.length === 0,
    unexpectedChanged,
    unexpectedRemoved,
    unexpectedAdded,
  };

  const nextSource = source.map((f, i) => (i === mdIdx ? { ...f, content: md } : { ...f }));

  return {
    source: nextSource,
    html: md,
    changedNodeIds: Array.from(changed),
    patchSummary: intent.operations.map((o) => `${o.op}(${o.nodeId})`).join(', '),
    collateral,
  };
}
