/**
 * SyncTeX reverse lookup via the `synctex` CLI (when available).
 */
import { spawnSync } from 'node:child_process';
import type { NormRect, ResolvedCandidate, SourceMap } from '../types.js';
import { normToPageUnits, rectCenter } from '../coords.js';
import { parseLatexNodes } from './latex-project.js';

export interface SynctexHit {
  file: string;
  line: number;
  column: number;
}

export function synctexReverse(
  pdfPath: string,
  page: number,
  xPt: number,
  yPt: number,
): SynctexHit | null {
  const bin = spawnSync('which', ['synctex'], { encoding: 'utf-8' }).stdout?.trim() || 'synctex';
  const spec = `${page}:${xPt}:${yPt}:${pdfPath}`;
  const { status, stdout, stderr } = spawnSync(bin, ['edit', '-o', spec], { encoding: 'utf-8' });
  if (status !== 0) return null;
  const text = stdout + stderr;
  const inputMatch = /Input:([^\n]+)/.exec(text);
  const lineMatch = /Line:(\d+)/.exec(text);
  if (!inputMatch || !lineMatch) return null;
  return {
    file: inputMatch[1]!.trim(),
    line: Number.parseInt(lineMatch[1]!, 10),
    column: 0,
  };
}

/** Rank LaTeX semantic nodes against a page-space selection. */
export function resolvePdfTargets(
  tex: string,
  sourceMap: SourceMap,
  page: number,
  rectNorm: NormRect,
  pageWidthPt = 595,
  pageHeightPt = 842,
): ResolvedCandidate[] {
  void page;
  const center = rectCenter(rectNorm);
  const pt = normToPageUnits({ x: center.x, y: center.y, w: 0, h: 0 }, pageWidthPt, pageHeightPt);
  const lineHint = Math.max(1, Math.round(pt.y / 12));

  const nodes = sourceMap.nodes.length ? sourceMap.nodes : parseLatexNodes(tex);
  const scored = nodes.map((n) => {
    const startLine = tex.slice(0, n.range.start).split('\n').length;
    const dist = Math.abs(startLine - lineHint);
    const containsTable = n.type === 'table' && /table|表格/.test(n.excerpt ?? '');
    let score = 1 / (1 + dist);
    if (containsTable) score += 0.2;
    if (n.id.includes('table')) score += 0.3;
    return {
      nodeId: n.id,
      type: n.type,
      range: n.range,
      score: Number(score.toFixed(4)),
      reason: dist <= 3 ? 'structure marker near selection' : 'nearest semantic node by line proximity',
    } satisfies ResolvedCandidate;
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}
