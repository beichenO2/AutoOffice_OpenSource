import { describe, it, expect } from 'vitest';
import {
  screenRectToNorm,
  normToScreenRect,
  displayedSize,
  iou,
  containment,
  intersectionArea,
} from '../../src/engine/coords.js';
import type { Viewport } from '../../src/engine/types.js';

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

describe('coords — normalization round trip', () => {
  const viewports: Viewport[] = [
    { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 800, pageHeightPx: 600 },
    { zoom: 1.5, rotation: 0, dpr: 2, pageWidthPx: 800, pageHeightPx: 600 },
    { zoom: 2, rotation: 90, dpr: 1, pageWidthPx: 800, pageHeightPx: 600 },
    { zoom: 0.75, rotation: 180, dpr: 3, pageWidthPx: 1024, pageHeightPx: 768 },
    { zoom: 1.25, rotation: 270, dpr: 2, pageWidthPx: 640, pageHeightPx: 960 },
  ];

  it('recovers the original screen rect after norm→screen for all viewports', () => {
    for (const v of viewports) {
      const { w: dispW, h: dispH } = displayedSize(v);
      const sel = { x: dispW * 0.1, y: dispH * 0.2, w: dispW * 0.3, h: dispH * 0.25 };
      const norm = screenRectToNorm(sel, v);
      const back = normToScreenRect(norm, v);
      expect(close(back.x, sel.x, 1e-4)).toBe(true);
      expect(close(back.y, sel.y, 1e-4)).toBe(true);
      expect(close(back.w, sel.w, 1e-4)).toBe(true);
      expect(close(back.h, sel.h, 1e-4)).toBe(true);
    }
  });

  it('produces zoom-independent normalized coords', () => {
    const base: Viewport = { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 800, pageHeightPx: 600 };
    const zoomed: Viewport = { ...base, zoom: 2.5, dpr: 2 };
    const selBase = { x: 80, y: 60, w: 160, h: 120 };
    const selZoomed = { x: 80 * 2.5, y: 60 * 2.5, w: 160 * 2.5, h: 120 * 2.5 };
    const a = screenRectToNorm(selBase, base);
    const b = screenRectToNorm(selZoomed, zoomed);
    expect(close(a.x, b.x, 1e-9)).toBe(true);
    expect(close(a.y, b.y, 1e-9)).toBe(true);
    expect(close(a.w, b.w, 1e-9)).toBe(true);
    expect(close(a.h, b.h, 1e-9)).toBe(true);
    // top-left 10% selection → normalized ~ (0.1, 0.1)
    expect(close(a.x, 0.1, 1e-9)).toBe(true);
    expect(close(a.y, 0.1, 1e-9)).toBe(true);
  });

  it('maps a top-left display selection under 90° rotation into page space', () => {
    const v: Viewport = { zoom: 1, rotation: 90, dpr: 1, pageWidthPx: 800, pageHeightPx: 600 };
    // displayed size is 600x800; a small box at displayed top-left
    const sel = { x: 0, y: 0, w: 60, h: 80 };
    const norm = screenRectToNorm(sel, v);
    // Under 90° CW, display top-left corresponds to page bottom-left region.
    expect(norm.x >= 0 && norm.x <= 1).toBe(true);
    expect(norm.y >= 0 && norm.y <= 1).toBe(true);
    expect(norm.w).toBeGreaterThan(0);
    expect(norm.h).toBeGreaterThan(0);
  });
});

describe('coords — geometry helpers', () => {
  it('computes intersection, iou, containment', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const b = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    expect(close(intersectionArea(a, b), 0.0625)).toBe(true);
    // union = 0.25 + 0.25 - 0.0625 = 0.4375
    expect(close(iou(a, b), 0.0625 / 0.4375)).toBe(true);
    const inner = { x: 0.3, y: 0.3, w: 0.1, h: 0.1 };
    expect(close(containment(inner, a), 1)).toBe(true);
  });

  it('returns zero for disjoint rects', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 };
    const b = { x: 0.8, y: 0.8, w: 0.2, h: 0.2 };
    expect(intersectionArea(a, b)).toBe(0);
    expect(iou(a, b)).toBe(0);
  });
});
