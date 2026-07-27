/**
 * AOIDE · selection geometry.
 *
 * Deliberately a mirror of `src/engine/html/hit-test.ts` + `coords.ts`: the
 * client ranks locally so the user sees "你框住的是 …" while still dragging,
 * and the server re-ranks the same way when the annotation is submitted. Same
 * formula on both sides, so the preview never disagrees with the result.
 */

export function rectArea(r) { return Math.max(0, r.w) * Math.max(0, r.h); }

export function intersectionArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export function iou(a, b) {
  const inter = intersectionArea(a, b);
  const union = rectArea(a) + rectArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** How much of `inner` lies inside `outer` (0..1). */
export function containment(inner, outer) {
  const area = rectArea(inner);
  return area <= 0 ? 0 : intersectionArea(inner, outer) / area;
}

/** Two screen points → a normalized rect inside `surface` (a DOMRect). */
export function pointsToNormRect(surface, ax, ay, bx, by) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const nx = clamp((x0 - surface.left) / surface.width);
  const ny = clamp((y0 - surface.top) / surface.height);
  return {
    x: nx,
    y: ny,
    w: clamp((x1 - surface.left) / surface.width) - nx,
    h: clamp((y1 - surface.top) / surface.height) - ny,
  };
}

/** Normalized rect → CSS pixels inside `surface`. */
export function normToStyle(surface, rect) {
  return {
    left: `${rect.x * surface.width}px`,
    top: `${rect.y * surface.height}px`,
    width: `${rect.w * surface.width}px`,
    height: `${rect.h * surface.height}px`,
  };
}

/**
 * Rank boxes on `page` against a selection. Mirrors `rankByRect` in
 * `src/engine/html/hit-test.ts` — containment first, IoU second, ties broken
 * toward the smaller (more specific) element.
 */
export function rankByRect(selection, boxes, page, { minScore = 0.05, limit = 5 } = {}) {
  return boxes
    .filter((b) => b.page === page)
    .map((b) => {
      const rect = { x: b.x, y: b.y, w: b.w, h: b.h };
      const cover = containment(rect, selection);
      const overlap = iou(rect, selection);
      return { box: b, rect, score: 0.65 * cover + 0.35 * overlap, cover, overlap };
    })
    .filter((s) => s.score >= minScore)
    .sort((a, b) => (Math.abs(b.score - a.score) > 1e-6 ? b.score - a.score : rectArea(a.rect) - rectArea(b.rect)))
    .slice(0, limit)
    .map((s) => ({
      nodeId: s.box.nodeId,
      label: s.box.label || s.box.nodeId,
      rect: s.rect,
      score: Number(s.score.toFixed(4)),
    }));
}
