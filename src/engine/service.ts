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
import type { AgentTask, Annotation, Project, Revision, SourceBox } from './types.js';
import { buildDeckBoxes, buildPdfBoxes, buildSlidevDeckBoxes, pageCountOf, presentationMeasureHtml } from './boxmap.js';
import {
  runRequirementPipeline,
  runAnnotationEdit,
  resolveAnnotationCandidates,
  parseRewriteInstruction,
  generateFromBrief,
  indexNodes,
  type OrchestratorDeps,
} from './orchestrator.js';
import { isHighConfidence } from './html/hit-test.js';
import { newTask, transitionTask } from './task-state.js';
import { htmlToPdfBuffer, exportDeckPptxImageFallback, measureDeckBoxes } from './render/deck.js';
import { pptSourceOfTruth } from './config.js';
import { SLIDES_MD, slidevExportPptx, hasSlidevCli } from './slidev/index.js';
import { demoProfiles } from './standards/fixtures.js';
import { parseLatexNodes } from './latex/resolver.js';
import { compileLatexSandbox, cleanupCompileDir, containsPathEscape } from './latex/compile.js';
import type { SourceMap } from './types.js';

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
      language: kind === 'presentation' ? (pptSourceOfTruth() === 'slidev' ? 'markdown' : 'html') : 'latex',
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

    const input = body as {
      page: number;
      rectNorm: Annotation['rectNorm'];
      viewport: Annotation['viewport'];
      instruction: string;
      nearbyText?: string;
      directNodeId?: string;
      domNodeId?: string;
      /** Explicit base revision for the framed artefact; defaults to head. */
      revisionId?: string;
      baseRevisionId?: string;
    };

    const baseRevisionId = input.revisionId ?? input.baseRevisionId ?? project.headRevisionId;
    if (!baseRevisionId) throw new EngineValidationError('No head revision');

    const head = await this.repo.getRevision(baseRevisionId);
    if (!head) throw new EngineNotFoundError(`Revision not found: ${baseRevisionId}`);
    if (head.projectId !== project.id) {
      throw new EngineValidationError('Revision does not belong to this project');
    }

    const boxes = await this.boxesForRevision(head);
    const mappingStatus = await this.ensureSourceMapAvailability(project, head, boxes);
    if (mappingStatus === 'mapping_unavailable') {
      const annotation: Annotation = {
        id: this.idFactory('ann'),
        projectId,
        revisionId: head.id,
        page: input.page,
        rectNorm: input.rectNorm,
        viewport: input.viewport,
        nearbyText: input.nearbyText,
        instruction: input.instruction,
        candidates: [],
        status: 'ambiguous',
        createdAt: this.clock(),
        ambiguityReason: '此旧版本需要重新生成映射（mapping_unavailable）',
      };
      await this.repo.putAnnotation(annotation);
      await emitEvent(this.store, 'annotation.created', projectId, {
        annotationId: annotation.id,
        mapping: 'unavailable',
      });
      return { annotation, mapping: 'unavailable' as const };
    }

    // Client directNodeId/domNodeId/label/score are untrusted hints only.
    // Server re-ranks against the persisted SourceMap for this revision+page.
    const candidates = resolveAnnotationCandidates({
      project,
      head,
      page: input.page,
      rectNorm: input.rectNorm,
      boxes,
      domNodeId: input.directNodeId ?? input.domNodeId,
    });

    // Geometry uses isHighConfidence (top≥0.6 AND margin≥0.2 vs #2).
    // Wording must literally state the replacement. Either gate failing → open/ambiguous.
    const rewrite = parseRewriteInstruction(input.instruction);
    const top = candidates[0];
    const confident = isHighConfidence(candidates);
    const ambiguityReason = !candidates.length
      ? '框选区域没有命中任何可编辑节点'
      : !confident
        ? candidates.length > 1
          ? '框选同时命中多个候选，分差不足以直接修改'
          : '框选置信度不足，无法直接修改'
        : !rewrite.literal
          ? '已定位到目标，但指令没有说明要改成什么内容'
          : undefined;

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
      ...(ambiguityReason ? { ambiguityReason } : {}),
    };
    await this.repo.putAnnotation(annotation);
    await emitEvent(this.store, 'annotation.created', projectId, { annotationId: annotation.id });
    await emitEvent(
      this.store,
      confident && rewrite.literal ? 'target.resolved' : 'target.ambiguous',
      projectId,
      { annotationId: annotation.id, nodeId: top?.nodeId, label: top?.label },
    );

    if (top && confident && rewrite.literal) {
      // Edit is based on the framed revision, not silently on a newer head.
      const edited = await runAnnotationEdit(
        this.deps(),
        project,
        annotation,
        top.nodeId,
        rewrite.text,
        { baseRevisionId: head.id },
      );
      return {
        annotation: {
          ...annotation,
          status: 'resolved' as const,
          resolvedRevisionId: edited.revision.id,
        },
        revision: edited.revision,
      };
    }
    return { annotation };
  }

  /**
   * Box map for a revision: the persisted one when present, otherwise measured
   * on the fly so revisions created before the map existed still resolve.
   */
  private async boxesForRevision(rev: Revision): Promise<SourceBox[]> {
    if (rev.sourceMapId) {
      const map = await this.repo.getSourceMap(rev.sourceMapId);
      if (map?.boxes?.length) return map.boxes;
    }
    const html = presentationMeasureHtml(rev.source);
    if (html) return buildDeckBoxes(html);
    if (rev.source.some((f) => f.path === SLIDES_MD)) return buildSlidevDeckBoxes(rev.source);
    return [];
  }

  /**
   * Old PDF revisions without a persisted SourceMap: rebuild SyncTeX boxes from
   * saved LaTeX in an isolated temp dir, or return mapping_unavailable.
   * Never invent targets from screenshots. Mutates `boxes` in place on success.
   */
  private async ensureSourceMapAvailability(
    project: Project,
    rev: Revision,
    boxes: SourceBox[],
  ): Promise<'ok' | 'mapping_unavailable'> {
    if (boxes.length > 0) return 'ok';

    if (project.kind === 'presentation') {
      if (boxes.length > 0) return 'ok';
      const html = presentationMeasureHtml(rev.source);
      if (html) {
        try {
          const rebuilt = await buildDeckBoxes(html);
          if (rebuilt.length) {
            const nodes = [...indexNodes(project, rev.source).values()];
            const map: SourceMap = {
              id: this.idFactory('map'),
              revisionId: rev.id,
              nodes,
              boxes: rebuilt,
            };
            await this.repo.putSourceMap(map);
            rev.sourceMapId = map.id;
            await this.repo.putRevision(rev);
            boxes.push(...rebuilt);
            return 'ok';
          }
        } catch {
          return 'mapping_unavailable';
        }
      }
      return 'mapping_unavailable';
    }

    const tex =
      rev.source.find((f) => f.path.endsWith('.tex') || f.language === 'latex')?.content ??
      rev.source[0]?.content;
    if (!tex || containsPathEscape(tex)) return 'mapping_unavailable';

    let workDir: string | undefined;
    try {
      const compiled = await compileLatexSandbox(tex);
      workDir = compiled.workDir;
      if (!compiled.ok || !compiled.pdf) return 'mapping_unavailable';

      const nodes = parseLatexNodes(tex);
      const rebuilt = buildPdfBoxes(tex, nodes, {
        workDir: compiled.workDir,
        texName: 'main.tex',
        pdfName: 'main.pdf',
      });
      if (!rebuilt.length) return 'mapping_unavailable';

      const map: SourceMap = {
        id: this.idFactory('map'),
        revisionId: rev.id,
        nodes,
        boxes: rebuilt,
      };
      await this.repo.putSourceMap(map);
      rev.sourceMapId = map.id;
      await this.repo.putRevision(rev);
      boxes.push(...rebuilt);
      return 'ok';
    } catch {
      return 'mapping_unavailable';
    } finally {
      if (workDir) await cleanupCompileDir(workDir);
    }
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

  /** Labelled box map for a revision. `page <= 0` returns every page. */
  async getBoxes(revisionId: string, page: number) {
    const rev = await this.repo.getRevision(revisionId);
    if (!rev) throw new EngineNotFoundError('Revision not found');
    const boxes = await this.boxesForRevision(rev);
    return {
      pageCount: pageCountOf(boxes),
      boxes: page > 0 ? boxes.filter((b) => b.page === page) : boxes,
    };
  }

  async getDiff(revisionId: string) {
    const rev = await this.repo.getRevision(revisionId);
    if (!rev) throw new EngineNotFoundError('Revision not found');
    const intent = rev.editIntentId ? await this.repo.getEditIntent(rev.editIntentId) : null;
    return {
      baseRevisionId: rev.baseRevisionId,
      changedNodeIds: intent?.targetNodeIds ?? [],
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

    const isSlidev = head.source.some((f) => f.path === SLIDES_MD);
    const html =
      head.source.find((f) => f.path === 'deck.html')?.content ??
      presentationMeasureHtml(head.source) ??
      '';

    if (format === 'html') {
      if (isSlidev) {
        const md = head.source.find((f) => f.path === SLIDES_MD)!.content;
        return { buffer: Buffer.from(md, 'utf-8'), mime: 'text/markdown', filename: `${project.name}.md` };
      }
      return { buffer: Buffer.from(html, 'utf-8'), mime: 'text/html', filename: `${project.name}.html` };
    }
    if (format === 'pdf') {
      if (isSlidev && hasSlidevCli()) {
        try {
          const { slidevExport, cleanupSlidevWorkDir } = await import('./slidev/index.js');
          const { readFile } = await import('node:fs/promises');
          const { workDir, outputPath } = await slidevExport(head.source, ['--format', 'pdf']);
          const buffer = await readFile(outputPath);
          await cleanupSlidevWorkDir(workDir);
          return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
        } catch {
          // fall through to HTML→PDF
        }
      }
      const buffer = await htmlToPdfBuffer(html);
      return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
    }

    // PPTX — Slidev export is image-based (text not selectable); legacy HTML uses pptxgenjs fallback.
    if (isSlidev && hasSlidevCli()) {
      try {
        const buffer = await slidevExportPptx(head.source);
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          filename: `${project.name}.pptx`,
        };
      } catch {
        // fall through to legacy
      }
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
