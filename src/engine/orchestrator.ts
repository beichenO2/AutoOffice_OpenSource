/**
 * Generation + edit orchestration for PDF (LaTeX) and presentation (HTML) projects.
 */
import type {
  AgentTask,
  Annotation,
  Brief,
  EditIntent,
  Message,
  NormRect,
  Project,
  Proposal,
  ResolvedCandidate,
  Revision,
  SemanticNode,
  SourceBox,
  SourceFile,
  SourceMap,
  TaskStep,
} from './types.js';
import type { Repo } from './repo.js';
import { emitEvent } from './events.js';
import type { EngineStore } from './store.js';
import type { IdFactory } from './ids.js';
import type { Clock } from './clock.js';
import { interpretRequirement, briefToProposal } from './brief.js';
import { renderDeckHtml, type DeckSpec } from './html/generate.js';
import { parseDeck } from './html/dom.js';
import { applyEditIntent } from './html/edit.js';
import { isHighConfidence } from './html/hit-test.js';
import {
  buildRevision,
  commitRendered,
  saveFailedDraft,
  assertBaseCurrent,
} from './revisions.js';
import { assertValid, editIntentSchema } from './schema.js';
import { buildReplaceTextIntent } from './latex/patch.js';
import { buildDeckBoxes, buildPdfBoxes, buildSlidevDeckBoxes, pageCountOf } from './boxmap.js';
import { describeNode } from './labels.js';
import { rankByRect, type ElementBox } from './html/hit-test.js';
import { intersectionArea } from './coords.js';
import { pptSourceOfTruth } from './config.js';
import {
  renderSlidevSource,
  previewHtmlFromSource,
  applySlidevEditIntent,
  SLIDES_MD,
} from './slidev/index.js';
import { parseSlidevDeck } from './slidev/parse.js';
import {
  compileLatexSandbox,
  cleanupCompileDir,
  containsPathEscape,
} from './latex/compile.js';
import {
  buildSourceMap,
  parseLatexNodes,
  resolvePdfTargets,
} from './latex/resolver.js';
import {
  latexSourceFiles,
  pdfSpecFromBrief,
  renderLatexDocument,
} from './latex/generate.js';
import { applySourcePatch } from './latex/patch.js';
import { htmlToPdfBuffer, measureDeckBoxes } from './render/deck.js';
import { demoProfiles, resolveApplicableRules, runPreflight } from './standards/index.js';
import type { DocumentFacts } from './standards/types.js';

export interface OrchestratorDeps {
  repo: Repo;
  store: EngineStore;
  idFactory: IdFactory;
  clock: Clock;
}

export function deckSpecFromBrief(brief: Brief, theme: string): DeckSpec {
  return {
    title: brief.scenario || '演示文稿',
    theme,
    slides: [
      {
        title: brief.scenario,
        layout: 'title',
        elements: [{ id: 'title', type: 'heading', text: brief.scenario }],
      },
      {
        title: '目标',
        layout: 'content',
        elements: brief.contentGoals.map((g, i) => ({ id: `b${i}`, type: 'bullet' as const, text: g })),
      },
      {
        title: '总结',
        layout: 'content',
        elements: [{ id: 'p1', type: 'paragraph', text: '如需调整措辞，请框选本页文字并说明想怎么改。' }],
      },
    ],
  };
}

