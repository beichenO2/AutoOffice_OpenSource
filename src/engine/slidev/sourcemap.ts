/**
 * SlidevSourceMap — maps stable `data-ao-id` handles to slide index + source range.
 */
import type { SemanticNode, SemanticNodeType, SourceBox, SourceRange } from '../types.js';
import { locateElementRange } from '../html/dom.js';
import { SLIDES_MD, splitSlidevPages } from './generate.js';

export interface SlidevSourceMapEntry {
  aoId: string;
  slideIndex: number;
  sourcePath: string;
  sourceRange: SourceRange;
  semanticType: SemanticNodeType;
  bbox?: Pick<SourceBox, 'x' | 'y' | 'w' | 'h'>;
}

export interface SlidevSourceMap {
  revisionFile: string;
  entries: SlidevSourceMapEntry[];
  /** True when no ao-id markers were found (annotation should return mapping_unavailable). */
  empty: boolean;
}

function mapType(raw: string | null | undefined): SemanticNodeType {
  switch (raw) {
    case 'slide':
      return 'slide';
    case 'heading':
    case 'subheading':
      return 'heading';
    case 'paragraph':
    case 'note':
      return 'paragraph';
    case 'list':
      return 'list';
    case 'bullet':
      return 'listitem';
    case 'image':
      return 'image';
    default:
      return 'element';
  }
}

/** 1-based slide index containing `aoId` (ignores YAML frontmatter). */
export function slideIndexForAoId(md: string, aoId: string): number {
  const pages = splitSlidevPages(md);
  const needle = `data-ao-id="${aoId}"`;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.includes(needle)) return i + 1;
  }
  return 1;
}

/** @deprecated use slideIndexForAoId — kept for callers using char offsets */
export function slideIndexAtOffset(md: string, offset: number): number {
  const pages = splitSlidevPages(md);
  let cursor = 0;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const start = md.indexOf(page, cursor);
    const end = start + page.length;
    if (offset >= start && offset <= end) return i + 1;
    cursor = end;
  }
  return 1;
}

/** Parse all `data-ao-id` nodes from slides.md into a SlidevSourceMap. */
export function buildSlidevSourceMap(md: string, file = SLIDES_MD): SlidevSourceMap {
  const entries: SlidevSourceMapEntry[] = [];
  const re = /data-ao-id="([^"]+)"[^>]*data-ao-type="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const aoId = m[1]!;
    const semanticType = mapType(m[2]);
    const range = locateElementRange(md, aoId, file);
    if (!range) continue;
    entries.push({
      aoId,
      slideIndex: slideIndexForAoId(md, aoId),
      sourcePath: file,
      sourceRange: range,
      semanticType,
    });
  }
  return { revisionFile: file, entries, empty: entries.length === 0 };
}

/** Convert SlidevSourceMap entries to engine SemanticNode list. */
export function semanticNodesFromMap(map: SlidevSourceMap, md: string): SemanticNode[] {
  return map.entries.map((e) => {
    const excerptStart = e.sourceRange.start;
    const excerpt = md.slice(excerptStart, Math.min(md.length, excerptStart + 200)).replace(/\s+/g, ' ').trim();
    return {
      id: e.aoId,
      type: e.semanticType,
      range: e.sourceRange,
      page: e.slideIndex,
      excerpt: excerpt.slice(0, 160),
      selector: `[data-ao-id="${e.aoId}"]`,
      meta: { engine: 'slidev', sourcePath: e.sourcePath },
    };
  });
}

/** Lookup a single ao-id; returns undefined when map is missing or id unknown. */
export function lookupSlidevNode(
  map: SlidevSourceMap | null | undefined,
  aoId: string,
): SlidevSourceMapEntry | undefined {
  if (!map || map.empty) return undefined;
  return map.entries.find((e) => e.aoId === aoId);
}
