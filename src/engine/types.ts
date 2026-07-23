/**
 * AutoOffice IDE Engine — domain model.
 *
 * This is the shared vocabulary for PDF (LaTeX-sourced) and PPT (HTML-sourced)
 * documents. Both media share Project / Artifact / Revision / Annotation /
 * EditIntent / Proposal / AgentTask / Verification concepts; only the source
 * language and the render/source-map adapter differ.
 */

export type DocumentKind = 'pdf' | 'presentation';

/** Source language of a project's editable source-of-truth. */
export type SourceLanguage = 'latex' | 'html' | 'css';

/** Semantic node types that a selection can resolve to. */
export type SemanticNodeType =
  | 'document'
  | 'slide'
  | 'section'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'listitem'
  | 'table'
  | 'image'
  | 'formula'
  | 'element'
  | 'text';

/** A file inside a project's source tree (path is project-relative, POSIX). */
export interface SourceFile {
  path: string;
  language: SourceLanguage;
  content: string;
}

/** Character range [start, end) inside a specific source file. */
export interface SourceRange {
  file: string;
  start: number;
  end: number;
}

/**
 * A stable, render-independent handle onto a document object. For HTML this is
 * a `data-ao-id`; for LaTeX it is an injected `\aoNode{id}` marker / label.
 */
export interface SemanticNode {
  id: string;
  type: SemanticNodeType;
  /** Source range this node's authoritative content occupies. */
  range: SourceRange;
  /** 1-based page (PDF) or slide index (presentation), if known. */
  page?: number;
  /** Parent node id, for scope/containment reasoning. */
  parentId?: string;
  /** Short excerpt of the node's text, for matching + explainability. */
  excerpt?: string;
  /** DOM selector (presentation) if applicable. */
  selector?: string;
  meta?: Record<string, unknown>;
}

/** Map from rendered artifact back to source, produced per revision. */
export interface SourceMap {
  id: string;
  revisionId: string;
  nodes: SemanticNode[];
  /** For PDF: synctex-derived page boxes; for HTML: bounding boxes if measured. */
  boxes?: SourceBox[];
}