export async function runRequirementPipeline(
  deps: OrchestratorDeps,
  project: Project,
  text: string,
  task: AgentTask,
): Promise<{ project: Project; task: AgentTask; brief: Brief; proposal?: Proposal }> {
  const { repo, store, idFactory, clock } = deps;
  await pushStep(repo, task, clock, 'interpret', 'active', '理解需求');
  const interpreted = await interpretRequirement({
    projectId: project.id,
    text,
    kind: project.kind,
    idFactory,
    clock,
  });
  await repo.putBrief(interpreted.brief);
  task = {
    ...task,
    briefId: interpreted.brief.id,
    status: interpreted.proposal ? 'proposing' : 'generating',
    updatedAt: clock(),
  };
  await repo.putTask(task);
  await emitEvent(store, 'brief.structured', project.id, { briefId: interpreted.brief.id }, task.id);

  if (interpreted.proposal) {
    const proposal = briefToProposal(project.id, interpreted, idFactory, clock);
    if (!proposal) throw new Error('proposal expected');
    await repo.putProposal(proposal);
    task = {
      ...task,
      status: 'awaiting_user_choice',
      proposalIds: [...task.proposalIds, proposal.id],
      updatedAt: clock(),
    };
    await repo.putTask(task);
    await emitEvent(store, 'proposal.required', project.id, { proposalId: proposal.id }, task.id);
    const msg: Message = {
      id: idFactory('msg'),
      projectId: project.id,
      taskId: task.id,
      role: 'agent',
      content: proposal.question,
      kind: 'proposal',
      ref: proposal.id,
      createdAt: clock(),
    };
    await repo.putMessage(msg);
    await pushStep(repo, task, clock, 'interpret', 'done');
    return { project, task, brief: interpreted.brief, proposal };
  }

  const result = await generateFromBrief(deps, project, interpreted.brief, task, 'clean');
  return { ...result, brief: interpreted.brief };
}

async function emit(
  store: EngineStore,
  name: Parameters<typeof emitEvent>[1],
  projectId: string,
  data?: Record<string, unknown>,
  taskId?: string,
): Promise<void> {
  await emitEvent(store, name, projectId, data, taskId);
}

export async function generateFromBrief(
  deps: OrchestratorDeps,
  project: Project,
  brief: Brief,
  task: AgentTask,
  theme: string,
): Promise<{ project: Project; task: AgentTask; revision: Revision }> {
  const { repo, store, idFactory, clock } = deps;
  await emit(store, 'generation.started', project.id, { briefId: brief.id }, task.id);
  task = { ...task, status: 'generating', updatedAt: clock() };
  await repo.putTask(task);

  let source: SourceFile[];
  let renderMime: string;
  let renderBuffer: Buffer;
  let boxes: SourceBox[] = [];

  if (project.kind === 'presentation') {
    const spec = deckSpecFromBrief(brief, theme);
    const useSlidev = pptSourceOfTruth() === 'slidev';
    if (useSlidev) {
      source = renderSlidevSource(spec);
      // Live center preview + box-select overlay use the self-contained preview
      // HTML — exactly what buildSlidevDeckBoxes measures against, so box
      // coordinates stay aligned with what the iframe shows. The real Slidev CLI
      // build/export are on-demand deliverable paths (slidev/cli.ts), not the live
      // per-edit render: a full vite build here is slow and yields a dist
      // index.html that cannot load inline in the iframe (assets unresolved).
      const renderHtml = previewHtmlFromSource(source);
      renderMime = 'text/html';
      renderBuffer = Buffer.from(renderHtml, 'utf-8');
      boxes = await buildSlidevDeckBoxes(source);
    } else {
      const html = renderDeckHtml(spec);
      source = [{ path: 'deck.html', language: 'html', content: html }];
      renderMime = 'text/html';
      renderBuffer = Buffer.from(html, 'utf-8');
      boxes = await buildDeckBoxes(html);
    }
  } else {
    const tex = renderLatexDocument(pdfSpecFromBrief(brief.scenario, brief.contentGoals));
    source = latexSourceFiles(tex);
    const compiled = await compileLatexSandbox(tex);
    if (!compiled.ok || !compiled.pdf) {
      const draft = buildRevision({
        project,
        source,
        origin: 'generation',
        label: 'failed compile',
        renderStatus: 'failed',
        renderError: compiled.error,
        idFactory,
        clock,
      });
      await saveFailedDraft(repo, draft);
      task = { ...task, status: 'failed', error: compiled.error, updatedAt: clock() };
      await repo.putTask(task);
      await emit(store, 'render.failed', project.id, { error: compiled.error }, task.id);
      await cleanupCompileDir(compiled.workDir);
      throw new Error(compiled.error ?? 'LaTeX compile failed');
    }
    renderMime = 'application/pdf';
    renderBuffer = compiled.pdf;
    // SyncTeX forward lookup has to run while the `.synctex` file still sits
    // next to the PDF. We persist the result with the revision, so resolving a
    // box selection later never depends on build artefacts surviving.
    boxes = buildPdfBoxes(tex, parseLatexNodes(tex), {
      workDir: compiled.workDir,
      texName: 'main.tex',
      pdfName: 'main.pdf',
    });
    await cleanupCompileDir(compiled.workDir);
  }

  const revision = buildRevision({
    project,
    source,
    origin: 'generation',
    label: 'initial generation',
    renderStatus: 'rendered',
    renderMime,
    idFactory,
    clock,
  });
  const renderPath = await repo.store.writeRender(project.id, `${revision.id}.${project.kind === 'pdf' ? 'pdf' : 'html'}`, renderBuffer);
  revision.renderPath = renderPath;

  const map = await persistSourceMap(deps, revision, project, source, boxes);
  revision.sourceMapId = map.id;

  await runStandardsPreflight(deps, project, revision, brief);

  const committed = await commitRendered(repo, project, revision, clock);
  project = committed.project;
  task = {
    ...task,
    status: 'completed',
    revisionIds: [...task.revisionIds, revision.id],
    updatedAt: clock(),
  };
  await repo.putTask(task);
  await emit(store, 'revision.committed', project.id, { revisionId: revision.id }, task.id);
  await emit(store, 'render.completed', project.id, { revisionId: revision.id }, task.id);
  return { project, task, revision: committed.revision };
}

