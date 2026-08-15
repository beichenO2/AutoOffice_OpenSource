/**
 * Unified render→source box map.
 *
 * Both media produce the *same* artefact: a list of `SourceBox` (normalized
 * 0..1, top-left origin) tied to a stable semantic node id, with a
 * human-readable label. Once that exists, box-select is one geometric
 * hit-test (`html/hit-test.rankByRect`) for PDF and HTML alike — no VLM, no
 * screenshot round-trip, no per-medium resolver.
 *
 * HTML  : real browser layout via `measureDeckBoxes` (Playwright).
 * LaTeX : SyncTeX *forward* lookup (`synctex view -i line:col:file`) run at
 *         compile time, while the `.synctex` file still exists next to the PDF.
 *         The resulting map is persisted with the revision, so annotation-time
 *         resolution never depends on build artefacts surviving.
 */
import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import type { NormRect, SemanticNode, SourceBox, SourceFile } from './types.js';
import { describeNode } from './labels.js';
import { parseDeck } from './html/dom.js';
import { measureDeckBoxes, type MeasuredDeckBox } from './render/deck.js';
import { previewHtmlFromSource, SLIDES_MD } from './slidev/generate.js';

/** A4 in PDF points — the paper `renderLatexDocument` emits (`a4paper`). */
export const PAGE_A4_PT = { w: 595.276, h: 841.89 };

/** Bound the number of `synctex` spawns so a pathological source can't hang a build. */
const MAX_LINES_PER_NODE = 60;
const MAX_SYNCTEX_QUERIES = 600;
const SYNCTEX_TIMEOUT_MS = 10_000;

