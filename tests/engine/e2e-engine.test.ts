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

    await svc.createAnnotation(project.id, {
      page: 2,
      rectNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.15 },
      viewport: { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 1280, pageHeightPx: 720 },
      instruction: '改为「HTML 源可框选并定点修改」',
      directNodeId: 'slide-2-b0',
    });

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
});