/** A positioned box (normalized 0..1, top-left origin) tied to a node. */
export interface SourceBox {
  nodeId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RenderStatus = 'pending' | 'rendered' | 'failed';
export type RevisionOrigin = 'generation' | 'edit' | 'undo' | 'redo' | 'migration' | 'import';

/** Immutable snapshot of a project's source + its render result. */
export interface Revision {
  id: string;
  projectId: string;
  baseRevisionId: string | null;
  origin: RevisionOrigin;
  createdAt: string;
  /** Content hash of the source tree (integrity + idempotency). */
  sourceHash: string;
  source: SourceFile[];
  /** Relative path (under project render dir) of the rendered artifact, if any. */
  renderPath?: string;
  renderMime?: string;
  renderStatus: RenderStatus;
  renderError?: string;
  sourceMapId?: string;
  editIntentId?: string;
  patchSummary?: string;
  label: string;
}

/** Normalized rectangle in [0,1], top-left origin, page/slide space. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Viewport transform captured at annotation time. */
export interface Viewport {
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  dpr: number;
  pageWidthPx: number;
  pageHeightPx: number;
  scrollX?: number;
  scrollY?: number;
}

export type AnnotationStatus = 'open' | 'resolved' | 'ambiguous' | 'stale';

export interface ResolvedCandidate {
  nodeId: string;
  type: SemanticNodeType;
  range: SourceRange;
  score: number;
  reason: string;
}

/** A user framing + natural-language instruction over a rendered artifact. */
export interface Annotation {
  id: string;
  projectId: string;
  revisionId: string;
  /** 1-based page (PDF) or slide index (presentation). */
  page: number;
  rectNorm: NormRect;
  viewport: Viewport;
  nearbyText?: string;
  instruction: string;
  candidates: ResolvedCandidate[];
  status: AnnotationStatus;
  createdAt: string;
  resolvedRevisionId?: string;
  ambiguityReason?: string;
}

export type EditKind = 'content' | 'style' | 'layout' | 'structure' | 'media';
export type EditScope = 'local' | 'multi';

export type EditOpType =
  | 'replaceText'
  | 'setStyle'
  | 'setAttr'
  | 'insertAfter'
  | 'insertBefore'
  | 'remove'
  | 'wrap'
  | 'replaceSource';

export interface EditOp {
  op: EditOpType;
  /** Target semantic node id. */
  nodeId: string;
  /** Op-specific payload (text, style props, attr map, raw source, ...). */
  payload: Record<string, unknown>;
}

/** A schema-validated, scoped plan for changing source. Never free text. */
export interface EditIntent {
  id: string;
  projectId: string;
  baseRevisionId: string;
  kind: EditKind;
  scope: EditScope;
  targetNodeIds: string[];
  instruction: string;
  operations: EditOp[];
  confidence: number;
  rationale: string;
  /** Node ids the plan is allowed to touch; anything else is a violation. */
  allowedNodeIds: string[];
}

export interface ProposalOption {
  id: string;
  label: string;
  plainImpact: string;
  scope: EditScope;
  reversible: boolean;
  previewRef?: string;
}

export interface Proposal {
  id: string;
  projectId: string;
  question: string;
  options: ProposalOption[];
  recommendedOptionId: string;
  createdAt: string;
  chosenOptionId?: string;
}

/** Structured requirement understanding. */
export interface Brief {
  id: string;
  projectId: string;
  docType: string;
  audience: string;
  scenario: string;
  contentGoals: string[];
  materials: string[];
  lengthPages?: number;
  deliveryFormats: string[];
  deadline?: string;
  standards: string[];
  preferences: string[];
  prohibitions: string[];
  uncertainties: string[];
  assumptions: string[];
  createdAt: string;
}

export type TaskStatus =
  | 'queued'
  | 'interpreting'
  | 'proposing'
  | 'awaiting_user_choice'
  | 'generating'
  | 'editing'
  | 'rendering'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'paused';

export type ToolRunStatus = 'running' | 'ok' | 'error' | 'timeout' | 'cancelled';

export interface ToolRun {
  id: string;
  taskId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  status: ToolRunStatus;
  error?: string;
  idempotencyKey?: string;
  startedAt: string;
  endedAt?: string;
}

export interface TaskStep {
  name: string;
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  detail?: string;
  at: string;
}

export interface AgentTask {
  id: string;
  projectId: string;
  goal: string;
  status: TaskStatus;
  inputs: Record<string, unknown>;
  assumptions: string[];
  currentStep?: string;
  steps: TaskStep[];
  toolRunIds: string[];
  revisionIds: string[];
  verificationRunIds: string[];
  briefId?: string;
  proposalIds: string[];
  error?: string;
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerificationRun {
  id: string;
  revisionId: string;
  checks: VerificationCheck[];
  ok: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  kind: DocumentKind;
  language: SourceLanguage;
  headRevisionId: string | null;
  lastGoodRevisionId: string | null;
  standardProfileId?: string;
  createdAt: string;
  updatedAt: string;
  /** Monotonic pointer for undo/redo over the revision chain. */
  undoStack: string[];
  redoStack: string[];
}

export interface Message {
  id: string;
  projectId: string;
  taskId?: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  kind?: 'text' | 'proposal' | 'diff' | 'error' | 'status';
  ref?: string;
  createdAt: string;
}

/** The event chain names used across the engine + API. */
export type EngineEventName =
  | 'requirement.received'
  | 'brief.structured'
  | 'proposal.required'
  | 'proposal.approved'
  | 'generation.started'
  | 'source.changed'
  | 'render.requested'
  | 'render.completed'
  | 'render.failed'
  | 'annotation.created'
  | 'target.resolved'
  | 'target.ambiguous'
  | 'edit.planned'
  | 'edit.applied'
  | 'verification.completed'
  | 'revision.committed';

export interface EngineEvent {
  name: EngineEventName;
  projectId: string;
  taskId?: string;
  at: string;
  data?: Record<string, unknown>;
}
