/**
 * HTML source ↔ semantic-node mapping. Elements are addressed by stable
 * `data-ao-id`. We compute real character ranges in the source string (honest
 * "resolve to source range", not screenshot-guessing) and read structure via
 * jsdom.
 */
import { JSDOM } from 'jsdom';
import type { SemanticNode, SemanticNodeType, SourceRange } from '../types.js';

const SELF_CLOSING = new Set(['img', 'br', 'hr', 'input', 'meta', 'link']);

/** Find the [start,end) character range of the element carrying `gid`. */
export function locateElementRange(html: string, gid: string, file = 'deck.html'): SourceRange | null {
  const needle = `data-ao-id="${gid}"`;
  const attrIdx = html.indexOf(needle);
  if (attrIdx === -1) return null;
  const tagStart = html.lastIndexOf('<', attrIdx);
  if (tagStart === -1) return null;
  const nameMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(tagStart, attrIdx + needle.length + 200));
  const tagName = nameMatch ? nameMatch[1]!.toLowerCase() : '';
  const openEnd = html.indexOf('>', attrIdx);
  if (openEnd === -1) return null;
  const selfClosed = html[openEnd - 1] === '/' || SELF_CLOSING.has(tagName);
  if (selfClosed) {
    return { file, start: tagStart, end: openEnd + 1 };
  }
  const closeIdx = matchCloseTag(html, tagName, openEnd + 1);
  if (closeIdx === -1) return { file, start: tagStart, end: openEnd + 1 };
  return { file, start: tagStart, end: closeIdx };
}

/** Index just past the matching `</tag>` for an already-open `tag`. */
function matchCloseTag(html: string, tagName: string, from: number): number {
  const openRe = new RegExp(`<${tagName}(\\s|>|/)`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let cursor = from;
  while (cursor < html.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function mapType(raw: string | null | undefined): SemanticNodeType {
  switch (raw) {
    case 'slide':
      return 'slide';
    case 'heading':
      return 'heading';
    case 'subheading':
      return 'heading';
    case 'paragraph':
      return 'paragraph';
    case 'list':
      return 'list';
    case 'listitem':
      return 'listitem';
    case 'image':
      return 'image';
    case 'note':
      return 'paragraph';
    default:
      return 'element';
  }
}

export interface ParsedDeck {
  dom: JSDOM;
  nodes: SemanticNode[];
}

/** Parse a deck and produce its semantic-node list (document order). */
export function parseDeck(html: string, file = 'deck.html'): ParsedDeck {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const els = Array.from(doc.querySelectorAll('[data-ao-id]'));
  const nodes: SemanticNode[] = [];
  for (const el of els) {
    const gid = el.getAttribute('data-ao-id');
    if (!gid) continue;
    const type = mapType(el.getAttribute('data-ao-type'));
    const slide = el.closest('[data-ao-type="slide"]');
    const pageAttr = slide?.getAttribute('data-ao-page');
    const page = pageAttr ? Number(pageAttr) : undefined;
    const parentEl = el.parentElement?.closest('[data-ao-id]') ?? null;
    const parentId = parentEl?.getAttribute('data-ao-id') ?? undefined;
    const range = locateElementRange(html, gid, file);
    nodes.push({
      id: gid,
      type,
      range: range ?? { file, start: 0, end: 0 },
      page,
      parentId,
      excerpt: (el.textContent ?? '').trim().slice(0, 160),
      selector: `[data-ao-id="${gid}"]`,
    });
  }
  return { dom, nodes };
}

/** All data-ao-id values in a document, in order. */
export function listNodeIds(html: string): string[] {
  const out: string[] = [];
  const re = /data-ao-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]!);
  return out;
}

/** Map of nodeId → outerHTML (for collateral-change verification). */
export function outerHtmlMap(html: string): Map<string, string> {
  const dom = new JSDOM(html);
  const map = new Map<string, string>();
  for (const el of Array.from(dom.window.document.querySelectorAll('[data-ao-id]'))) {
    const gid = el.getAttribute('data-ao-id');
    if (gid) map.set(gid, el.outerHTML);
  }
  return map;
}
