/**
 * U5b — measured overflow facts survive buildDocumentFacts mapping,
 * and runTextLayoutPreflight fail-closes on hard overflow.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixedClock } from '../../src/engine/clock.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { buildDocumentFacts } from '../../src/engine/orchestrator.js';
import { closeRenderBrowser } from '../../src/engine/render/deck.js';
import { EngineService } from '../../src/engine/service.js';
import {
  elementFactFromMeasuredBox,
  runPreflight,
  runTextLayoutPreflight,
} from '../../src/engine/standards/preflight.js';
import { PREVIEW_FITTED_ATTR } from '../../src/engine/text-fit.js';
import type { Project, Revision } from '../../src/engine/types.js';
import type { DocumentElementFact, DocumentFacts } from '../../src/engine/standards/types.js';
import { makeRule } from './standards/helpers.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');

const CLIP_TEXT = '这是一段故意写得很长很长很长很长很长很长很长很长很长很长用来撑破窄单元格的中文';

function measureFixture(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
</style></head>
<body>
<div class="ao-slide">
  <div data-ao-id="clip" data-ao-type="text" style="position:absolute;left:80px;top:80px;width:160px;height:36px;overflow:hidden;font:24px/1.3 sans-serif;white-space:nowrap">${CLIP_TEXT}</div>
  <div data-ao-id="ok" data-ao-type="text" style="position:absolute;left:80px;top:200px;width:400px;height:48px;overflow:hidden;font:16px/1.3 sans-serif">短句</div>
</div>
</body></html>`;
}

function stubProject(): Project {
  return {
    id: 'p_wire',
    name: 'wire',
    kind: 'presentation',
    language: 'html',
    headRevisionId: null,
    lastGoodRevisionId: null,
    createdAt: 't0',
    updatedAt: 't0',
    undoStack: [],
    redoStack: [],
  };
}

function overflowFacts(extra: Partial<DocumentElementFact> = {}): DocumentFacts {
  return {
    kind: 'presentation',
    elements: [
      {
        nodeId: 'clip',
        type: 'text',
        page: 1,
        boxNorm: { x: 0.2, y: 0.2, w: 0.3, h: 0.15 },
        ...extra,
      },
    ],
  };
}

afterAll(async () => {
  await closeRenderBrowser();
});

describe('elementFactFromMeasuredBox — overflow fields survive mapping', () => {
  it('copies contentBoxNorm and scrollOverflow onto DocumentElementFact', () => {
    const fact = elementFactFromMeasuredBox({
      nodeId: 'clip',
      page: 1,
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.15,
      contentBoxNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.15 },
      scrollOverflow: true,
    });
    expect(fact.boxNorm).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.15 });
    expect(fact.contentBoxNorm).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.15 });
    expect(fact.scrollOverflow).toBe(true);
    expect(fact.nodeId).toBe('clip');
    expect(fact.page).toBe(1);
  });

  it('omits overflow fields when measure did not set them', () => {
    const fact = elementFactFromMeasuredBox({
      nodeId: 'ok',
      page: 2,
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.15,
    });
    expect(fact.contentBoxNorm).toBeUndefined();
    expect(fact.scrollOverflow).toBeUndefined();
  });

  it('preserves scrollOverflow=false from a clean measure', () => {
    const fact = elementFactFromMeasuredBox({
      nodeId: 'ok',
      page: 1,
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.15,
      scrollOverflow: false,
    });
    expect(fact.scrollOverflow).toBe(false);
  });
});

describe('runTextLayoutPreflight — fail-closed on hard overflow', () => {
  it('fails when scrollOverflow is true', () => {
    const result = runTextLayoutPreflight(overflowFacts({ scrollOverflow: true }));
    expect(result.ok).toBe(false);
    expect(result.audit.findings.some((f) => f.category === 'text-overflow' && f.severity === 'hard')).toBe(
      true,
    );
  });

  it('fails when contentBoxNorm exceeds the cell', () => {
    const result = runTextLayoutPreflight(
      overflowFacts({
        contentBoxNorm: { x: 0.2, y: 0.2, w: 0.5, h: 0.15 },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.audit.findings.some((f) => f.category === 'text-overflow')).toBe(true);
  });

  it('passes a well-fitted measured box', () => {
    const result = runTextLayoutPreflight(
      overflowFacts({
        boxNorm: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
        contentBoxNorm: { x: 0.11, y: 0.11, w: 0.35, h: 0.15 },
        scrollOverflow: false,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.audit.findings.filter((f) => f.severity === 'hard')).toEqual([]);
  });
});

describe('runPreflight text_overflow — uses measured overflow fields', () => {
  it('fail-closes when scrollOverflow is on the fact', () => {
    const report = runPreflight(
      {
        rules: [
          makeRule({
            id: 'r_overflow',
            target: 'text_overflow',
            constraint: { maxChars: 400 },
            severity: 'error',
            level: 'mandatory',
          }),
        ],
        overrides: [],
        conflicts: [],
        profileIds: ['p_wire'],
      },
      overflowFacts({ scrollOverflow: true }),
    );
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => !f.ok && f.nodeId === 'clip')).toBe(true);
  });
});

describe('buildDocumentFacts — maps measure overflow onto facts', () => {
  it('keeps clip overflow fields so preflight helper hard-fails', async () => {
    const facts = await buildDocumentFacts(stubProject(), measureFixture());
    const clip = facts.elements?.find((el) => el.nodeId === 'clip');
    const ok = facts.elements?.find((el) => el.nodeId === 'ok');
    expect(clip).toBeDefined();
    expect(ok).toBeDefined();

    const clipOverflows =
      clip!.scrollOverflow === true ||
      (clip!.contentBoxNorm !== undefined &&
        clip!.boxNorm !== undefined &&
        (clip!.contentBoxNorm.w > clip!.boxNorm.w + 0.001 ||
          clip!.contentBoxNorm.h > clip!.boxNorm.h + 0.001));
    expect(clipOverflows).toBe(true);
    expect(ok!.scrollOverflow ?? false).toBe(false);

    const result = runTextLayoutPreflight(facts);
    expect(result.ok).toBe(false);
    expect(result.audit.findings.some((f) => f.category === 'text-overflow' && f.nodeIds.includes('clip'))).toBe(
      true,
    );
  }, 30_000);
});

/**
 * WHY: empty `{kind}` facts always pass auditTextLayout. Revert of the export
 * hook would make this green-path succeed again (theater gate).
 */
