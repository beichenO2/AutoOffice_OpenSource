/**
 * AutoOffice IDE Engine — HTTP-facing service facade.
 * Delegates generation/edit orchestration to {@link ./orchestrator.js}.
 */
import { EngineStore } from './store.js';
import { Repo } from './repo.js';
import { engineStoreRoot } from './config.js';
import { randomIdFactory, type IdFactory } from './ids.js';
import { systemClock, type Clock } from './clock.js';
import { undo as undoRevision, redo as redoRevision } from './revisions.js';
import { emitEvent, listEvents } from './events.js';
import { assertValid, annotationCreateSchema } from './schema.js';
import type { AgentTask, Annotation, Project, Revision } from './types.js';
import {
  runRequirementPipeline,
  runAnnotationEdit,
  resolveAnnotationCandidates,
  generateFromBrief,
  type OrchestratorDeps,
} from './orchestrator.js';
import { newTask, transitionTask } from './task-state.js';
import { htmlToPdfBuffer, exportDeckPptxImageFallback, measureDeckBoxes } from './render/deck.js';
import { demoProfiles } from './standards/fixtures.js';
import { parseLatexNodes } from './latex/resolver.js';

export class EngineNotFoundError extends Error {
  readonly code = 'not_found';
  constructor(message: string) {
    super(message);
    this.name = 'EngineNotFoundError';
  }
}

export class EngineValidationError extends Error {
  readonly code = 'validation';
  constructor(message: string) {
    super(message);
    this.name = 'EngineValidationError';
  }
}

let singleton: EngineService | null = null;

export function getEngineService(): EngineService {
  if (!singleton) {
    singleton = new EngineService();
  }
  return singleton;
}

export function setEngineServiceForTests(svc: EngineService | null): void {
  singleton = svc;
}

export class EngineService {
  readonly store: EngineStore;
  readonly repo: Repo;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(opts?: { root?: string; idFactory?: IdFactory; clock?: Clock }) {
    this.store = new EngineStore(opts?.root ?? engineStoreRoot());
    this.repo = new Repo(this.store);
    this.idFactory = opts?.idFactory ?? randomIdFactory;
    this.clock = opts?.clock ?? systemClock;
  }

  private deps(): OrchestratorDeps {
    return { repo: this.repo, store: this.store, idFactory: this.idFactory, clock: this.clock };
  }

  private requireProject(id: string): Promise<Project> {
    return this.repo.getProject(id).then((p) => {
      if (!p) throw new EngineNotFoundError(`Project not found: ${id}`);
      return p;
    });
  }

  async listProjects(): Promise<Project[]> {
    return this.repo.listProjects();
  }

  async createProject(name: string, kind: 'pdf' | 'presentation'): Promise<{ project: Project }> {
    const now = this.clock();
    const project: Project = {
      id: this.idFactory('proj'),
      name,
      kind,
      language: kind === 'presentation' ? 'html' : 'latex',
      headRevisionId: null,
      lastGoodRevisionId: null,
      standardProfileId: 'profile_demo_business',
      createdAt: now,
      updatedAt: now,
      undoStack: [],
      redoStack: [],
    };
    await this.repo.putProject(project);
    await emitEvent(this.store, 'requirement.received', project.id, { action: 'create' });
    return { project };
  }

  async getOverview(projectId: string) {
    const project = await this.requireProject(projectId);
    const [tasks, revisions, messages] = await Promise.all([
      this.repo.listTasks(projectId),
      this.repo.listRevisions(projectId),
      this.repo.listMessages(projectId),
    ]);
    return { project, tasks, revisions, messages };
  }

  async postRequirement(
    projectId: string,
    text: string,
  ): Promise<{ project: Project; task: AgentTask; brief?: import('./types.js').Brief; proposal?: import('./types.js').Proposal }> {
    const project = await this.requireProject(projectId);
    let task = newTask({ id: this.idFactory('task'), projectId, goal: text.slice(0, 200) }, this.clock);
    await this.repo.putTask(task);
    await this.repo.putMessage({
      id: this.idFactory('msg'),
      projectId,
      taskId: task.id,
      role: 'user',
      content: text,
      kind: 'text',
      createdAt: this.clock(),
    });
    return runRequirementPipeline(this.deps(), project, text, task);
  }

  async getTask(taskId: string): Promise<AgentTask> {
    const task = await this.repo.getTask(taskId);
    if (!task) throw new EngineNotFoundError(`Task not found: ${taskId}`);
    return task;
  }

  async cancelTask(taskId: string): Promise<AgentTask> {
    const task = await this.getTask(taskId);
    if (task.status === 'completed' || task.status === 'failed') return task;
    const updated = { ...task, cancelRequested: true, status: 'paused' as const, updatedAt: this.clock() };
    await this.repo.putTask(updated);
    return updated;
  }

  getEvents(projectId: string, since?: string) {
    return listEvents(this.store, projectId, since);
  }

