/**
 * draw.io XML Reviewer for the scientific-figure track.
 *
 * Fail-closed on this slice:
 *   - illegal XML / missing <mxfile> → `invalid-xml` hard
 *   - image cell covering ~the locked page → `whole-sketch-raster` hard
 *   - large non-full-page image cell → `possible-composite-raster` or
 *     `large-raster-surface` hard
 *
 * Image cells are detected from mxCell style (`shape=image` or `image=data`)
 * or from HTML `value` (`<img` / `data:image`). Never by a reserved id such
 * as `sketch-bg`. `ok` is true iff hardCount === 0.
 *
 * Connector / overflow / outside-page categories live on the type SSoT for
 * later units; this module does not invent those checks.
 */
import { JSDOM } from 'jsdom';
import {
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  type FigureAuditCategory,
  type FigureAuditFinding,
  type FigureAuditResult,
} from './types.js';

/** Vendor `large_raster_area_ratio` default; this slice treats the hit as hard. */
export const LARGE_RASTER_AREA_RATIO = 0.08;

/** Area floor for a non-full-page composite paste (~1200×800). */
export const COMPOSITE_RASTER_MIN_AREA = 1200 * 800;

/** Relative slack when comparing a cell to the page size (“约 1600×900”). */
export const WHOLE_PAGE_SIZE_RATIO = 0.02;

/** Absolute origin slack (px) for “x/y = 0”. */
export const ORIGIN_EPS_PX = 1;

const COMPOSITE_HINT =
  /(composite|grid|montage|panel|comparison|stack|matrix|multi[- ]?image|multiple images|rows? of|columns? of)/i;

const IMAGE_STYLE = /shape=image|image=data/i;
const IMAGE_IN_VALUE = /<img\b|data:image/i;

const { DOMParser } = new JSDOM('<root/>', { contentType: 'text/xml' }).window;

interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PageBox {
  w: number;
  h: number;
}

interface MxCellRecord {
  id: string;
  parentId: string;
  style: string;
  value: string;
  local: CellBox | null;
}

function toResult(findings: FigureAuditFinding[]): FigureAuditResult {
  const hardCount = findings.filter((finding) => finding.severity === 'hard').length;
  return { ok: hardCount === 0, hardCount, findings };
}

function hardFinding(
  category: FigureAuditCategory,
  message: string,
  objectIds?: string[],
): FigureAuditFinding {
  return {
    category,
    severity: 'hard',
    message,
    ...(objectIds && objectIds.length > 0 ? { objectIds } : {}),
  };
}

function invalidXml(message: string): FigureAuditResult {
  return toResult([hardFinding('invalid-xml', message)]);
}

function parseXmlDocument(xml: string): { document: Document } | { error: string } {
  if (typeof xml !== 'string' || xml.trim() === '') {
    return { error: 'XML is empty or not a string' };
  }
  let document: Document;
  try {
    document = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `XML parser threw: ${detail}` };
  }
  const parseError = document.getElementsByTagName('parsererror')[0];
  if (parseError) {
    const detail = (parseError.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { error: detail || 'XML is not well-formed' };
  }
  return { document };
}

function firstMxfile(document: Document): Element | undefined {
  return elementList(document.getElementsByTagName('mxfile'))[0];
}

function elementList(nodes: HTMLCollectionOf<Element>): Element[] {
  return Array.from(nodes);
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function finiteNumber(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readPageBox(model: Element): PageBox {
  return {
    w: finiteNumber(attr(model, 'pageWidth'), FIGURE_PAGE_WIDTH),
    h: finiteNumber(attr(model, 'pageHeight'), FIGURE_PAGE_HEIGHT),
  };
}

function readLocalGeometry(cell: Element): CellBox | null {
  const geometry = elementList(cell.getElementsByTagName('mxGeometry'))[0];
  if (!geometry) return null;
  const w = finiteNumber(attr(geometry, 'width'), 0);
  const h = finiteNumber(attr(geometry, 'height'), 0);
  if (w <= 0 || h <= 0) return null;
  return {
    x: finiteNumber(attr(geometry, 'x'), 0),
    y: finiteNumber(attr(geometry, 'y'), 0),
    w,
    h,
  };
}

function collectCells(model: Element): MxCellRecord[] {
  return elementList(model.getElementsByTagName('mxCell')).map((cell) => ({
    id: attr(cell, 'id'),
    parentId: attr(cell, 'parent'),
    style: attr(cell, 'style'),
    value: attr(cell, 'value'),
    local: readLocalGeometry(cell),
  }));
}

function absoluteBox(cell: MxCellRecord, byId: Map<string, MxCellRecord>): CellBox | null {
  if (!cell.local) return null;
  let x = cell.local.x;
  let y = cell.local.y;
  const seen = new Set<string>();
  let parentId = cell.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.local) {
      x += parent.local.x;
      y += parent.local.y;
    }
    parentId = parent.parentId;
  }
  return { x, y, w: cell.local.w, h: cell.local.h };
}