describe('exportProject — hooked text-layout preflight fails on clip fixture', () => {
  let dir: string;
  let svc: EngineService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ao-text-layout-wire-'));
    svc = new EngineService({
      root: dir,
      idFactory: createDeterministicIdFactory('wire'),
      clock: fixedClock(1_700_000_000_000),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function plantClipHead(): Promise<Project> {
    const { project } = await svc.createProject('clip-export', 'presentation');
    const html = measureFixture();
    const rev: Revision = {
      id: 'rev_clip',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'generation',
      createdAt: 't0',
      sourceHash: 'clip',
      source: [{ path: 'deck.html', language: 'html', content: html }],
      renderPath: await svc.store.writeRender(project.id, 'rev_clip.html', Buffer.from(html, 'utf-8')),
      renderMime: 'text/html',
      renderStatus: 'rendered',
      label: 'clip fixture',
    };
    await svc.repo.putRevision(rev);
    project.headRevisionId = rev.id;
    project.lastGoodRevisionId = rev.id;
    await svc.repo.putProject(project);
    return project;
  }

  it('rejects pdf export when the head HTML clips text', async () => {
    const project = await plantClipHead();
    await expect(svc.exportProject(project.id, 'pdf')).rejects.toThrow(/文本版式预检失败.*clip/);
  }, 30_000);

  it('preflights fitted bytes when the render already has PREVIEW_FITTED_ATTR', async () => {
    const { project } = await svc.createProject('fitted-wire', 'presentation');
    const clip = measureFixture();
    const fittedOk = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
</style></head>
<body ${PREVIEW_FITTED_ATTR}="1">
<div class="ao-slide">
  <div data-ao-id="ok" data-ao-type="text" style="position:absolute;left:80px;top:200px;width:400px;height:48px;overflow:hidden;font:16px/1.3 sans-serif">短句</div>
</div>
</body></html>`;
    const rev: Revision = {
      id: 'rev_fitted_wire',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'generation',
      createdAt: 't0',
      sourceHash: 'fitted-wire',
      source: [{ path: 'deck.html', language: 'html', content: clip }],
      renderPath: await svc.store.writeRender(project.id, 'rev_fitted_wire.html', Buffer.from(fittedOk, 'utf-8')),
      renderMime: 'text/html',
      renderStatus: 'rendered',
      label: 'fitted render vs clip source',
    };
    await svc.repo.putRevision(rev);
    project.headRevisionId = rev.id;
    project.lastGoodRevisionId = rev.id;
    await svc.repo.putProject(project);

    const pdf = await svc.exportProject(project.id, 'pdf');
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);
});
