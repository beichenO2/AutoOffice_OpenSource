import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { outerHtmlMap } from '../../src/engine/html/dom.js';
import * as compileMod from '../../src/engine/latex/compile.js';

const hasXelatex = spawnSync('xelatex', ['--version'], { stdio: 'pipe' }).status === 0;

let dir: string;
let svc: EngineService;

beforeEach(async () => {
  process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
  process.env.AUTOOFFICE_PPT_SOT = 'html';
  process.env.AUTOOFFICE_BOXMAP = 'estimate';
  dir = await mkdtemp(join(tmpdir(), 'aoide-e2e-'));
  svc = new EngineService({
    root: dir,
    idFactory: createDeterministicIdFactory('e2e'),
    clock: fixedClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('engine E2E — presentation HTML', () => {
  it('requirement → deck → box edit → undo restores prior text', async () => {
    const { project } = await svc.createProject('季度汇报', 'presentation');
    const { task } = await svc.postRequirement(project.id, '做一份季度业务汇报，包含数据和对比分析');
    expect(task.status).toBe('completed');
    const overview = await svc.getOverview(project.id);
    expect(overview.project.headRevisionId).toBeTruthy();
    const head = overview.revisions.at(-1)!;
    const before = outerHtmlMap(head.source[0]!.content);

    const { boxes } = await svc.getBoxes(head.id, 2);
    const target = boxes.find((b) => b.nodeId === 'slide-2-b0');
    expect(target).toBeTruthy();
    // Framed rect must intersect the server SourceBox (directNodeId is only a hint).
    const rectNorm = {
      x: target!.x,
      y: target!.y,
      w: Math.max(0.02, target!.w),
      h: Math.max(0.02, target!.h),
    };

    const edited = await svc.createAnnotation(project.id, {
      page: 2,
      rectNorm,
      viewport: { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 1280, pageHeightPx: 720 },
      instruction: '改为「HTML 源可框选并定点修改」',
      directNodeId: 'slide-2-b0',
      revisionId: head.id,
    });
    expect(edited.revision).toBeTruthy();

    const afterOverview = await svc.getOverview(project.id);
    const afterHead = afterOverview.revisions.at(-1)!;
    const after = outerHtmlMap(afterHead.source[0]!.content);
    expect(after.get('slide-2-b0')).toContain('HTML 源可框选并定点修改');
    expect(after.get('slide-2-b1')).toBe(before.get('slide-2-b1'));

    const undone = await svc.undo(project.id);
    expect(undone?.project.headRevisionId).not.toBe(afterHead.id);
  });

  it('ambiguous requirement surfaces proposal before generation', async () => {
    const { project } = await svc.createProject('风格演示', 'presentation');
    const { task } = await svc.postRequirement(project.id, '做汇报，风格更正式一点');
    expect(task.status).toBe('awaiting_user_choice');
    expect(task.proposalIds.length).toBeGreaterThan(0);
    const proposal = await svc.repo.getProposal(task.proposalIds[0]!);
    const { task: chosen } = await svc.chooseProposal(proposal!.id, proposal!.recommendedOptionId);
    expect(chosen.status).toBe('completed');
  });
});

const pdfViewport = {
  zoom: 1,
  rotation: 0,
  dpr: 1,
  pageWidthPx: 800,
  pageHeightPx: 1100,
};

describe.skipIf(!hasXelatex)('engine E2E — PDF LaTeX', () => {
  it('generates PDF and keeps last-good revision', async () => {
    const { project } = await svc.createProject('论文草稿', 'pdf');
    const { task } = await svc.postRequirement(project.id, '写一份简短报告，包含数据表');
    expect(task.status).toBe('completed');
    const overview = await svc.getOverview(project.id);
    expect(overview.project.lastGoodRevisionId).toBeTruthy();
    const render = await svc.getRevisionRender(overview.project.headRevisionId!);
    expect(render.mime).toBe('application/pdf');
    expect(render.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('requirement → PDF → box edit → undo restores prior LaTeX', async () => {
    const { project } = await svc.createProject('PDF框选', 'pdf');
    const { task } = await svc.postRequirement(project.id, '写一份简短报告，包含数据表');
    expect(task.status).toBe('completed');
    const overview = await svc.getOverview(project.id);
    const head = overview.revisions.at(-1)!;
    const beforeTex = head.source[0]!.content;

    const { boxes } = await svc.getBoxes(head.id, 1);
    const target =
      boxes.find((b) => b.nodeId === 'para-detail') ??
      boxes.find((b) => b.type === 'paragraph' || b.nodeId.startsWith('para-'));
    expect(target).toBeTruthy();

    const rectNorm = {
      x: target!.x,
      y: target!.y,
      w: Math.max(0.02, target!.w),
      h: Math.max(0.02, target!.h),
    };

    const edited = await svc.createAnnotation(project.id, {
      page: target!.page,
      rectNorm,
      viewport: pdfViewport,
      instruction: '改为「PDF 服务层框选已验证修改」',
      directNodeId: target!.nodeId,
      revisionId: head.id,
    });
    expect(edited.revision).toBeTruthy();
    const afterTex = edited.revision!.source[0]!.content;
    expect(afterTex).toContain('PDF 服务层框选已验证修改');
    expect(afterTex).not.toBe(beforeTex);

    const undone = await svc.undo(project.id);
    expect(undone?.project.headRevisionId).toBe(head.id);
  });

  it('rebuilds SyncTeX map for legacy PDF revision without sourceMapId', async () => {
    const { project } = await svc.createProject('旧PDF映射', 'pdf');
    const { task } = await svc.postRequirement(project.id, '写一份简短报告');
    expect(task.status).toBe('completed');
    const overview = await svc.getOverview(project.id);
    const head = overview.revisions.at(-1)!;
    const mapId = head.sourceMapId!;
    expect(mapId).toBeTruthy();

    const legacy = { ...head, sourceMapId: undefined };
    await svc.repo.putRevision(legacy);

    const { boxes } = await svc.getBoxes(head.id, 1);
    expect(boxes.length).toBe(0);

    const seedMap = await svc.repo.getSourceMap(mapId);
    const target = seedMap?.boxes.find((b) => b.nodeId === 'para-detail') ?? seedMap?.boxes[0];
    expect(target).toBeTruthy();

    const rectNorm = {
      x: target!.x,
      y: target!.y,
      w: Math.max(0.02, target!.w),
      h: Math.max(0.02, target!.h),
    };

    const result = await svc.createAnnotation(project.id, {
      page: target!.page,
      rectNorm,
      viewport: pdfViewport,
      instruction: '改为「旧版映射重建成功」',
      revisionId: head.id,
    });
    expect(result.mapping).not.toBe('unavailable');
    expect(result.revision).toBeTruthy();
    expect(result.revision!.source[0]!.content).toContain('旧版映射重建成功');
    expect(result.revision!.sourceMapId).toBeTruthy();
  }, 120000);
});

describe('engine E2E — Slidev SoT', () => {
  beforeEach(() => {
    process.env.AUTOOFFICE_PPT_SOT = 'slidev';
  });

  afterEach(() => {
    delete process.env.AUTOOFFICE_PPT_SOT;
  });

  it('requirement → slides.md → box edit → undo restores prior bullet', async () => {
    const { project } = await svc.createProject('Slidev汇报', 'presentation');
    const { task } = await svc.postRequirement(project.id, '做一份季度业务汇报，包含数据和对比分析');
    expect(task.status).toBe('completed');
    const overview = await svc.getOverview(project.id);
    const head = overview.revisions.at(-1)!;
    expect(head.source.some((f) => f.path === 'slides.md')).toBe(true);
    const before = head.source.find((f) => f.path === 'slides.md')!.content;

    const { boxes } = await svc.getBoxes(head.id, 2);
    const target = boxes.find((b) => b.nodeId === 'slide-2-b0');
    expect(target).toBeTruthy();
    const rectNorm = {
      x: target!.x,
      y: target!.y,
      w: Math.max(0.02, target!.w),
      h: Math.max(0.02, target!.h),
    };

    const edited = await svc.createAnnotation(project.id, {
      page: 2,
      rectNorm,
      viewport: { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 1280, pageHeightPx: 720 },
      instruction: '改为「Slidev 源可框选并定点修改」',
      directNodeId: 'slide-2-b0',
      revisionId: head.id,
    });
    expect(edited.revision).toBeTruthy();
    const after = edited.revision!.source.find((f) => f.path === 'slides.md')!.content;
    expect(after).toContain('Slidev 源可框选并定点修改');
    expect(after).toContain('data-ao-id="slide-2-b1"');
    expect(after).not.toBe(before);

    const undone = await svc.undo(project.id);
    expect(undone?.project.headRevisionId).toBe(head.id);
  });
});
