/**
 * Parse Slidev slides.md into semantic nodes (same contract as html/dom.parseDeck).
 */
import type { SemanticNode } from '../types.js';
import { buildSlidevSourceMap, semanticNodesFromMap } from './sourcemap.js';
import { SLIDES_MD } from './generate.js';

export interface ParsedSlidevDeck {
  nodes: SemanticNode[];
  md: string;
}

export function parseSlidevDeck(md: string, file = SLIDES_MD): ParsedSlidevDeck {
  const map = buildSlidevSourceMap(md, file);
  const nodes = semanticNodesFromMap(map, md);
  return { nodes, md };
}

export function listSlidevNodeIds(md: string): string[] {
  return buildSlidevSourceMap(md).entries.map((e) => e.aoId);
}