  async createAnnotation(projectId: string, body: unknown) {
    assertValid(body, annotationCreateSchema, 'annotation');
    const project = await this.requireProject(projectId);
    if (!project.headRevisionId) throw new EngineValidationError('No head revision');

    const head = await this.repo.getRevision(project.headRevisionId);
    if (!head) throw new EngineNotFoundError('Head revision missing');

    const input = body as {
      page: number;
      rectNorm: Annotation['rectNorm'];
      viewport: Annotation['viewport'];
      instruction: string;
      nearbyText?: string;
      directNodeId?: string;
      domNodeId?: string;
    };

    const nodeHint = input.directNodeId ?? input.domNodeId;

    let pdfPath: string | undefined;
    if (project.kind === 'pdf' && head.renderPath) {
      pdfPath = this.store.renderAbsPath(head.renderPath);
    }

    const candidates = resolveAnnotationCandidates(
      project,
      head,
      input.page,
      input.rectNorm,
      input.directNodeId ?? input.domNodeId,
      pdfPath,
    );

    const annotation: Annotation = {
      id: this.idFactory('ann'),
      projectId,
      revisionId: head.id,
      page: input.page,
      rectNorm: input.rectNorm,
      viewport: input.viewport,
      nearbyText: input.nearbyText,
      instruction: input.instruction,
      candidates,
      status: candidates.length ? 'open' : 'ambiguous',
      createdAt: this.clock(),
    };
    await this.repo.putAnnotation(annotation);
    await emitEvent(this.store, 'annotation.created', projectId, { annotationId: annotation.id });

    if (candidates.length > 0 && candidates[0]!.score >= 0.6) {
      const edited = await runAnnotationEdit(this.deps(), project, annotation, candidates[0]!.nodeId);
      return { annotation: edited.revision ? { ...annotation, status: 'resolved' as const } : annotation, revision: edited.revision };
    }
    return { annotation };
  }

  async chooseProposal(proposalId: string, optionId: string): Promise<{ task: AgentTask }> {
    const proposal = await this.repo.getProposal(proposalId);
    if (!proposal) throw new EngineNotFoundError(`Proposal not found: ${proposalId}`);
    proposal.chosenOptionId = optionId;
    await this.repo.putProposal(proposal);

    const project = await this.requireProject(proposal.projectId);
    const tasks = await this.repo.listTasks(project.id);
    const task = tasks.find((t) => t.proposalIds.includes(proposalId));
    if (!task) throw new EngineNotFoundError('Task for proposal not found');

    await emitEvent(this.store, 'proposal.approved', project.id, { proposalId, optionId }, task.id);
    const brief = task.briefId ? await this.repo.getBrief(task.briefId) : null;
    if (!brief) throw new EngineValidationError('Brief missing for proposal task');

    const theme = optionId.includes('bold') ? 'bold' : optionId.includes('clean') ? 'clean' : 'formal';
    const result = await generateFromBrief(this.deps(), project, brief, task, theme);
    return { task: result.task };
  }

  async undo(projectId: string) {
    const project = await this.requireProject(projectId);
    return undoRevision(this.repo, project, this.clock);
  }

  async redo(projectId: string) {
    const project = await this.requireProject(projectId);
    return redoRevision(this.repo, project, this.clock);
  }

  async getRevisionRender(revisionId: string) {
    const rev = await this.repo.getRevision(revisionId);
    if (!rev?.renderPath) throw new EngineNotFoundError('Revision render not found');
    return {
      buffer: await this.store.readRender(rev.renderPath),
      mime: rev.renderMime ?? 'application/octet-stream',
    };
  }

  async getBoxes(revisionId: string, page: number) {
    const rev = await this.repo.getRevision(revisionId);
    if (!rev) throw new EngineNotFoundError('Revision not found');
    const html = rev.source.find((f) => f.path === 'deck.html')?.content;
    if (html) {
      const measured = await measureDeckBoxes(html);
      return { boxes: measured.filter((b) => b.page === page) };
    }
    const tex = rev.source[0]?.content ?? '';
    return { boxes: parseLatexNodes(tex) };
  }

  async getDiff(revisionId: string) {
    const rev = await this.repo.getRevision(revisionId);
    if (!rev) throw new EngineNotFoundError('Revision not found');
    return {
      baseRevisionId: rev.baseRevisionId,
      changedNodeIds: [] as string[],
      patchSummary: rev.patchSummary ?? '',
    };
  }

  async exportProject(projectId: string, format: 'html' | 'pdf' | 'pptx') {
    const project = await this.requireProject(projectId);
    if (!project.headRevisionId) throw new EngineValidationError('No document to export');
    const head = await this.repo.getRevision(project.headRevisionId);
    if (!head?.renderPath) throw new EngineNotFoundError('Head render missing');

    if (project.kind === 'pdf') {
      const buffer = await this.store.readRender(head.renderPath);
      return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
    }

    const html = head.source.find((f) => f.path === 'deck.html')?.content ?? '';
    if (format === 'html') {
      return { buffer: Buffer.from(html, 'utf-8'), mime: 'text/html', filename: `${project.name}.html` };
    }
    if (format === 'pdf') {
      const buffer = await htmlToPdfBuffer(html);
      return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
    }
    const buffer = await exportDeckPptxImageFallback(html);
    return {
      buffer,
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: `${project.name}.pptx`,
    };
  }

  listStandardProfiles() {
    return demoProfiles();
  }

  async setStandardProfile(projectId: string, profileId: string): Promise<{ project: Project }> {
    const project = await this.requireProject(projectId);
    project.standardProfileId = profileId;
    project.updatedAt = this.clock();
    await this.repo.putProject(project);
    return { project };
  }
}

export { StaleBaseError } from './revisions.js';
