/**
 * Text-layout audit — Reviewer geometry checks on DocumentFacts / box maps.
 *
 * Ported from scientific-illustrator Reviewer categories that can run on
 * measured boxes (not MCP, not Playwright fit-ladder):
 *   - outside-page     (hard)  box leaves the normalized slide [0,1]
 *   - text-overflow    (hard)  contentBoxNorm exceeds cell, or scrollOverflow
 *   - text-overlap     (hard)  AABB intersection of text boxes on one page
 *   - insufficient-margin (warning) edge clearance < 2% of the slide
 *   - repeated-series-misalignment (hard)   *-N / *_N series, n≥3, cross-axis
 *   - repeated-series-unequal-spacing (warning) gap spread > 2× alignment tol
 *
 * Prefer measured `boxNorm` / `contentBoxNorm` / `scrollOverflow` over
 * char-count. Elements without a box are skipped (never invented as overflow
 * from textLength).
 */
import type { DocumentElementBox, DocumentElementFact, DocumentFacts } from './types.js';

const BOX_EPSILON = 0.001;
/** Reviewer-style slide-edge gutter: 2% of the normalized page. */
export const DEFAULT_MIN_EDGE_MARGIN_NORM = 0.02;
/** Slide-space port of vendor `alignment_tolerance` (1px on a figure). */
export const DEFAULT_ALIGNMENT_TOLERANCE_NORM = 0.01;

const SERIES_SUFFIX = /[-_]\d+$/;

const TEXT_LIKE_TYPES = new Set([
  'text',
  'heading',
  'paragraph',
  'list',
  'listitem',
  'formula',
  'caption',
  'bullet',
]);

export type TextLayoutFindingCategory =
  | 'outside-page'
  | 'text-overflow'
  | 'insufficient-margin'
  | 'text-overlap'
  | 'repeated-series-misalignment'
  | 'repeated-series-unequal-spacing';

export type TextLayoutSeverity = 'hard' | 'warning';

export interface TextLayoutFinding {
  category: TextLayoutFindingCategory;
  severity: TextLayoutSeverity;
  nodeIds: string[];
  page: number;
  message: string;
}

export interface TextLayoutAuditResult {
  ok: boolean;
  findings: TextLayoutFinding[];
}

export interface TextLayoutAuditOptions {
  minEdgeMarginNorm?: number;
  overflowToleranceNorm?: number;
  alignmentToleranceNorm?: number;
}

type BoxedElement = DocumentElementFact & { boxNorm: DocumentElementBox };

function isFiniteBox(box: DocumentElementBox | undefined): box is DocumentElementBox {
  if (box === undefined) return false;
  return [box.x, box.y, box.w, box.h].every((n) => typeof n === 'number' && Number.isFinite(n));
}

function hasTextEvidence(element: DocumentElementFact): boolean {
  return (
    isFiniteBox(element.contentBoxNorm) ||
    element.scrollOverflow === true ||
    (typeof element.textLength === 'number' && element.textLength > 0)
  );
}

function isTextLike(element: DocumentElementFact): boolean {
  if (TEXT_LIKE_TYPES.has(element.type)) return true;
  return element.type === 'element' && hasTextEvidence(element);
}

function outsidePage(box: DocumentElementBox, eps: number): boolean {
  return box.x < -eps || box.y < -eps || box.x + box.w > 1 + eps || box.y + box.h > 1 + eps;
}

function edgeClearance(box: DocumentElementBox): number {
  return Math.min(box.x, box.y, 1 - (box.x + box.w), 1 - (box.y + box.h));
}

function contentExceedsCell(content: DocumentElementBox, cell: DocumentElementBox, tol: number): boolean {
  return (
    content.x < cell.x - tol ||
    content.y < cell.y - tol ||
    content.x + content.w > cell.x + cell.w + tol ||
    content.y + content.h > cell.y + cell.h + tol
  );
}

