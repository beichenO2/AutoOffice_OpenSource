/**
 * Apply EditIntent to Slidev source (`slides.md` HTML fragments).
 * Patches source files only — never dist/.vite build output.
 */
import { JSDOM } from 'jsdom';
import type { EditIntent, SourceFile } from '../types.js';
import { ScopeViolationError, type CollateralReport, type EditResult } from '../html/edit.js';
import { outerHtmlMap, locateElementRange } from '../html/dom.js';
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
    if (op.op !== 'replaceText') {
      throw new ScopeViolationError(`Slidev edit op not supported: ${op.op}`);
    }
    md = replaceTextInMarkdown(md, op.nodeId, String(op.payload.text ?? ''), SLIDES_MD);
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
