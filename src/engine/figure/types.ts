/**
 * Scientific-figure track — type SSoT only (no behavior).
 *
 * Text + optional hand sketch → injectable interpreter → named draw.io objects.
 * Generation of pictures is out of scope. A whole-page sketch pasted as one
 * image cell is a hard audit failure. This slice persists a standalone .drawio;
 * PPT/WPS live and HTTP mount are later units.
 *
 * Geometry is draw.io page coordinates. The locked page for this slice is
 * {@link FIGURE_PAGE_WIDTH} × {@link FIGURE_PAGE_HEIGHT} (1600×900).
 */

/** Locked draw.io page width (px). Same value in schema, example, fixtures, tests. */
export const FIGURE_PAGE_WIDTH = 1600 as const;

/** Locked draw.io page height (px). Same value in schema, example, fixtures, tests. */
export const FIGURE_PAGE_HEIGHT = 900 as const;

export const FIGURE_PAGE = {
  width: FIGURE_PAGE_WIDTH,
  height: FIGURE_PAGE_HEIGHT,
} as const;

export const FIGURE_OBJECT_KINDS = [
  'text',
  'shape',
  'connector',
  'table',
  'atomic-raster',
] as const;

export type FigureObjectKind = (typeof FIGURE_OBJECT_KINDS)[number];

/**
 * Why an object is allowed to stay a raster. Empty / omitted on every
 * non-raster kind. Whole-canvas sketches are never a valid reason.
 */
export const FIGURE_RASTER_REASONS = [
  'irreducible-photo',
  'irreducible-micrograph',
  'irreducible-plot-field',
  'other-atomic',
] as const;

export type FigureRasterReason = (typeof FIGURE_RASTER_REASONS)[number];

/**
 * Audit findings only. Empty / whitespace `prompt` is a pipeline throw
 * (`createFigure` rejects before interpret/draw/audit) — not a category here.
 */
export const FIGURE_AUDIT_CATEGORIES = [
  'whole-sketch-raster',
  'possible-composite-raster',
  'large-raster-surface',
  'outside-page',
  'text-overflow',
  'connector-crossing',
  'connector-path-through-object',
  'arrowhead-intrusion',
  'invalid-xml',
] as const;

export type FigureAuditCategory = (typeof FIGURE_AUDIT_CATEGORIES)[number];

export type FigureAuditSeverity = 'hard' | 'warning';

/** draw.io style keys; extra keys stay stringly for mxCell style passthrough. */
export interface FigureObjectStyle {
  fillColor?: string;
  strokeColor?: string;
  fontColor?: string;
  fontSize?: number;
  shape?: string;
  align?: string;
  verticalAlign?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * One named editable object on the page.
 * Connectors carry sourceId/targetId. atomic-raster must declare rasterReason.
 */
export interface FigureObjectSpec {
  id: string;
  kind: FigureObjectKind;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style?: FigureObjectStyle;
  text?: string;
  sourceId?: string;
  targetId?: string;
  rasterReason?: FigureRasterReason | '';
}

export interface FigurePanelSpec {
  id: string;
  title: string;
  objects: FigureObjectSpec[];
}

/** Content still needing a human; leftover warnings may cite these. */
export interface FigureAmbiguity {
  id: string;
  message: string;
  objectIds?: string[];
}

export interface DesignSpec {
  title: string;
  /** Type-locked to {@link FIGURE_PAGE_WIDTH}. Schema `const: 1600` is the runtime lock. */
  pageWidth: typeof FIGURE_PAGE_WIDTH;
  /** Type-locked to {@link FIGURE_PAGE_HEIGHT}. Schema `const: 900` is the runtime lock. */
  pageHeight: typeof FIGURE_PAGE_HEIGHT;
  panels: FigurePanelSpec[];
  ambiguities: FigureAmbiguity[];
  sourcePrompt: string;
  sketchUsed: boolean;
}

/** Hand-drawn sketch bytes. `data` is raw base64 (no data: prefix). */
export interface FigureSketch {
  mime: string;
  data: string;
}

export interface FigureRequest {
  /**
   * Non-empty after trim. Empty / whitespace is a `createFigure` throw
   * (not `FigureAuditCategory`).
   */
  prompt: string;
  sketch?: FigureSketch;
  attachToProjectId?: string;
  attachPage?: number;
}

export interface FigureAuditFinding {
  category: FigureAuditCategory | (string & {});
  severity: FigureAuditSeverity;
  message: string;
  objectIds?: string[];
}

export interface FigureAuditResult {
  ok: boolean;
  hardCount: number;
  findings: FigureAuditFinding[];
}

export interface FigureResult {
  figureId: string;
  designSpec: DesignSpec;
  drawioXml: string;
  drawioPath: string;
  previewPath?: string;
  audit: FigureAuditResult;
}

export interface FigureInterpretInput {
  prompt: string;
  sketch?: FigureSketch;
}

/**
 * VLM or a test double. Production may call PolarPrivate; tests inject a
 * deterministic interpreter and must not hit the network.
 */
export interface FigureInterpreter {
  interpret(input: FigureInterpretInput): Promise<DesignSpec>;
}

/** Pipeline options. `interpreter` is required in tests; production may default. */
export interface CreateFigureOptions {
  interpreter?: FigureInterpreter;
  outputDir?: string;
}

/**
 * Empty / whitespace `request.prompt` → throw (pipeline gate, not audit).
 * Interpreter output is still drawn then audited; a full-page raster spec
 * must surface `audit.hardCount > 0`, not skip audit.
 */
export type CreateFigureFn = (
  request: FigureRequest,
  options?: CreateFigureOptions,
) => Promise<FigureResult>;

export type DesignSpecFromInputFn = (
  input: FigureInterpretInput,
  interpreter: FigureInterpreter,
) => Promise<DesignSpec>;

export type DrawioFromSpecFn = (spec: DesignSpec) => string;

export type AuditDrawioXmlFn = (xml: string) => FigureAuditResult;