/** Positive-area AABB intersection; edge-touching (zero area) is not overlap. */
function aabbOverlaps(a: DocumentElementBox, b: DocumentElementBox, eps: number): boolean {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

function aabbContains(outer: DocumentElementBox, inner: DocumentElementBox, eps: number): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

function parentMapOf(elements: DocumentElementFact[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const element of elements) {
    if (element.parentId) map.set(element.nodeId, element.parentId);
  }
  return map;
}

function isAncestorOf(ancestorId: string, nodeId: string, parentOf: Map<string, string>): boolean {
  const seen = new Set<string>();
  let current: string | undefined = parentOf.get(nodeId);
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}

function isAncestorDescendantPair(a: string, b: string, parentOf: Map<string, string>): boolean {
  return isAncestorOf(a, b, parentOf) || isAncestorOf(b, a, parentOf);
}

function isNestedPair(a: BoxedElement, b: BoxedElement, parentOf: Map<string, string>, eps: number): boolean {
  if (isAncestorDescendantPair(a.nodeId, b.nodeId, parentOf)) return true;
  return aabbContains(a.boxNorm, b.boxNorm, eps) || aabbContains(b.boxNorm, a.boxNorm, eps);
}

function fmtBox(box: DocumentElementBox): string {
  return `(${box.x}, ${box.y}, ${box.w}, ${box.h})`;
}

function fmtNorm(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function seriesStem(nodeId: string): string | undefined {
  if (!SERIES_SUFFIX.test(nodeId)) return undefined;
  return nodeId.replace(SERIES_SUFFIX, '-*');
}

function auditRepeatedSeries(boxed: BoxedElement[], alignmentTol: number): TextLayoutFinding[] {
  const groups = new Map<string, BoxedElement[]>();
  for (const element of boxed) {
    const stem = seriesStem(element.nodeId);
    if (stem === undefined) continue;
    const key = `${element.page}\0${stem}`;
    const list = groups.get(key) ?? [];
    list.push(element);
    groups.set(key, list);
  }

  const findings: TextLayoutFinding[] = [];
  for (const [groupKey, group] of groups) {
    if (group.length < 3) continue;
    const items = group.filter((el) => isFiniteBox(el.boxNorm) && el.boxNorm.w > 0 && el.boxNorm.h > 0);
    if (items.length < 3) continue;
    const page = items[0]!.page;
    const stem = groupKey.slice(groupKey.indexOf('\0') + 1);
    const boxes = items.map((el) => el.boxNorm);
    const centersX = boxes.map((box) => box.x + box.w / 2);
    const centersY = boxes.map((box) => box.y + box.h / 2);
    const rangeX = Math.max(...centersX) - Math.min(...centersX);
    const rangeY = Math.max(...centersY) - Math.min(...centersY);
    const verticalSeries = rangeY >= rangeX;
    const crossValues = boxes.map((box) => (verticalSeries ? box.x : box.y));
    const crossSpread = Math.max(...crossValues) - Math.min(...crossValues);
    if (crossSpread > alignmentTol) {
      findings.push({
        category: 'repeated-series-misalignment',
        severity: 'hard',
        nodeIds: items.map((el) => el.nodeId),
        page,
        message: `第 ${page} 页重复系列（${stem}）交叉轴错位 ${fmtNorm(crossSpread)}，超过对齐容差 ${fmtNorm(alignmentTol)}`,
      });
    }
    const ordered = [...items].sort((a, b) =>
      verticalSeries ? a.boxNorm.y - b.boxNorm.y : a.boxNorm.x - b.boxNorm.x,
    );
    const gaps: number[] = [];
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!.boxNorm;
      const current = ordered[index]!.boxNorm;
      gaps.push(verticalSeries ? current.y - (previous.y + previous.h) : current.x - (previous.x + previous.w));
    }
    if (gaps.length >= 2) {
      const spread = Math.max(...gaps) - Math.min(...gaps);
      if (spread > 2 * alignmentTol) {
        findings.push({
          category: 'repeated-series-unequal-spacing',
          severity: 'warning',
          nodeIds: ordered.map((el) => el.nodeId),
          page,
          message: `第 ${page} 页重复系列（${stem}）间距差 ${fmtNorm(spread)}，超过 2× 对齐容差`,
        });
      }
    }
  }
  return findings;
}

/**
 * Audit measured text/layout boxes on DocumentFacts.
 * `ok` is true iff there are no hard findings (warnings do not fail the gate).
 */
export function auditTextLayout(facts: DocumentFacts, options?: TextLayoutAuditOptions): TextLayoutAuditResult {
  const minMargin = options?.minEdgeMarginNorm ?? DEFAULT_MIN_EDGE_MARGIN_NORM;
  const tol = options?.overflowToleranceNorm ?? BOX_EPSILON;
  const alignmentTol = options?.alignmentToleranceNorm ?? DEFAULT_ALIGNMENT_TOLERANCE_NORM;
  const findings: TextLayoutFinding[] = [];
  const boxed: BoxedElement[] = (facts.elements ?? []).filter(
    (el): el is BoxedElement => isFiniteBox(el.boxNorm) && el.boxNorm.w > 0 && el.boxNorm.h > 0,
  );

  for (const element of boxed) {
    const box = element.boxNorm;
    if (outsidePage(box, tol)) {
      findings.push({
        category: 'outside-page',
        severity: 'hard',
        nodeIds: [element.nodeId],
        page: element.page,
        message: `第 ${element.page} 页文本框（${element.nodeId}）越出画布：box=${fmtBox(box)}，要求完整落在 [0,1] 范围内`,
      });
    } else {
      const clearance = edgeClearance(box);
      if (clearance < minMargin - tol) {
        const pct = Math.round(minMargin * 100);
        findings.push({
          category: 'insufficient-margin',
          severity: 'warning',
          nodeIds: [element.nodeId],
          page: element.page,
          message: `第 ${element.page} 页文本框（${element.nodeId}）距画布边缘仅 ${(clearance * 100).toFixed(1)}%，低于 ${pct}% 下限`,
        });
      }
    }

    const content = isFiniteBox(element.contentBoxNorm) ? element.contentBoxNorm : undefined;
    const overflowed = element.scrollOverflow === true || (content !== undefined && contentExceedsCell(content, box, tol));
    if (overflowed) {
      findings.push({
        category: 'text-overflow',
        severity: 'hard',
        nodeIds: [element.nodeId],
        page: element.page,
        message:
          element.scrollOverflow === true
            ? `第 ${element.page} 页文本框（${element.nodeId}）实测滚动溢出单元格：scrollOverflow=true cell=${fmtBox(box)}`
            : `第 ${element.page} 页文本框（${element.nodeId}）实测文本越出单元格：content=${fmtBox(content!)} cell=${fmtBox(box)}`,
      });
    }
  }

  const parentOf = parentMapOf(facts.elements ?? []);
  const byPage = new Map<number, BoxedElement[]>();
  for (const element of boxed) {
    if (!isTextLike(element)) continue;
    const list = byPage.get(element.page) ?? [];
    list.push(element);
    byPage.set(element.page, list);
  }
  for (const [page, items] of byPage) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        if (isNestedPair(a, b, parentOf, BOX_EPSILON)) continue;
        if (!aabbOverlaps(a.boxNorm, b.boxNorm, BOX_EPSILON)) continue;
        findings.push({
          category: 'text-overlap',
          severity: 'hard',
          nodeIds: [a.nodeId, b.nodeId],
          page,
          message: `第 ${page} 页文本框重叠：${a.nodeId} ${fmtBox(a.boxNorm)} 与 ${b.nodeId} ${fmtBox(b.boxNorm)}`,
        });
      }
    }
  }

  findings.push(...auditRepeatedSeries(boxed, alignmentTol));

  return {
    ok: findings.every((f) => f.severity !== 'hard'),
    findings,
  };
}
