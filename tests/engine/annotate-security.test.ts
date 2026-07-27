/**
 * Box-select safety gates: high-confidence margin, untrusted directNodeId,
 * revision consistency, and mapping_unavailable for unmapped PDF revisions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EngineService, setEngineServiceForTests } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { isHighConfidence, rankByRect } from '../../src/engine/html/hit-test.js';
import { resolveAnnotationCandidates } from '../../src/engine/orchestrator.js';
import type { Project, Revision, SourceBox } from '../../src/engine/types.js';

const viewport = {
  zoom: 1,
  rotation: 0,
  dpr: 1,
  pageWidthPx: 1280,
  pageHeightPx: 720,
};

describe('isHighConfidence gate', () => {
  it('rejects two adjacent high-score hits when margin < 0.2', () => {
    const candidates = rankByRect(
      { x: 0.05, y: 0.05, w: 0.9, h: 0.4 },
      [
        { nodeId: 'a', type: 'paragraph', page: 1, rect: { x: 0.1, y: 0.1, w: 0.35, h: 0.2 } },
        { nodeId: 'b', type: 'paragraph', page: 1, rect: { x: 0.5, y: 0.1, w: 0.35, h: 0.2 } },
      ],
      1,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(0.6);
    expect(isHighConfidence(candidates)).toBe(false);
  });

  it('accepts a single clear high-score hit', () => {
    const candidates = rankByRect(
      { x: 0.1, y: 0.1, w: 0.4, h: 0.25 },
      [{ nodeId: 'only', type: 'heading', page: 1, rect: { x: 0.12, y: 0.12, w: 0.3, h: 0.15 } }],
      1,
    );
    expect(isHighConfidence(candidates)).toBe(true);
  });
});

describe('directNodeId is untrusted hint', () => {
  const project = {
    id: 'p1',
    kind: 'presentation',
  } as Project;

  const head = {
    id: 'rev1',
    projectId: 'p1',
    source: [
      {
        path: 'deck.html',
        language: 'html',
        content: `<section class="ao-slide" data-ao-id="s1" data-ao-type="slide">
          <h1 data-ao-id="t1" data-ao-type="heading">Title</h1>
          <p data-ao-id="p1" data-ao-type="paragraph">Body</p>
        </section>`,
      },
    ],
  } as Revision;

  const boxes: SourceBox[] = [
    { nodeId: 't1', page: 1, x: 0.1, y: 0.1, w: 0.4, h: 0.15, type: 'heading', label: '标题' },
    { nodeId: 'p1', page: 1, x: 0.1, y: 0.4, w: 0.5, h: 0.2, type: 'paragraph', label: '段落' },
    { nodeId: 'p1', page: 2, x: 0.1, y: 0.4, w: 0.5, h: 0.2, type: 'paragraph', label: '段落·页2' },
  ];

  it('ignores cross-page directNodeId and re-ranks on requested page', () => {
    const ranked = resolveAnnotationCandidates({
      project,
      head,
      page: 1,
      rectNorm: { x: 0.08, y: 0.35, w: 0.55, h: 0.3 },
      boxes,
      domNodeId: 'p1', // exists on page 2 box too — page-scoped boxOf must match page 1
    });
    // p1 on page 1 intersects → may accept; forge a wrong-page-only id instead
    const cross = resolveAnnotationCandidates({
      project,
      head,
      page: 1,
      rectNorm: { x: 0.08, y: 0.35, w: 0.55, h: 0.3 },
      boxes: boxes.filter((b) => !(b.nodeId === 'p1' && b.page === 1)),
      domNodeId: 'p1',
    });
    expect(cross.every((c) => c.reason !== 'direct DOM hit (server-verified)')).toBe(true);
    expect(ranked[0]?.nodeId).toBeTruthy();
  });

  it('ignores stale id that does not intersect the framed rect', () => {
    const ranked = resolveAnnotationCandidates({
      project,
      head,
      page: 1,
      rectNorm: { x: 0.08, y: 0.35, w: 0.55, h: 0.3 }, // around paragraph
      boxes,
      domNodeId: 't1', // heading does not intersect
    });
    expect(ranked[0]?.nodeId).toBe('p1');
    expect(ranked[0]?.reason).not.toContain('direct DOM hit');
  });

  it('ignores forged node id absent from the revision', () => {
    const ranked = resolveAnnotationCandidates({
      project,
      head,
      page: 1,
      rectNorm: { x: 0.08, y: 0.05, w: 0.5, h: 0.25 },
      boxes,
      domNodeId: 'evil-forged-id',
    });
    expect(ranked.every((c) => c.nodeId !== 'evil-forged-id')).toBe(true);
  });
});

describe('EngineService annotation gates', () => {
  let root = '';
  let svc: EngineService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aoide-ann-'));
    svc = new EngineService({
      root,
      idFactory: createDeterministicIdFactory('ann'),
      clock: fixedClock(1_700_000_000_000),
    });
    setEngineServiceForTests(svc);
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
  });

  afterEach(async () => {
    setEngineServiceForTests(null);
    delete process.env.AUTOOFFICE_ENGINE_INTERPRETER;
    await rm(root, { recursive: true, force: true });
  });

  it('keeps ambiguous open when two candidates lack margin even if top ≥ 0.6', async () => {
    const { project } = await svc.createProject('安全框选', 'presentation');
    // Seed a revision with two adjacent boxes and known HTML nodes
    const html = `<!doctype html><html><body>
      <section class="ao-slide" data-ao-id="s1" data-ao-type="slide">
        <h1 data-ao-id="h1" data-ao-type="heading">A</h1>
        <h2 data-ao-id="h2" data-ao-type="heading">B</h2>
      </section></body></html>`;
    const rev: Revision = {
      id: 'rev_seed',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'generation',
      createdAt: svc['clock'](),
      sourceHash: 'x',
      source: [{ path: 'deck.html', language: 'html', content: html }],
      renderStatus: 'rendered',
      renderMime: 'text/html',
      label: 'seed',
      sourceMapId: 'map_seed',
    };
    const boxes: SourceBox[] = [
      { nodeId: 'h1', page: 1, x: 0.1, y: 0.1, w: 0.35, h: 0.2, type: 'heading', label: '标题 A' },
      { nodeId: 'h2', page: 1, x: 0.5, y: 0.1, w: 0.35, h: 0.2, type: 'heading', label: '标题 B' },
    ];
    await svc.repo.putSourceMap({
      id: 'map_seed',
      revisionId: rev.id,
      nodes: [
        { id: 'h1', type: 'heading', range: { file: 'deck.html', start: 0, end: 1 }, page: 1 },
        { id: 'h2', type: 'heading', range: { file: 'deck.html', start: 2, end: 3 }, page: 1 },
      ],
      boxes,
    });
    await svc.repo.putRevision(rev);
    project.headRevisionId = rev.id;
    project.lastGoodRevisionId = rev.id;
    await svc.repo.putProject(project);

    const result = await svc.createAnnotation(project.id, {
      page: 1,
      rectNorm: { x: 0.05, y: 0.05, w: 0.9, h: 0.4 },
      viewport,
      instruction: '改成「合并标题」',
    });
    expect(result.revision).toBeUndefined();
    expect(result.annotation.status === 'open' || result.annotation.status === 'ambiguous').toBe(true);
    expect(result.annotation.ambiguityReason).toMatch(/分差|置信度/);
    expect(result.annotation.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns mapping_unavailable for PDF revision without source/map rebuild path', async () => {
    const { project } = await svc.createProject('旧PDF', 'pdf');
    const rev: Revision = {
      id: 'rev_old_pdf',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'migration',
      createdAt: svc['clock'](),
      sourceHash: 'empty',
      source: [], // no LaTeX → cannot rebuild
      renderStatus: 'rendered',
      renderMime: 'application/pdf',
      label: 'legacy',
    };
    await svc.repo.putRevision(rev);
    project.headRevisionId = rev.id;
    project.lastGoodRevisionId = rev.id;
    await svc.repo.putProject(project);

    const result = await svc.createAnnotation(project.id, {
      page: 1,
      rectNorm: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 },
      viewport,
      instruction: '改成「新内容」',
      revisionId: rev.id,
    });
    expect(result.mapping).toBe('unavailable');
    expect(result.annotation.ambiguityReason).toMatch(/mapping_unavailable|重新生成映射/);
    expect(result.annotation.candidates).toEqual([]);
  });

  it('edits the framed revisionId even when it is not head, producing a new revision', async () => {
    const { project } = await svc.createProject('版本一致', 'presentation');
    const htmlOld = `<!doctype html><html><body>
      <section class="ao-slide" data-ao-id="s1" data-ao-type="slide">
        <p data-ao-id="p_old" data-ao-type="paragraph">旧文</p>
      </section></body></html>`;
    const htmlNew = `<!doctype html><html><body>
      <section class="ao-slide" data-ao-id="s1" data-ao-type="slide">
        <p data-ao-id="p_new" data-ao-type="paragraph">新文</p>
      </section></body></html>`;

    const oldRev: Revision = {
      id: 'rev_old',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'generation',
      createdAt: svc['clock'](),
      sourceHash: 'old',
      source: [{ path: 'deck.html', language: 'html', content: htmlOld }],
      renderStatus: 'rendered',
      renderMime: 'text/html',
      label: 'old',
      sourceMapId: 'map_old',
    };
    const newRev: Revision = {
      id: 'rev_new',
      projectId: project.id,
      baseRevisionId: oldRev.id,
      origin: 'edit',
      createdAt: svc['clock'](),
      sourceHash: 'new',
      source: [{ path: 'deck.html', language: 'html', content: htmlNew }],
      renderStatus: 'rendered',
      renderMime: 'text/html',
      label: 'new',
      sourceMapId: 'map_new',
    };
    await svc.repo.putSourceMap({
      id: 'map_old',
      revisionId: oldRev.id,
      nodes: [{ id: 'p_old', type: 'paragraph', range: { file: 'deck.html', start: 0, end: 10 }, page: 1 }],
      boxes: [{ nodeId: 'p_old', page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2, type: 'paragraph', label: '段落' }],
    });
    await svc.repo.putSourceMap({
      id: 'map_new',
      revisionId: newRev.id,
      nodes: [{ id: 'p_new', type: 'paragraph', range: { file: 'deck.html', start: 0, end: 10 }, page: 1 }],
      boxes: [{ nodeId: 'p_new', page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2, type: 'paragraph', label: '段落' }],
    });
    await svc.repo.putRevision(oldRev);
    await svc.repo.putRevision(newRev);
    project.headRevisionId = newRev.id;
    project.lastGoodRevisionId = newRev.id;
    project.undoStack = [oldRev.id];
    await svc.repo.putProject(project);

    const result = await svc.createAnnotation(project.id, {
      page: 1,
      rectNorm: { x: 0.08, y: 0.08, w: 0.55, h: 0.25 },
      viewport,
      instruction: '改成「从旧版改」',
      revisionId: oldRev.id,
    });
    expect(result.revision).toBeTruthy();
    expect(result.revision!.id).not.toBe(newRev.id);
    const patched = result.revision!.source.find((f) => f.path === 'deck.html')?.content ?? '';
    expect(patched).toContain('从旧版改');
    expect(patched).not.toContain('新文');
    const fresh = await svc.repo.getProject(project.id);
    expect(fresh?.headRevisionId).toBe(result.revision!.id);
  });
});