export async function runAnnotationEdit(
  deps: OrchestratorDeps,
  project: Project,
  annotation: Annotation,
  domNodeId?: string,
  replacementText?: string,
  opts?: { baseRevisionId?: string },
): Promise<{ project: Project; revision: Revision; task: AgentTask }> {
  const { repo, store, idFactory, clock } = deps;
  const headAtStart = project.headRevisionId;
  const baseId = opts?.baseRevisionId ?? annotation.revisionId ?? headAtStart;
  if (!baseId) throw new Error('No base revision');
  const head = await repo.getRevision(baseId);
  if (!head) throw new Error(`Base revision missing: ${baseId}`);
  if (head.projectId !== project.id) throw new Error('Base revision project mismatch');

  const task: AgentTask = {
    id: idFactory('task'),
    projectId: project.id,
    goal: annotation.instruction,
    status: 'editing',
    inputs: { annotationId: annotation.id },
    assumptions: [],
    steps: [],
    toolRunIds: [],
    revisionIds: [],
    verificationRunIds: [],
    proposalIds: [],
    createdAt: clock(),
    updatedAt: clock(),
  };
  await repo.putTask(task);

  let nodeId = domNodeId;
  let candidates = annotation.candidates;
  if (!nodeId && project.kind === 'presentation') {
    nodeId = candidates[0]?.nodeId;
  }
  if (!nodeId && project.kind === 'pdf') {
    nodeId = candidates[0]?.nodeId;
  }
  if (!nodeId) throw new Error('Could not resolve edit target');

  const rewrite = parseRewriteInstruction(annotation.instruction);
  if (replacementText === undefined && !rewrite.literal) {
    throw new AmbiguousInstructionError(
      '指令没有说明要改成什么内容，需要用户补充或从候选方案中选择',
    );
  }
  const newText = replacementText ?? rewrite.text;
  const intent = buildReplaceTextIntent(
    {
      id: idFactory('edit'),
      projectId: project.id,
      baseRevisionId: baseId,
      kind: 'content',
      scope: 'local',
      targetNodeIds: [nodeId],
      instruction: annotation.instruction,
      confidence: isHighConfidence(candidates) ? 0.9 : 0.5,
      rationale: 'Deterministic local edit from user instruction',
    },
    nodeId,
    newText,
  );
  assertValid(intent, editIntentSchema, 'EditIntent');

  // Concurrent head change while applying → reject. Editing a non-head revision
  // is allowed (produces an explicit new revision from that base), but a race
  // that moves head between request start and commit is not.
  const fresh = await repo.getProject(project.id);
  if (!fresh) throw new Error('Project disappeared during edit');
  if (fresh.headRevisionId !== headAtStart) {
    assertBaseCurrent(fresh, headAtStart ?? baseId);
  }
  let nextSource: SourceFile[];
  if (project.kind === 'presentation') {
    const slidevMd = head.source.find((f) => f.path === SLIDES_MD);
    if (slidevMd) {
      const result = applySlidevEditIntent(head.source, intent);
      if (!result.collateral.ok) {
        throw new Error(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
      }
      nextSource = result.source;
    } else {
      const html = head.source.find((f) => f.path === 'deck.html')?.content ?? '';
      const result = applyEditIntent(html, intent);
      if (!result.collateral.ok) {
        throw new Error(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
      }
      nextSource = [{ path: 'deck.html', language: 'html', content: result.html }];
    }
  } else {
    nextSource = applySourcePatch(head.source, intent);
  }

  await emit(store, 'edit.planned', project.id, { editIntentId: intent.id }, task.id);
  await repo.putEditIntent(intent);

  task.status = 'rendering';
  await repo.putTask(task);
  await emit(store, 'render.requested', project.id, {}, task.id);

  let renderBuffer: Buffer;
  let renderMime: string;
  let boxes: SourceBox[] = [];
  if (project.kind === 'presentation') {
    const slidevMd = nextSource.find((f) => f.path === SLIDES_MD);
    if (slidevMd) {
      // Self-contained preview HTML for the live re-render (matches boxmap; see
      // the requirement pipeline note). Slidev CLI build/export stay on-demand.
      const renderHtml = previewHtmlFromSource(nextSource);
      renderMime = 'text/html';
      renderBuffer = Buffer.from(renderHtml, 'utf-8');
      try {
        boxes = await buildSlidevDeckBoxes(nextSource);
      } catch {
        boxes = candidates
          .filter((c) => c.nodeId && c.rect)
          .map((c) => ({
            nodeId: c.nodeId,
            page: annotation.page,
            x: c.rect!.x,
            y: c.rect!.y,
            w: c.rect!.w,
            h: c.rect!.h,
            type: c.type,
            label: c.label,
          }));
      }
    } else {
      const html = nextSource[0]!.content;
      renderMime = 'text/html';
      renderBuffer = Buffer.from(html, 'utf-8');
      try {
        boxes = await buildDeckBoxes(html);
      } catch {
        boxes = candidates
          .filter((c) => c.nodeId && c.rect)
          .map((c) => ({
            nodeId: c.nodeId,
            page: annotation.page,
            x: c.rect!.x,
            y: c.rect!.y,
            w: c.rect!.w,
            h: c.rect!.h,
            type: c.type,
            label: c.label,
          }));
      }
    }
  } else {
    const tex = nextSource[0]!.content;
    if (containsPathEscape(tex)) throw new Error('Path escape blocked');
    const compiled = await compileLatexSandbox(tex);
    if (!compiled.ok || !compiled.pdf) {
      const draft = buildRevision({
        project,
        source: nextSource,
        origin: 'edit',
        label: 'failed edit compile',
        renderStatus: 'failed',
        renderError: compiled.error,
        editIntentId: intent.id,
        idFactory,
        clock,
      });
      await saveFailedDraft(repo, draft);
      await emit(store, 'render.failed', project.id, { error: compiled.error }, task.id);
      await cleanupCompileDir(compiled.workDir);
      throw new Error(compiled.error ?? 'compile failed');
    }
    renderMime = 'application/pdf';
    renderBuffer = compiled.pdf;
    boxes = buildPdfBoxes(tex, parseLatexNodes(tex), {
      workDir: compiled.workDir,
      texName: 'main.tex',
      pdfName: 'main.pdf',
    });
    await cleanupCompileDir(compiled.workDir);
  }

  const revision = buildRevision({
    project,
    source: nextSource,
    origin: 'edit',
    label: `edit ${nodeId}`,
    renderStatus: 'rendered',
    renderMime,
    editIntentId: intent.id,
    patchSummary: intent.operations.map((o) => `${o.op}(${o.nodeId})`).join(', '),
    idFactory,
    clock,
  });
  const ext = project.kind === 'pdf' ? 'pdf' : 'html';
  revision.renderPath = await repo.store.writeRender(project.id, `${revision.id}.${ext}`, renderBuffer);
  revision.sourceMapId = (await persistSourceMap(deps, revision, project, nextSource, boxes)).id;

  const committed = await commitRendered(repo, project, revision, clock);
  annotation.status = 'resolved';
  annotation.resolvedRevisionId = revision.id;
  await repo.putAnnotation(annotation);
  task.status = 'completed';
  task.revisionIds = [...task.revisionIds, revision.id];
  await repo.putTask(task);
  await emit(store, 'edit.applied', project.id, { revisionId: revision.id }, task.id);
  await emit(store, 'revision.committed', project.id, { revisionId: revision.id }, task.id);

  return { project: committed.project, revision: committed.revision, task };
}

/** Semantic nodes of a revision's source-of-truth, keyed by stable id. */
export function indexNodes(project: Project, source: SourceFile[]): Map<string, SemanticNode> {
  if (project.kind === 'presentation') {
    const md = source.find((f) => f.path === SLIDES_MD)?.content;
    if (md) return new Map(parseSlidevDeck(md).nodes.map((n) => [n.id, n]));
    return new Map(
      parseDeck(source.find((f) => f.path === 'deck.html')?.content ?? '').nodes.map((n) => [n.id, n]),
    );
  }
  return new Map(parseLatexNodes(source[0]?.content ?? '').map((n) => [n.id, n]));
}

export interface ResolveInput {
  project: Project;
  head: Revision;
  page: number;
  rectNorm: NormRect;
  /** Persisted box map for `head`. Empty means geometry is unavailable. */
  boxes: SourceBox[];
  /** Set when the client already knows exactly which element was clicked. */
  domNodeId?: string;
}

/**
 * Resolve a framed selection to ranked source candidates.
 *
 * One geometric path for both media. The render→source box map is built at
 * generation time (browser layout for HTML, SyncTeX forward lookup for PDF),
 * so this function is pure, synchronous and unit-testable: it never shells
 * out, never reads the rendered artefact, and never asks a model to guess from
 * a screenshot.
 */
export function resolveAnnotationCandidates(input: ResolveInput): ResolvedCandidate[] {
  const { project, head, page, rectNorm, boxes, domNodeId } = input;
  const kind = project.kind === 'presentation' ? 'presentation' : 'pdf';
  const index = indexNodes(project, head.source);
  const boxOf = (nodeId: string): SourceBox | undefined =>
    boxes.find((b) => b.nodeId === nodeId && b.page === page);
  const rectOf = (box: SourceBox | undefined): { rect: NormRect } | Record<string, never> =>
    box ? { rect: { x: box.x, y: box.y, w: box.w, h: box.h } } : {};

  const elements: ElementBox[] = boxes
    .filter((b) => b.page === page)
    .map((b) => ({
      nodeId: b.nodeId,
      type: b.type ?? index.get(b.nodeId)?.type ?? 'element',
      page: b.page,
      rect: { x: b.x, y: b.y, w: b.w, h: b.h },
    }));

  const geometric = (): ResolvedCandidate[] =>
    rankByRect(rectNorm, elements, page).map((candidate) => {
      const node = index.get(candidate.nodeId);
      const box = boxOf(candidate.nodeId);
      return {
        ...candidate,
        range: node?.range ?? candidate.range,
        label: box?.label ?? (node ? describeNode({ ...node, page }, { kind }) : candidate.nodeId),
        ...rectOf(box),
      };
    });

  // directNodeId is an untrusted client hint. Accept only when the node belongs
  // to this revision, lives on the requested page, and its SourceBox intersects
  // the framed rect. Otherwise ignore and re-rank server-side.
  if (domNodeId) {
    const node = index.get(domNodeId);
    const box = boxOf(domNodeId);
    const boxRect = box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null;
    const hits =
      !!node &&
      !!boxRect &&
      intersectionArea(boxRect, rectNorm) > 0;
    if (hits && node && boxRect) {
      return [
        {
          nodeId: node.id,
          type: node.type,
          range: node.range,
          score: 0.95,
          reason: 'direct DOM hit (server-verified)',
          label: box?.label ?? describeNode({ ...node, page }, { kind }),
          ...rectOf(box),
        },
      ];
    }
  }

  return geometric();
}

/** Raised when an instruction frames a target but never says what to change it to. */
export class AmbiguousInstructionError extends Error {
  readonly code = 'ambiguous_instruction';
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousInstructionError';
  }
}

const REWRITE_RE =
  /(?:改成|改为|换成|修改为|替换为|写成|change to|replace with|rewrite as)\s*[「『"'“”]?(.+?)[」』"'“”]?\s*[。.]?\s*$/i;

/**
 * Decide whether an instruction literally states its replacement text.
 *
 * The previous behaviour fell back to "use the whole instruction as the new
 * text", which turned 「这里字太小了」into a document that literally reads
 * 「这里字太小了」. Anything without an explicit rewrite verb is now reported
 * as non-literal, so the caller asks instead of guessing.
 */
export function parseRewriteInstruction(instruction: string): { text: string; literal: boolean } {
  const captured = REWRITE_RE.exec(instruction.trim())?.[1]?.trim();
  if (captured) return { text: captured, literal: true };
  return { text: instruction.trim(), literal: false };
}

/** Persist the node list + box map that a revision's render resolves through. */
async function persistSourceMap(
  deps: OrchestratorDeps,
  revision: Revision,
  project: Project,
  source: SourceFile[],
  boxes: SourceBox[],
): Promise<SourceMap> {
  const nodes = [...indexNodes(project, source).values()];
  const map: SourceMap = {
    id: deps.idFactory('map'),
    revisionId: revision.id,
    nodes,
    boxes,
  };
  await deps.repo.putSourceMap(map);
  return map;
}

async function pushStep(
  repo: Repo,
  task: AgentTask,
  clock: Clock,
  name: string,
  status: TaskStep['status'],
  detail?: string,
): Promise<void> {
  const step: TaskStep = { name, status, detail, at: clock() };
  task.steps = [...task.steps.filter((s) => s.name !== name), step];
  await repo.putTask(task);
}

async function runStandardsPreflight(
  deps: OrchestratorDeps,
  project: Project,
  revision: Revision,
  brief: Brief,
): Promise<void> {
  const profiles = demoProfiles();
  const rules = (await import('./standards/fixtures.js')).demoRules();
  const resolved = resolveApplicableRules(profiles, rules, {
    docType: brief.docType,
    institution: brief.audience,
  });
  const facts: DocumentFacts = {
    kind: project.kind === 'pdf' ? 'pdf' : 'presentation',
    pageWidthMm: project.kind === 'pdf' ? 210 : undefined,
    pageHeightMm: project.kind === 'pdf' ? 297 : undefined,
    slideCount: project.kind === 'presentation' ? 3 : undefined,
    aspectRatio: project.kind === 'presentation' ? '16:9' : undefined,
  };
  const report = runPreflight(resolved, facts, deps.clock);
  await deps.repo.putVerificationRun({
    id: deps.idFactory('ver'),
    revisionId: revision.id,
    checks: report.findings.map((f) => ({ name: f.ruleId, ok: f.ok, detail: f.message })),
    ok: report.ok,
    createdAt: deps.clock(),
  });
  await emit(deps.store, 'verification.completed', project.id, { ok: report.ok }, undefined);
}

export async function buildDocumentFacts(project: Project, html: string): Promise<DocumentFacts> {
  const boxes = await measureDeckBoxes(html);
  return {
    kind: 'presentation',
    slideCount: html.match(/class="ao-slide"/g)?.length ?? 0,
    aspectRatio: '16:9',
    elements: boxes.map((b) => ({
      nodeId: b.nodeId,
      type: 'element',
      page: b.page,
      boxNorm: { x: b.x, y: b.y, w: b.w, h: b.h },
    })),
  };
}
