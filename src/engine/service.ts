/**
 * AutoOffice IDE Engine — HTTP-facing service facade.
 * Delegates generation/edit orchestration to {@link ./orchestrator.js}.
 */
import { EngineStore } from './store.js';
import { Repo } from './repo.js';
import { engineStoreRoot } from './config.js';
import { randomIdFactory, type IdFactory } from './ids.js';
import { systemClock, type Clock } from './clock.js';
import { undo as undoRevision, redo as redoRevision, buildRevision, commitRendered } from './revisions.js';
import { buildSetAttrIntent } from './latex/patch.js';
import {
  llmEditEnabled,
  llmRewriteText,
  llmUnifyDeckText,
  llmPickImageColor,
  colorCardDataUri,
  nodeCurrentText,
  nodeCurrentStyle,
  nodeIsImage,
  nodeTag,
  deterministicStyleOps,
  sizeNudgeFactor,
  roleBaseFontVw,
  sanitizeStyleMap,
  llmStyleEdit,
  mergeInlineStyle,
} from './llm-edit.js';
import { emitEvent, listEvents } from './events.js';
import { assertValid, annotationCreateSchema, editIntentSchema, imageInsertSchema } from './schema.js';
import type { AgentTask, Annotation, Project, Revision, SourceBox, SourceFile, SourceMap } from './types.js';
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
import { exportDeckPdfVector, exportDeckPdfWysiwyg, exportDeckPptxWysiwyg } from './render/deck.js';
import { runTextLayoutPreflight } from './standards/preflight.js';
import { deckSpecFromAoHtml, isEditablePptxExportEnabled, renderEditablePptx } from './export/editable-pptx.js';
import { pptSourceOfTruth } from './config.js';
import {
  SLIDES_MD,
  renderSlidevSource,
  applySlidevEditIntent,
  insertImageIntoSlideMarkdown,
  imageElementHtml,
  setDeckAccentInFrontmatter,
  setDeckStyleInFrontmatter,
  recolorColorCardImages,
  deckTextReplace,
  collectDeckTextNodes,
} from './slidev/index.js';
import { classifyEditScope } from './skills.js';
import { llmGenerateDeckSpec, fallbackDeckSpec, insertImagesIntoSpec, applyDeckAnimation, verifyDeckGrounding, type GroundingReport } from './llm-generate.js';
import { demoProfiles } from './standards/fixtures.js';
import { parseLatexNodes } from './latex/resolver.js';
import { compileLatexSandbox, cleanupCompileDir, containsPathEscape } from './latex/compile.js';
import { previewHtmlFittedFromSource } from './slidev/generate.js';
import { fitPreviewHtml, isPreviewFitted } from './text-fit.js';

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

