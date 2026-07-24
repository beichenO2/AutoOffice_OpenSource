/**
 * SyncTeX CLI wrapper + LaTeX semantic node map from `\aoNode{id}{…}` markers.
 */
import { spawnSync } from 'node:child_process';
import type { NormRect, ResolvedCandidate, SemanticNode, SourceMap } from '../types.js';
import { normToPageUnits, rectCenter } from '../coords.js';
import type { IdFactory } from '../ids.js';

/** A4 in pt (approximate for synctex point queries). */
export const A4_PT = { w: 595.28, h: 841.89 };

export interface SynctexHit {
  file: string;
  line: number;
  column: number;
}

export function synctexEdit(
  pdfPath: string,
  page: number,
  xPt: number,
  yPt: number,
): SynctexHit | null {
  const spec = `${page}:${xPt}:${yPt}:${pdfPath}`;
  const { status, stdout, stderr } = spawnSync('synctex', ['edit', '-o', spec], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  if (status !== 0) return null;
  const text = stdout + stderr;
  const file = /Input:([^\n]+)/.exec(text)?.[1]?.trim();
  const line = Number(/Line:(\d+)/.exec(text)?.[1]);
  const column = Number(/Column:(-?\d+)/.exec(text)?.[1] ?? -1);
  if (!file || !Number.isFinite(line)) return null;
  return { file, line, column };
}

/** Build semantic nodes by scanning `\aoNode{id}{` openings and matching braces. */
export function parseLatexNodes(tex: string, file = 'main.tex'): SemanticNode[] {
  const lines = tex.split('\n');
  const nodes: SemanticNode[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const re = /\\aoNode\{([^}]+)\}\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const id = m[1]!;
      const start = offset + m.index;
      const contentStart = offset + m.index + m[0].length;
      const end = findMatchingBrace(tex, contentStart - 1);
      const excerpt = tex.slice(contentStart, end).replace(/\s+/g, ' ').slice(0, 120);
      nodes.push({
        id,
        type: id.startsWith('table') ? 'table' : id.startsWith('para') ? 'paragraph' : 'section',
        range: { file, start, end: end + 1 },
        page: estimatePage(i, lines.length),
        excerpt,
      });
    }
    offset += line.length + 1;
  }
  return nodes;
}

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return openIdx;
}

function estimatePage(lineIdx: number, totalLines: number): number {
  return Math.min(2, 1 + Math.floor((lineIdx / Math.max(totalLines, 1)) * 1.5));
}

export function buildSourceMap(
  revisionId: string,
  tex: string,
  idFactory: IdFactory,
): SourceMap {
  return {
    id: idFactory('map'),
    revisionId,
    nodes: parseLatexNodes(tex),
  };
}

export function resolvePdfTargets(
  rectNorm: NormRect,
  page: number,
  pdfPath: string,
  tex: string,
  nodes: SemanticNode[],
  file = 'main.tex',
): ResolvedCandidate[] {
  const center = rectCenter(rectNorm);
  const ptBox = { x: center.x, y: center.y, w: 0.001, h: 0.001 };
  const pt = normToPageUnits(ptBox, A4_PT.w, A4_PT.h);
  const hit = synctexEdit(pdfPath, page, pt.x, A4_PT.h - pt.y);
  const candidates: ResolvedCandidate[] = [];

  if (hit) {
    const basename = hit.file.split('/').pop() ?? hit.file;
    for (const node of nodes) {
      if (!node.range.file.endsWith(basename) && node.range.file !== file) continue;
      const lineStart = charOffsetToLine(tex, node.range.start);
      const lineEnd = charOffsetToLine(tex, node.range.end);
      if (hit.line >= lineStart && hit.line <= lineEnd) {
        candidates.push({
          nodeId: node.id,
          type: node.type,
          range: node.range,
          score: 0.92,
          reason: `SyncTeX line ${hit.line} inside node range`,
        });
      }
    }
  }

  for (const node of nodes) {
    if (node.page === page && !candidates.some((c) => c.nodeId === node.id)) {
      candidates.push({
        nodeId: node.id,
        type: node.type,
        range: node.range,
        score: 0.35,
        reason: 'same-page semantic node fallback',
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

function charOffsetToLine(tex: string, offset: number): number {
  return tex.slice(0, offset).split('\n').length;
}
