/**
 * Geometric hit-testing for framed selections over a rendered deck. Element
 * bounding boxes (normalized page space) are measured by the client/Playwright
 * and passed in; we rank which source element the user most likely framed.
 *
 * Direct DOM hits (client already knows the clicked element id) skip this and
 * go straight to that node; this path serves free-draw / background / grouped
 * selections per the acceptance contract.
 */
import type { NormRect, ResolvedCandidate, SemanticNodeType } from '../types.js';
import { containment, iou, rectArea } from '../coords.js';

export interface ElementBox {
  nodeId: string;
  type: SemanticNodeType;
  page: number;
  rect: NormRect;
}

export interface RankOptions {
  /** Minimum score to be considered a candidate at all. */
  minScore?: number;
  /** Max candidates returned. */
  limit?: number;
}

/**
 * Rank element boxes on `page` against a normalized selection rect. Score
 * favors elements the selection covers (containment) and that align with it
 * (IoU), tie-broken toward smaller/more-specific elements.
 */
export function rankByRect(
  selection: NormRect,
  boxes: ElementBox[],
  page: number,
  opts: RankOptions = {},
): ResolvedCandidate[] {
  const minScore = opts.minScore ?? 0.05;
  const limit = opts.limit ?? 5;
  const scored = boxes
    .filter((b) => b.page === page)
    .map((b) => {
      const cover = containment(b.rect, selection); // how much of element is inside selection
      const overlap = iou(b.rect, selection);
      const score = 0.65 * cover + 0.35 * overlap;
      return { box: b, score, cover, overlap };
    })
    .filter((s) => s.score >= minScore)
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-6) return b.score - a.score;
      // tie-break: smaller element wins (more specific)
      return rectArea(a.box.rect) - rectArea(b.box.rect);
    });

  return scored.slice(0, limit).map((s) => ({
    nodeId: s.box.nodeId,
    type: s.box.type,
    range: { file: '', start: 0, end: 0 },
    score: Number(s.score.toFixed(4)),
    reason:
      s.cover >= 0.9
        ? 'element fully inside selection'
        : s.overlap >= 0.5
          ? 'strong overlap with selection'
          : 'partial overlap with selection',
  }));
}

/**
 * Decide whether a ranked result is confident enough for a direct local edit
 * or must be surfaced as a multi-candidate proposal.
 */
export function isHighConfidence(candidates: ResolvedCandidate[]): boolean {
  if (candidates.length === 0) return false;
  const top = candidates[0]!;
  if (top.score < 0.6) return false;
  if (candidates.length === 1) return true;
  const second = candidates[1]!;
  return top.score - second.score >= 0.2;
}