/** Normalize a user hex to #rrggbb (expands #rgb); falls back to a safe accent. */
function normalizeHex(hex: string): string {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec((hex ?? '').trim());
  if (!m) return '#4f63e6';
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toLowerCase()}`;
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

  /** Bake Playwright/heuristic text-fit into preview HTML before save/serve. */
  private async fittedPreviewBuffer(source: SourceFile[]): Promise<Buffer> {
    return Buffer.from(await previewHtmlFittedFromSource(source), 'utf-8');
  }

  /**
   * HTML that export preflights and writes: prefer an already-fitted render
   * (`PREVIEW_FITTED_ATTR`), otherwise run the fit ladder so preview / gate /
   * export share the same bytes.
   */
  private async htmlForExport(head: Revision): Promise<string> {
    let html =
      head.source.find((f) => f.path === 'deck.html')?.content ??
      presentationMeasureHtml(head.source) ??
      '';

    if (head.renderMime?.includes('html') && head.renderPath) {
      try {
        const renderHtml = (await this.store.readRender(head.renderPath)).toString('utf-8');
        if (isPreviewFitted(renderHtml)) html = renderHtml;
      } catch {
        /* keep source html */
      }
    }

    if (html.includes('ao-slide') && !isPreviewFitted(html)) {
      html = (await fitPreviewHtml(html)).html;
    }
    return html;
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

  /**
   * App entry — generate a full presentation deck from a topic (+ optional
   * research notes). Uses GLM for a rich, information-dense deck when
   * AUTOOFFICE_LLM_EDIT=1; otherwise a richer-than-default deterministic fallback.
   * Always emits a self-contained Slidev deck, rendered + box-mapped + committed
   * as the initial generation revision (so it opens box-selectable in /aoide/).
   */
  async createDeckFromTopic(
    name: string,
    topic: string,
    research = '',
    opts: {
      outline?: string;
      guidance?: string;
      images?: { slide?: number; src: string; alt?: string }[];
      allowFormulas?: boolean;
      animate?: boolean;
      slides?: number;
    } = {},
  ): Promise<{ project: Project; revision: Revision; usedLlm: boolean; slides: number; grounding: GroundingReport }> {
    const { repo, store, idFactory, clock } = this.deps();
    const { project } = await this.createProject(name || topic.slice(0, 40) || '演示文稿', 'presentation');

    let spec = llmEditEnabled()
      ? await llmGenerateDeckSpec(topic, research, {
          outline: opts.outline,
          guidance: opts.guidance,
          allowFormulas: opts.allowFormulas,
          slides: opts.slides,
        })
      : null;
    const usedLlm = !!spec;
    if (!spec) spec = fallbackDeckSpec(topic, [research, opts.guidance].filter(Boolean).join('\n'));
    if (opts.images?.length) spec = insertImagesIntoSpec(spec, opts.images);
    if (opts.animate) spec = applyDeckAnimation(spec); // S7: transitions + step-reveal

    // #4 data-rigor check: every specific number in the deck should trace back to
    // the grounding sources (guidance + research). Advisory — surfaced to the user,
    // never blocks generation.
    const grounding = verifyDeckGrounding(spec, [research, opts.guidance].filter(Boolean).join('\n'));

    const source = renderSlidevSource(spec);
    const renderBuffer = await this.fittedPreviewBuffer(source);
    const boxes = await buildSlidevDeckBoxes(source);
    const revision = buildRevision({
      project,
      source,
      origin: 'generation',
      label: 'initial generation',
      renderStatus: 'rendered',
      renderMime: 'text/html',
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, source).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;

    const committed = await commitRendered(repo, project, revision, clock);
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { project: committed.project, revision: committed.revision, usedLlm, slides: spec.slides.length, grounding };
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
    // Measure-mode hotspots for components that overhang the slide edge (e.g. a
    // cover title sitting slightly above the top) can frame a rect just outside
    // [0,1]; clamp it so a legitimate edge selection resolves instead of failing
    // schema validation (which would surface as a 500 to the user).
    if (body && typeof body === 'object') {
      const r = (body as Record<string, unknown>).rectNorm as Record<string, unknown> | undefined;
      if (r && typeof r === 'object') {
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const x = Math.min(1, Math.max(0, num(r.x)));
        const y = Math.min(1, Math.max(0, num(r.y)));
        (body as Record<string, unknown>).rectNorm = {
          x,
          y,
          w: Math.min(1 - x, Math.max(0, num(r.w))),
          h: Math.min(1 - y, Math.max(0, num(r.h))),
        };
      }
    }
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
    const isSlidev = head.source.some((f) => f.path === SLIDES_MD);
    const targetIsImage = !!top && isSlidev && nodeIsImage(head.source, top.nodeId);
    // PPT skill: a deck is a themed system. A color/palette instruction on ANY
    // element generalizes to the whole deck (recolor every illustration + shift
    // the theme accent), whereas wording stays local. The framed node only needs
    // to exist (it anchors intent); the recolor itself is deck-wide.
    const plan = top && isSlidev && llmEditEnabled()
      ? classifyEditScope(input.instruction, { isImage: targetIsImage })
      : null;
    const deckColor = !!plan && plan.scope === 'deck' && plan.axis === 'color';
    // PPT skill (text): a term-unification like「把全部 X 统一改成 Y」generalizes
    // deck-wide as a deterministic rename across every slide. Like a deck recolor,
    // the framed node only anchors intent — no per-node confidence needed.
    const deckText = !!plan && plan.scope === 'deck' && plan.axis === 'text' && !!plan.textReplace;
    // A whole-deck text intent with no parseable A→B → GLM semantic unification
    // across multiple nodes (consistent terminology / tone). Same deck-anchored
    // gating as deckColor/deckText: the framed node only anchors intent.
    const deckSemantic = !!plan && plan.scope === 'deck' && plan.axis === 'text' && !plan.textReplace;
    // PPT skill (visual style): a whole-deck style preset (科技风/党政风/商务…) restyles
    // the entire deck's look-and-feel (font + palette + cover + bullets). Like a deck
    // recolor, the framed node only anchors intent — no per-node confidence needed.
    const deckStyle = !!plan && plan.scope === 'deck' && plan.axis === 'style' && !!plan.styleId;
    // Element-level visual micro-tweak (line weight / alignment / size / spacing…) on
    // the framed node only — needs a confident target like a text rewrite.
    const localStyle = !!plan && plan.scope === 'local' && plan.axis === 'style';
    // An image target is edited by recoloring/swapping its src (replaceText is
    // meaningless on <img>), so images route to the GLM recolor path — unless the
    // instruction is a deck-wide color/term change, which supersedes the local one.
    const isImg = !deckColor && !deckText && !deckSemantic && !!top && confident && llmEditEnabled() && targetIsImage;
    // With the LLM edit assistant on, a confident target + a free-form (non-literal)
    // instruction like「这句太啰嗦」is resolvable: GLM produces the replacement.
    const canLlm = !deckColor && !deckText && !deckSemantic && !deckStyle && !localStyle && !!top && confident && !rewrite.literal && llmEditEnabled();
    const canEdit = !!top && (deckColor || deckText || deckSemantic || deckStyle || (confident && (isImg || rewrite.literal || canLlm || localStyle)));
    const ambiguityReason = !candidates.length
      ? '框选区域没有命中任何可编辑节点'
      : canEdit
        ? undefined
        : !confident
          ? candidates.length > 1
            ? '框选同时命中多个候选，分差不足以直接修改'
            : '框选置信度不足，无法直接修改'
          : '已定位到目标，但指令没有说明要改成什么内容';

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
      canEdit ? 'target.resolved' : 'target.ambiguous',
      projectId,
      { annotationId: annotation.id, nodeId: top?.nodeId, label: top?.label },
    );

    if (canEdit && top) {
      try {
        // Deck-wide color/theme change → recolor the whole deck (the #4 skill).
        if (deckColor) {
          return await this.deckRecolorEdit(project, head, annotation, input.instruction);
        }
        // Deck-wide term unification → replace the term across every slide (#4 text).
        if (deckText && plan?.textReplace) {
          return await this.deckTextEdit(
            project,
            head,
            annotation,
            plan.textReplace.from,
            plan.textReplace.to,
          );
        }
        // Deck-wide semantic unification → GLM rewrites multiple nodes consistently.
        if (deckSemantic) {
          return await this.deckSemanticEdit(project, head, annotation, input.instruction);
        }
        // Deck-wide visual style preset (科技风/党政风/商务…) → restyle whole deck.
        if (deckStyle && plan?.styleId) {
          return await this.deckStyleEdit(project, head, annotation, plan.styleId);
        }
        // Element-level visual micro-tweak → scoped inline-style edit on this node.
        if (localStyle) {
          return await this.localStyleEdit(project, head, annotation, top.nodeId, input.instruction);
        }
        // Image target → recolor / swap the illustration via GLM (setAttr src).
        if (isImg) {
          return await this.llmImageEdit(project, head, annotation, top.nodeId, input.instruction);
        }
        // Literal → use stated text; non-literal → GLM rewrites just this node.
        const editText = rewrite.literal
          ? rewrite.text
          : await llmRewriteText(nodeCurrentText(head.source, top.nodeId), input.instruction);
        // Edit is based on the framed revision, not silently on a newer head.
        const edited = await runAnnotationEdit(
          this.deps(),
          project,
          annotation,
          top.nodeId,
          editText,
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
      } catch (err) {
        if (rewrite.literal && !isImg) throw err; // literal text path keeps its original strictness
        // LLM assist failed (proxy down / bad output): don't crash the request —
        // leave a located-but-unresolved annotation so the user can retry.
        await emitEvent(this.store, 'target.ambiguous', projectId, {
          annotationId: annotation.id,
          reason: 'llm_edit_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
        return { annotation: { ...annotation, ambiguityReason: 'LLM 助手暂时不可用，请重试或改用「改成…」的明确指令' } };
      }
    }
    return { annotation };
  }

  /** GLM-driven illustration recolor for a framed image node (Slidev decks). */
  private async llmImageEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    nodeId: string,
    instruction: string,
  ): Promise<{ annotation: Annotation; revision: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const pick = await llmPickImageColor(instruction);
    const intent = buildSetAttrIntent(
      {
        id: idFactory('edit'),
        projectId: project.id,
        baseRevisionId: head.id,
        kind: 'content',
        scope: 'local',
        targetNodeIds: [nodeId],
        instruction,
        confidence: 0.9,
        rationale: 'LLM illustration recolor',
      },
      nodeId,
      { src: colorCardDataUri(pick.hex, pick.label) },
    );
    assertValid(intent, editIntentSchema, 'EditIntent');

    const result = applySlidevEditIntent(head.source, intent);
    if (!result.collateral.ok) {
      throw new EngineValidationError(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
    }
    const nextSource = result.source;
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);

    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `edit ${nodeId}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      editIntentId: intent.id,
      patchSummary: `setAttr(${nodeId})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;
    await repo.putEditIntent(intent);

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, { revisionId: committed.revision.id });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * PPT skill — deck-wide recolor. A color/palette instruction on any framed
   * element restyles the *whole* presentation consistently: GLM picks one accent,
   * then every color-card illustration is recolored (labels preserved) and the
   * theme accent (titles / bullets / tick / callout / cover) is shifted to match.
   * One revision, fully undoable.
   */
  private async deckRecolorEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    instruction: string,
  ): Promise<{ annotation: Annotation; revision: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const mdIdx = head.source.findIndex((f) => f.path === SLIDES_MD);
    if (mdIdx === -1) throw new EngineValidationError('deck recolor requires a Slidev deck');

    const pick = await llmPickImageColor(instruction);
    const hex = normalizeHex(pick.hex);

    let md = head.source[mdIdx]!.content;
    const recolored = recolorColorCardImages(md, ({ label }) =>
      colorCardDataUri(hex, label || pick.label || '示意图'),
    );
    md = setDeckAccentInFrontmatter(recolored.md, hex);

    const nextSource = head.source.map((f, i) => (i === mdIdx ? { ...f, content: md } : { ...f }));
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `deck recolor ${hex}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      patchSummary: `deckRecolor(accent=${hex}; images=${recolored.changed.length})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'deck-recolor',
      hex,
      images: recolored.changed.length,
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * PPT skill — deck-wide term unification. A framed instruction like
   *「把全部『AI』统一改成『人工智能』」renames the term across *every* slide in one
   * deterministic pass (no LLM): frontmatter, tags and data-ao-id stay intact,
   * only visible text changes. One revision, fully undoable. When the term isn't
   * found anywhere the annotation stays located-but-unresolved (no empty commit).
   */
  private async deckTextEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    from: string,
    to: string,
  ): Promise<{ annotation: Annotation; revision?: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const mdIdx = head.source.findIndex((f) => f.path === SLIDES_MD);
    if (mdIdx === -1) throw new EngineValidationError('deck text edit requires a Slidev deck');

    const { md, count } = deckTextReplace(head.source[mdIdx]!.content, from, to, { syncAltLabels: true });
    if (count === 0) {
      annotation.ambiguityReason = `整册未找到「${from}」，没有可统一替换的文字`;
      await repo.putAnnotation(annotation);
      await emitEvent(this.store, 'target.ambiguous', project.id, {
        annotationId: annotation.id,
        reason: 'deck_text_no_match',
        from,
      });
      return { annotation };
    }

    const nextSource = head.source.map((f, i) => (i === mdIdx ? { ...f, content: md } : { ...f }));
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `deck text ${from}→${to}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      patchSummary: `deckTextReplace("${from}"→"${to}"; hits=${count})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'deck-text-replace',
      from,
      to,
      hits: count,
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * PPT skill — deck-wide *semantic* unification. For a whole-deck text intent
   * with no literal A→B (e.g.「整册术语和语气统一得更专业些」), GLM sees every text
   * node and returns consistent rewrites for the ones that need it; they are
   * applied as ONE scope-checked revision (undoable). data-ao-id / structure stay
   * intact (only node text changes). If GLM proposes nothing, the annotation
   * stays located-but-unresolved (no empty commit).
   */
  private async deckSemanticEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    instruction: string,
  ): Promise<{ annotation: Annotation; revision?: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const mdIdx = head.source.findIndex((f) => f.path === SLIDES_MD);
    if (mdIdx === -1) throw new EngineValidationError('deck semantic edit requires a Slidev deck');

    const nodes = collectDeckTextNodes(head.source[mdIdx]!.content);
    const mapping = await llmUnifyDeckText(nodes, instruction);
    const current = new Map(nodes.map((n) => [n.nodeId, n.text]));
    const ops = Object.entries(mapping)
      .filter(([id, text]) => current.has(id) && text && text !== current.get(id))
      .map(([nodeId, text]) => ({ op: 'replaceText' as const, nodeId, payload: { text } }));
    if (!ops.length) {
      annotation.ambiguityReason = 'LLM 未提出整册可统一的文字改动，请换个更明确的统一意见';
      await repo.putAnnotation(annotation);
      await emitEvent(this.store, 'target.ambiguous', project.id, {
        annotationId: annotation.id,
        reason: 'deck_semantic_no_change',
      });
      return { annotation };
    }

    const allowedNodeIds = ops.map((o) => o.nodeId);
    const intent = {
      id: idFactory('edit'),
      projectId: project.id,
      baseRevisionId: head.id,
      kind: 'content' as const,
      scope: 'multi' as const,
      targetNodeIds: allowedNodeIds,
      instruction,
      operations: ops,
      confidence: 0.85,
      rationale: 'LLM deck-wide semantic unification',
      allowedNodeIds,
    };
    assertValid(intent, editIntentSchema, 'EditIntent');

    const result = applySlidevEditIntent(head.source, intent);
    if (!result.collateral.ok) {
      throw new EngineValidationError(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
    }
    const nextSource = result.source;
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `deck unify (${ops.length} nodes)`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      editIntentId: intent.id,
      patchSummary: `deckSemanticUnify(nodes=${ops.length})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodesIdx = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes: nodesIdx, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;
    await repo.putEditIntent(intent);

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'deck-semantic-unify',
      nodes: ops.length,
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * PPT skill — deck-wide *visual style preset*. A framed instruction like
   *「整册改成科技风 / 党政风 / 商务简约」sets `aoStyle` in the frontmatter, which the
   * preview turns into a whole-deck restyle (font + palette + cover + bullets).
   * One revision, fully undoable; structure / data-ao-id untouched (CSS only).
   */
  private async deckStyleEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    styleId: string,
  ): Promise<{ annotation: Annotation; revision: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const mdIdx = head.source.findIndex((f) => f.path === SLIDES_MD);
    if (mdIdx === -1) throw new EngineValidationError('deck style requires a Slidev deck');

    const md = setDeckStyleInFrontmatter(head.source[mdIdx]!.content, styleId);
    const nextSource = head.source.map((f, i) => (i === mdIdx ? { ...f, content: md } : { ...f }));
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `deck style ${styleId}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      patchSummary: `deckStyle(${styleId})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'deck-style',
      style: styleId,
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * Element-level visual micro-tweak (线粗/居中/字号/间距/描边/标红…). A common phrase
   * resolves deterministically; anything else asks GLM for a small whitelisted
   * inline-style map, which is merged onto the framed node via a scoped setAttr
   * (collateral-checked). Nothing else changes. If no safe property is produced
   * the annotation stays located-but-unresolved (no empty commit).
   */
  private async localStyleEdit(
    project: Project,
    head: Revision,
    annotation: Annotation,
    nodeId: string,
    instruction: string,
  ): Promise<{ annotation: Annotation; revision?: Revision }> {
    const { repo, store, idFactory, clock } = this.deps();
    const isImage = nodeIsImage(head.source, nodeId);

    let styleMap = deterministicStyleOps(instruction);
    // Reliable size nudge → a concrete vw based on the node's role (avoids the
    // font-size:larger-shrinks-a-vw-title trap).
    const factor = sizeNudgeFactor(instruction);
    if (factor !== 1 && !styleMap['font-size']) {
      styleMap = { ...styleMap, 'font-size': `${(roleBaseFontVw(nodeTag(head.source, nodeId)) * factor).toFixed(2)}vw` };
    }
    if (Object.keys(styleMap).length === 0 && llmEditEnabled()) {
      styleMap = await llmStyleEdit(
        nodeCurrentStyle(head.source, nodeId),
        nodeCurrentText(head.source, nodeId),
        instruction,
        { isImage },
      );
    }
    styleMap = sanitizeStyleMap(styleMap);
    if (Object.keys(styleMap).length === 0) {
      annotation.ambiguityReason = '没读懂要调整的视觉属性，换个说法（如「居中 / 字大一点 / 这条线细一点 / 标题标红」）';
      await repo.putAnnotation(annotation);
      await emitEvent(this.store, 'target.ambiguous', project.id, { annotationId: annotation.id, reason: 'style_no_op' });
      return { annotation };
    }

    const mergedStyle = mergeInlineStyle(nodeCurrentStyle(head.source, nodeId), styleMap);
    const intent = buildSetAttrIntent(
      {
        id: idFactory('edit'),
        projectId: project.id,
        baseRevisionId: head.id,
        kind: 'content',
        scope: 'local',
        targetNodeIds: [nodeId],
        instruction,
        confidence: 0.9,
        rationale: 'element visual style tweak',
      },
      nodeId,
      { style: mergedStyle },
    );
    assertValid(intent, editIntentSchema, 'EditIntent');

    const result = applySlidevEditIntent(head.source, intent);
    if (!result.collateral.ok) {
      throw new EngineValidationError(`Collateral change: ${result.collateral.unexpectedChanged.join(',')}`);
    }
    const nextSource = result.source;
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `style ${nodeId}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      editIntentId: intent.id,
      patchSummary: `setStyle(${nodeId}; ${Object.keys(styleMap).join(',')})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;
    await repo.putEditIntent(intent);

    const committed = await commitRendered(repo, project, revision, clock);
    annotation.status = 'resolved';
    annotation.resolvedRevisionId = committed.revision.id;
    await repo.putAnnotation(annotation);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'style',
      props: Object.keys(styleMap),
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { annotation, revision: committed.revision };
  }

  /**
   * User-driven "insert image / reference image" for Slidev decks: adds a new
   * editable `<img>` element to a slide (at the end, or right after an anchor
   * node), re-renders, rebuilds the box map and commits a revision. The new
   * image is immediately box-selectable and recolorable via the normal edit
   * path — the same node id flows through boxmap + annotate.
   */
  async addImageElement(projectId: string, body: unknown): Promise<{ revision: Revision; nodeId: string }> {
    assertValid(body, imageInsertSchema, 'imageInsert');
    const input = body as {
      page: number;
      src?: string;
      alt?: string;
      afterNodeId?: string;
      colorCard?: { hex: string; label?: string };
    };
    const project = await this.requireProject(projectId);
    if (project.kind !== 'presentation') {
      throw new EngineValidationError('插入图片目前仅支持演示文稿（Slidev）');
    }
    if (!project.headRevisionId) throw new EngineValidationError('No head revision');
    const head = await this.repo.getRevision(project.headRevisionId);
    if (!head) throw new EngineNotFoundError(`Revision not found: ${project.headRevisionId}`);
    const mdFile = head.source.find((f) => f.path === SLIDES_MD);
    if (!mdFile) throw new EngineValidationError('当前文档不是 Slidev 源，无法插入图片');

    const src = this.resolveInsertedImageSrc(input);
    const alt = (input.alt ?? '插图').slice(0, 200);
    const slideId = `slide-${input.page}`;
    const shortId = this.idFactory('el').replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'img';
    const nodeId = `${slideId}-img-${shortId}`;
    const imgHtml = imageElementHtml(nodeId, src, alt);

    const newMd = insertImageIntoSlideMarkdown(mdFile.content, {
      slideId,
      afterNodeId: input.afterNodeId,
      imgHtml,
      file: SLIDES_MD,
    });
    const nextSource = head.source.map((f) => (f.path === SLIDES_MD ? { ...f, content: newMd } : { ...f }));

    const { repo, store, idFactory, clock } = this.deps();
    const renderBuffer = await this.fittedPreviewBuffer(nextSource);
    const boxes = await buildSlidevDeckBoxes(nextSource);
    const revision = buildRevision({
      project,
      source: nextSource,
      origin: 'edit',
      label: `insert image ${nodeId}`,
      renderStatus: 'rendered',
      renderMime: 'text/html',
      patchSummary: `insertImage(${nodeId})`,
      idFactory,
      clock,
    });
    revision.renderPath = await store.writeRender(project.id, `${revision.id}.html`, renderBuffer);
    const nodes = [...indexNodes(project, nextSource).values()];
    const map: SourceMap = { id: idFactory('map'), revisionId: revision.id, nodes, boxes };
    await repo.putSourceMap(map);
    revision.sourceMapId = map.id;
    const committed = await commitRendered(repo, project, revision, clock);
    await emitEvent(this.store, 'edit.applied', project.id, {
      revisionId: committed.revision.id,
      action: 'insert-image',
      nodeId,
    });
    await emitEvent(this.store, 'revision.committed', project.id, { revisionId: committed.revision.id });
    return { revision: committed.revision, nodeId };
  }

  /** Resolve the src for an inserted image: explicit data/URL, colorCard, or a
   *  neutral placeholder. Rejects anything that isn't an image data URI or http(s). */
  private resolveInsertedImageSrc(input: { src?: string; colorCard?: { hex: string; label?: string } }): string {
    if (input.colorCard?.hex) {
      return colorCardDataUri(normalizeHex(input.colorCard.hex), input.colorCard.label ?? '插图');
    }
    const src = (input.src ?? '').trim();
    if (src) {
      if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i.test(src)) return src;
      if (/^https?:\/\/[^\s"'<>]+$/i.test(src)) return src;
      throw new EngineValidationError('图片来源需为 data:image/* 或 http(s) 链接');
    }
    return colorCardDataUri('#4f63e6', '示意图');
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
    const mime = rev.renderMime ?? 'application/octet-stream';
    let buffer = await this.store.readRender(rev.renderPath);
    if (mime.includes('html')) {
      const html = buffer.toString('utf-8');
      if (html.includes('ao-slide') && !isPreviewFitted(html)) {
        const fitted = await fitPreviewHtml(html);
        buffer = Buffer.from(fitted.html, 'utf-8');
        const name = rev.renderPath.split(/[/\\]/).pop();
        if (name) {
          await this.store.writeRender(rev.projectId, name, buffer).catch(() => {});
        }
      }
    }
    return { buffer, mime };
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

  async exportProject(
    projectId: string,
    format: 'html' | 'pdf' | 'pptx',
    opts: { withClicks?: boolean; editable?: boolean } = {},
  ) {
    const project = await this.requireProject(projectId);
    if (!project.headRevisionId) throw new EngineValidationError('No document to export');
    const head = await this.repo.getRevision(project.headRevisionId);
    if (!head?.renderPath) throw new EngineNotFoundError('Head render missing');

    if (project.kind === 'pdf') {
      const buffer = await this.store.readRender(head.renderPath);
      return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
    }

    const isSlidev = head.source.some((f) => f.path === SLIDES_MD);
    // WYSIWYG export: render the *exact preview HTML* (the Metropolis-themed deck
    // the user sees at /aoide/) with headless Chromium, so PDF/PPTX look identical
    // to the live preview — deep gradient cover, frame-title rule, accent bullets,
    // page numbers and MathML formulas all reproduced (the bare Slidev default
    // theme the CLI produced no longer matches what the user sees).
    // `withClicks` is opt-in (route `?clicks=1`): it expands each Slidev v-click
    // step into its own page/slide (S7). The default report keeps one page per
    // slide with everything revealed — i.e. exactly what the website shows.
    const withClicks = opts.withClicks ?? false;
    const html = await this.htmlForExport(head);

    if (format === 'html') {
      if (isSlidev) {
        const md = head.source.find((f) => f.path === SLIDES_MD)!.content;
        return { buffer: Buffer.from(md, 'utf-8'), mime: 'text/markdown', filename: `${project.name}.md` };
      }
      return { buffer: Buffer.from(html, 'utf-8'), mime: 'text/html', filename: `${project.name}.html` };
    }

    // Text-layout gate on the same fitted HTML we are about to export. Kind-only
    // facts always pass auditTextLayout — measure or the gate is theater.
    if (!html.trim()) {
      throw new EngineValidationError('文本版式预检失败：缺少可测量的演示文稿 HTML');
    }
    const textLayout = await runTextLayoutPreflight(html);
    if (!textLayout.ok) {
      throw new EngineValidationError(
        `文本版式预检失败：${textLayout.audit.findings
          .filter((f) => f.severity === 'hard')
          .map((f) => f.message)
          .join('；')}`,
      );
    }
    if (format === 'pdf') {
      // Default: a *vector* page.pdf of the exact preview HTML → looks like /aoide/ AND
      // keeps selectable/searchable text (small file, crisp at any zoom). The opt-in
      // `?clicks=1` path uses screenshots so each v-click step becomes its own page
      // (step-by-step reveal can't be a single vector render).
      const buffer = withClicks
        ? await exportDeckPdfWysiwyg(html, { withClicks: true })
        : await exportDeckPdfVector(html);
      return { buffer, mime: 'application/pdf', filename: `${project.name}.pdf` };
    }

    // PPTX — default is image-based WYSIWYG. Opt-in native text frames via
    // `opts.editable` or AUTOOFFICE_PPTX_EDITABLE=1 (scientific-illustrator track).
    const wantEditable = opts.editable === true || isEditablePptxExportEnabled();
    if (wantEditable) {
      const spec = deckSpecFromAoHtml(html);
      if (spec.slides.length > 0) {
        const buffer = await renderEditablePptx(spec);
        return {
          buffer,
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          filename: `${project.name}.pptx`,
        };
      }
    }
    const buffer = await exportDeckPptxWysiwyg(html, { withClicks });
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
