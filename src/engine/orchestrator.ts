/**
 * Generation + edit orchestration for PDF (LaTeX) and presentation (HTML) projects.
 */
import type {
  AgentTask,
  Annotation,
  Brief,
  EditIntent,
  Message,
  Project,
  Proposal,
  Revision,
  SourceFile,
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

  if (project.kind === 'presentation') {
    const html = renderDeckHtml(deckSpecFromBrief(brief, theme));
    source = [{ path: 'deck.html', language: 'html', content: html }];
    renderMime = 'text/html';
    renderBuffer = Buffer.from(html, 'utf-8');
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

  if (project.kind === 'pdf') {
    const tex = source[0]?.content ?? '';
    const map = buildSourceMap(revision.id, tex, idFactory);
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;
  }

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
): Promise<{ project: Project; revision: Revision; task: AgentTask }> {
  const { repo, store, idFactory, clock } = deps;
  const headId = project.headRevisionId;
  if (!headId) throw new Error('No head revision');
  const head = await repo.getRevision(headId);
  if (!head) throw new Error('Head revision missing');

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

  const newText = extractReplacementText(annotation.instruction);
  const intent = buildReplaceTextIntent(
    {
      id: idFactory('edit'),
      projectId: project.id,
      baseRevisionId: headId,
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

  assertBaseCurrent(project, headId);
  let nextSource: SourceFile[];
  if (project.kind === 'presentation') {
    const html = head.source.find((f) => f.path === 'deck.html')?.content ?? '';
    const result = applyEditIntent(html, intent);
    if (!result.collateral.ok) {
      throw new Error(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
    }
    nextSource = [{ path: 'deck.html', language: 'html', content: result.html }];
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
  if (project.kind === 'presentation') {
    const html = nextSource[0]!.content;
    renderMime = 'text/html';
    renderBuffer = Buffer.from(html, 'utf-8');
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

export function resolveAnnotationCandidates(
  project: Project,
  head: Revision,
  page: number,
  rectNorm: Annotation['rectNorm'],
  domNodeId?: string,
  pdfPath?: string,
): Annotation['candidates'] {
  if (domNodeId) {
    const parsed = parseDeck(head.source.find((f) => f.path === 'deck.html')?.content ?? '');
    const node = parsed.nodes.find((n) => n.id === domNodeId);
    if (node) {
      return [{ nodeId: node.id, type: node.type, range: node.range, score: 0.95, reason: 'direct DOM hit' }];
    }
  }
  if (project.kind === 'pdf' && pdfPath) {
    const tex = head.source[0]?.content ?? '';
    const nodes = parseLatexNodes(tex);
    return resolvePdfTargets(rectNorm, page, pdfPath, tex, nodes);
  }
  return [];
}

function extractReplacementText(instruction: string): string {
  const m =
    /(?:改成|改为|换成|修改为|change to|replace with)\s*[「"']?(.+?)[」"']?\s*$/i.exec(instruction) ??
    /(.+)/.exec(instruction);
  return (m?.[1] ?? instruction).trim();
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