/** One box as reported by `synctex view`, in PDF points from the page's top-left. */
export interface SynctexBox {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Parse `synctex view` stdout into boxes.
 *
 * Empirically (synctex 1.21, TeX Live): each record carries `Page`, `h`/`v`
 * (box origin: `h` = left edge, `v` = *baseline*, both in pt from the page's
 * top-left) and `W`/`H` (box width / height above the baseline). Records are
 * frequently emitted more than once for the same position, so we de-duplicate.
 */
export function parseSynctexView(stdout: string): SynctexBox[] {
  const out: SynctexBox[] = [];
  const seen = new Set<string>();
  let cur: Partial<Record<'page' | 'h' | 'v' | 'W' | 'H', number>> = {};

  const flush = (): void => {
    const { page, h, v, W, H } = cur;
    if (page === undefined || h === undefined || v === undefined || W === undefined || H === undefined) {
      return;
    }
    const box: SynctexBox = { page, left: h, top: v - H, width: W, height: H };
    const key = `${box.page}|${box.left.toFixed(3)}|${box.top.toFixed(3)}|${box.width.toFixed(3)}|${box.height.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(box);
    }
  };

  for (const line of stdout.split('\n')) {
    const m = /^(Page|h|v|W|H):(-?[\d.]+)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1] === 'Page' ? 'page' : (m[1] as 'h' | 'v' | 'W' | 'H');
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    // A repeated `Page` means the previous record is complete.
    if (key === 'page' && cur.page !== undefined) {
      flush();
      cur = {};
    }
    cur[key] = value;
    if (key === 'H') {
      flush();
      cur = { page: cur.page };
    }
  }
  flush();
  return out;
}

/** 1-based [startLine, endLine] a node's source range spans. */
export function lineRangeOfNode(source: string, node: SemanticNode): { startLine: number; endLine: number } {
  const startLine = source.slice(0, Math.max(0, node.range.start)).split('\n').length;
  const endLine = source.slice(0, Math.max(0, node.range.end)).split('\n').length;
  return { startLine, endLine: Math.max(startLine, endLine) };
}

export interface SynctexQueryOptions {
  workDir: string;
  texName: string;
  pdfName: string;
  /** Injected for tests; defaults to spawning the real `synctex` CLI. */
  run?: (args: string[], cwd: string) => string | null;
}

function defaultRun(args: string[], cwd: string): string | null {
  const { status, stdout, stderr } = spawnSync('synctex', args, {
    cwd,
    encoding: 'utf-8',
    timeout: SYNCTEX_TIMEOUT_MS,
  });
  if (status !== 0) return null;
  return `${stdout ?? ''}${stderr ?? ''}`;
}

/**
 * Query every line in `lines`, returning the union of all boxes found.
 *
 * How the input file is named matters. When xelatex runs with
 * `-output-directory`, the `.synctex` file records inputs by *absolute* path
 * and a bare `main.tex` query answers `SyncTeX Warning: No tag for main.tex`
 * with exit status 0 — i.e. it fails silently. Without `-output-directory` the
 * recorded path contains a `./` segment that an absolute query can miss. We
 * therefore try the absolute form first and fall back to the bare name.
 */
export function synctexBoxesForLines(lines: number[], opts: SynctexQueryOptions): SynctexBox[] {
  const run = opts.run ?? defaultRun;
  const texPath = isAbsolute(opts.texName) ? opts.texName : join(opts.workDir, opts.texName);
  const pdfPath = isAbsolute(opts.pdfName) ? opts.pdfName : join(opts.workDir, opts.pdfName);
  const boxes: SynctexBox[] = [];
  for (const line of lines) {
    let found: SynctexBox[] = [];
    for (const name of [texPath, opts.texName]) {
      const stdout = run(['view', '-i', `${line}:1:${name}`, '-o', pdfPath], opts.workDir);
      if (!stdout) continue;
      found = parseSynctexView(stdout);
      if (found.length) break;
    }
    boxes.push(...found);
  }
  return boxes;
}

/** Collapse boxes to one bounding rect per page. */
export function unionByPage(boxes: SynctexBox[]): SynctexBox[] {
  const byPage = new Map<number, SynctexBox>();
  for (const b of boxes) {
    const prev = byPage.get(b.page);
    if (!prev) {
      byPage.set(b.page, { ...b });
      continue;
    }
    const left = Math.min(prev.left, b.left);
    const top = Math.min(prev.top, b.top);
    const right = Math.max(prev.left + prev.width, b.left + b.width);
    const bottom = Math.max(prev.top + prev.height, b.top + b.height);
    byPage.set(b.page, { page: b.page, left, top, width: right - left, height: bottom - top });
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/** PDF points → normalized page space, clamped to [0,1]. */
export function toNormRect(box: SynctexBox, page = PAGE_A4_PT): NormRect {
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  const x = clamp(box.left / page.w);
  const y = clamp(box.top / page.h);
  return {
    x,
    y,
    w: clamp(box.width / page.w + x) - x,
    h: clamp(box.height / page.h + y) - y,
  };
}

export interface PdfBoxMapOptions extends SynctexQueryOptions {
  pageSize?: { w: number; h: number };
}

/**
 * Build the PDF box map. Must run inside the compile work dir, *before* it is
 * cleaned up, because `synctex view` reads the `.synctex` file next to the PDF.
 */
export function buildPdfBoxes(tex: string, nodes: SemanticNode[], opts: PdfBoxMapOptions): SourceBox[] {
  const pageSize = opts.pageSize ?? PAGE_A4_PT;
  const out: SourceBox[] = [];
  let budget = MAX_SYNCTEX_QUERIES;

  for (const node of nodes) {
    if (budget <= 0) break;
    const { startLine, endLine } = lineRangeOfNode(tex, node);
    const span = Math.min(endLine - startLine + 1, MAX_LINES_PER_NODE, budget);
    const lines = Array.from({ length: span }, (_, i) => startLine + i);
    budget -= lines.length;

    const merged = unionByPage(synctexBoxesForLines(lines, opts));
    for (const box of merged) {
      const rect = toNormRect(box, pageSize);
      if (rect.w <= 0 || rect.h <= 0) continue;
      out.push({
        nodeId: node.id,
        page: box.page,
        ...rect,
        type: node.type,
        label: describeNode({ ...node, page: box.page }, { kind: 'pdf' }),
      });
    }
  }
  return out;
}

/**
 * Build the deck box map from real browser layout. Geometry comes from
 * `measureDeckBoxes`; type/excerpt (and therefore the label) come from the
 * source parse, so both halves stay tied to the same `data-ao-id`.
 *
 * `AUTOOFFICE_BOXMAP=estimate` skips Chromium (HTTP contract tests / offline)
 * and synthesizes stable stacked boxes from the parsed node tree — still real
 * node ids, not screenshots or empty maps.
 */
export async function buildDeckBoxes(html: string): Promise<SourceBox[]> {
  const mode = (process.env.AUTOOFFICE_BOXMAP ?? 'measure').trim().toLowerCase();
  if (mode === 'estimate') {
    return estimateDeckBoxes(html);
  }
  try {
    const measured = await measureDeckBoxes(html);
    return attachDeckLabels(html, measured);
  } catch (err) {
    if (mode === 'measure-strict') throw err;
    return estimateDeckBoxes(html);
  }
}

function attachDeckLabels(html: string, measured: MeasuredDeckBox[]): SourceBox[] {
  const nodes = new Map(parseDeck(html).nodes.map((n) => [n.id, n]));
  return measured.map((m) => {
    const node = nodes.get(m.nodeId);
    return {
      nodeId: m.nodeId,
      page: m.page,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      type: node?.type ?? 'element',
      label: node
        ? describeNode({ ...node, page: m.page }, { kind: 'presentation' })
        : `第 ${m.page} 页幻灯片 · 元素`,
    } satisfies SourceBox;
  });
}

/** Deterministic layout estimate when Chromium measure is unavailable or opted out. */
export function estimateDeckBoxes(html: string): SourceBox[] {
  const deck = parseDeck(html);
  const byPage = new Map<number, SemanticNode[]>();
  for (const node of deck.nodes) {
    if (node.type === 'slide') continue;
    const page = node.page && node.page > 0 ? node.page : 1;
    const list = byPage.get(page) ?? [];
    list.push(node);
    byPage.set(page, list);
  }
  const out: SourceBox[] = [];
  for (const [page, nodes] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const n = Math.max(1, nodes.length);
    nodes.forEach((node, i) => {
      const y = 0.08 + (i / n) * 0.75;
      const h = Math.min(0.18, 0.7 / n);
      out.push({
        nodeId: node.id,
        page,
        x: 0.08,
        y,
        w: 0.84,
        h,
        type: node.type,
        label: describeNode({ ...node, page }, { kind: 'presentation' }),
      });
    });
  }
  return out;
}

/** Highest page index present in a box list (0 when empty). */
export function pageCountOf(boxes: SourceBox[]): number {
  return boxes.reduce((max, b) => Math.max(max, b.page), 0);
}

/**
 * Build deck box map from Slidev revision source (slides.md → preview HTML measure).
 */
export async function buildSlidevDeckBoxes(source: SourceFile[]): Promise<SourceBox[]> {
  const html = previewHtmlFromSource(source);
  return buildDeckBoxes(html);
}

/** Resolve presentation HTML for box measurement from revision source files. */
export function presentationMeasureHtml(source: SourceFile[]): string | null {
  const legacy = source.find((f) => f.path === 'deck.html')?.content;
  if (legacy) return legacy;
  if (source.some((f) => f.path === SLIDES_MD)) return previewHtmlFromSource(source);
  return null;
}
