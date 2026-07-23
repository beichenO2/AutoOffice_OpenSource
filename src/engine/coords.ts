/**
 * Coordinate normalization between a viewer's displayed pixels and a page's
 * intrinsic, rotation-independent normalized space ([0,1], top-left origin).
 *
 * Invariants:
 *  - Normalized coords are stored in PAGE space (rotation=0), so they survive
 *    zoom / rotation / DPR / window-size changes.
 *  - Rotation is a clockwise multiple of 90° applied to the page for display.
 *  - Working in CSS px throughout means DPR cancels; we still accept dpr so a
 *    caller may pass device px if it also scales pageWidth/Height by dpr.
 */
import type { NormRect, Viewport } from './types.js';

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rotation = 0 | 90 | 180 | 270;

function normRotation(r: number): Rotation {
  const m = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return m as Rotation;
}

/** Displayed page size (CSS px) given intrinsic size + zoom + rotation. */
export function displayedSize(v: Viewport): { w: number; h: number } {
  const z = v.zoom || 1;
  const rot = normRotation(v.rotation);
  const w = v.pageWidthPx * z;
  const h = v.pageHeightPx * z;
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Map a point in display-normalized space back to page-normalized space. */
function displayToPagePoint(dx: number, dy: number, rot: Rotation): { x: number; y: number } {
  switch (rot) {
    case 0:
      return { x: dx, y: dy };
    case 90:
      return { x: dy, y: 1 - dx };
    case 180:
      return { x: 1 - dx, y: 1 - dy };
    case 270:
      return { x: 1 - dy, y: dx };
  }
}

/** Map a point in page-normalized space to display-normalized space. */
function pageToDisplayPoint(nx: number, ny: number, rot: Rotation): { x: number; y: number } {
  switch (rot) {
    case 0:
      return { x: nx, y: ny };
    case 90:
      return { x: 1 - ny, y: nx };
    case 180:
      return { x: 1 - nx, y: 1 - ny };
    case 270:
      return { x: ny, y: 1 - nx };
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function bbox(
  points: Array<{ x: number; y: number }>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Convert a selection rect measured in the displayed page element (CSS px,
 * origin at the element's top-left) into a page-space NormRect.
 */
export function screenRectToNorm(sel: PixelRect, v: Viewport): NormRect {
  const rot = normRotation(v.rotation);
  const { w: dispW, h: dispH } = displayedSize(v);
  if (dispW <= 0 || dispH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const corners = [
    { x: sel.x / dispW, y: sel.y / dispH },
    { x: (sel.x + sel.w) / dispW, y: sel.y / dispH },
    { x: sel.x / dispW, y: (sel.y + sel.h) / dispH },
    { x: (sel.x + sel.w) / dispW, y: (sel.y + sel.h) / dispH },
  ].map((c) => displayToPagePoint(c.x, c.y, rot));
  const b = bbox(corners);
  return {
    x: clamp01(b.x),
    y: clamp01(b.y),
    w: clamp01(b.w),
    h: clamp01(b.h),
  };
}

/** Inverse of {@link screenRectToNorm}: page-space NormRect → displayed px. */
export function normToScreenRect(n: NormRect, v: Viewport): PixelRect {
  const rot = normRotation(v.rotation);
  const { w: dispW, h: dispH } = displayedSize(v);
  const corners = [
    { x: n.x, y: n.y },
    { x: n.x + n.w, y: n.y },
    { x: n.x, y: n.y + n.h },
    { x: n.x + n.w, y: n.y + n.h },
  ].map((c) => pageToDisplayPoint(c.x, c.y, rot));
  const b = bbox(corners);
  return { x: b.x * dispW, y: b.y * dispH, w: b.w * dispW, h: b.h * dispH };
}

/** Convert a page-space NormRect to absolute page units (e.g. PDF points). */
export function normToPageUnits(
  n: NormRect,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: n.x * pageWidth,
    y: n.y * pageHeight,
    w: n.w * pageWidth,
    h: n.h * pageHeight,
  };
}

/** Center point of a NormRect. */
export function rectCenter(n: NormRect): { x: number; y: number } {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

export function rectArea(n: NormRect): number {
  return Math.max(0, n.w) * Math.max(0, n.h);
}

/** Intersection area of two NormRects. */
export function intersectionArea(a: NormRect, b: NormRect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const w = right - x;
  const h = bottom - y;
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Intersection-over-union of two NormRects (0..1). Used for stability of
 * re-anchoring annotations across revisions.
 */
export function iou(a: NormRect, b: NormRect): number {
  const inter = intersectionArea(a, b);
  const union = rectArea(a) + rectArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Fraction of `inner` covered by `outer` (0..1). */
export function containment(inner: NormRect, outer: NormRect): number {
  const a = rectArea(inner);
  return a <= 0 ? 0 : intersectionArea(inner, outer) / a;
}