function isImageCell(cell: MxCellRecord): boolean {
  return IMAGE_STYLE.test(cell.style) || IMAGE_IN_VALUE.test(cell.value);
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function isWholePageRaster(box: CellBox, page: PageBox): boolean {
  const sizeTolW = Math.max(page.w * WHOLE_PAGE_SIZE_RATIO, 8);
  const sizeTolH = Math.max(page.h * WHOLE_PAGE_SIZE_RATIO, 8);
  if (near(box.w, page.w, sizeTolW) && near(box.h, page.h, sizeTolH)) {
    return true;
  }
  const atOrigin = near(box.x, 0, ORIGIN_EPS_PX) && near(box.y, 0, ORIGIN_EPS_PX);
  const closeToPage =
    box.w >= page.w * (1 - WHOLE_PAGE_SIZE_RATIO * 2.5) &&
    box.h >= page.h * (1 - WHOLE_PAGE_SIZE_RATIO * 2.5);
  return atOrigin && closeToPage;
}

function isLargeRaster(box: CellBox, pageArea: number): boolean {
  const area = box.w * box.h;
  return area >= COMPOSITE_RASTER_MIN_AREA || area > pageArea * LARGE_RASTER_AREA_RATIO;
}

function largeRasterCategory(cell: MxCellRecord): FigureAuditCategory {
  const haystack = [cell.id, cell.value, cell.style].join(' ');
  return COMPOSITE_HINT.test(haystack) ? 'possible-composite-raster' : 'large-raster-surface';
}

function fmtBox(box: CellBox): string {
  const n = (value: number) => Math.round(value * 100) / 100;
  return `[${n(box.x)}, ${n(box.y)}, ${n(box.w)}×${n(box.h)}]`;
}

function auditImageCell(cell: MxCellRecord, box: CellBox, page: PageBox): FigureAuditFinding | undefined {
  const pageArea = Math.max(1, page.w * page.h);
  const objectIds = cell.id ? [cell.id] : undefined;
  if (isWholePageRaster(box, page)) {
    return hardFinding(
      'whole-sketch-raster',
      `Image cell ${cell.id || '(unnamed)'} covers the page ${fmtBox(box)} on ${page.w}×${page.h}; a whole-sketch paste is a hard fail.`,
      objectIds,
    );
  }
  if (isLargeRaster(box, pageArea)) {
    const area = box.w * box.h;
    const pct = Math.round((area / pageArea) * 1000) / 10;
    const category = largeRasterCategory(cell);
    return hardFinding(
      category,
      `Image cell ${cell.id || '(unnamed)'} occupies ${fmtBox(box)} (${pct}% of the ${page.w}×${page.h} page); large rasters must be split or rebuilt as native cells.`,
      objectIds,
    );
  }
  return undefined;
}

function auditMxfile(mxfile: Element): FigureAuditFinding[] {
  const findings: FigureAuditFinding[] = [];
  const models = elementList(mxfile.getElementsByTagName('mxGraphModel'));
  const scopes = models.length > 0 ? models : [mxfile];
  for (const scope of scopes) {
    const page = readPageBox(scope);
    const cells = collectCells(scope);
    const byId = new Map(cells.filter((cell) => cell.id).map((cell) => [cell.id, cell]));
    for (const cell of cells) {
      if (!isImageCell(cell)) continue;
      const box = absoluteBox(cell, byId);
      if (!box) continue;
      const finding = auditImageCell(cell, box, page);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

/**
 * Reviewer-only audit of a draw.io document. Does not draw or mutate XML.
 */
export function auditDrawioXml(xml: string): FigureAuditResult {
  const parsed = parseXmlDocument(xml);
  if ('error' in parsed) {
    return invalidXml(`Illegal draw.io XML: ${parsed.error}`);
  }
  const mxfile = firstMxfile(parsed.document);
  if (!mxfile) {
    return invalidXml('Document is well-formed XML but has no <mxfile> root; not a draw.io figure.');
  }
  return toResult(auditMxfile(mxfile));
}
