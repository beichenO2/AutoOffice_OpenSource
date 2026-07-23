import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineStore } from '../../src/engine/store.js';
import { Repo } from '../../src/engine/repo.js';
import {
  buildRevision,
  commitRendered,
  saveFailedDraft,
  undo,
  redo,
  assertBaseCurrent,
  StaleBaseError,
} from '../../src/engine/revisions.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import type { Project, SourceFile } from '../../src/engine/types.js';

let dir: string;
let store: EngineStore;
let repo: Repo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aoide-rev-'));
  store = new EngineStore(dir);
  repo = new Repo(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function baseProject(clock: () => string): Project {
  return {
    id: 'p_1',
    name: 'Test',
    kind: 'presentation',
    language: 'html',
    headRevisionId: null,
    lastGoodRevisionId: null,
    createdAt: clock(),
    updatedAt: clock(),
    undoStack: [],
    redoStack: [],
  };
}

const src = (content: string): SourceFile[] => [{ path: 'deck.html', language: 'html', content }];

describe('store — persistence & recovery', () => {
  it('round-trips entities and lists by collection', async () => {
    const ids = createDeterministicIdFactory();
    const clock = fixedClock(0);
    const p = await repo.putProject(baseProject(clock));
    const got = await repo.getProject(p.id);
    expect(got?.id).toBe('p_1');
    // Recreate store (simulate restart) → data still there.
    const store2 = new EngineStore(dir);
    const repo2 = new Repo(store2);
    const recovered = await repo2.getProject('p_1');
    expect(recovered?.name).toBe('Test');
    expect(ids('rev')).toBe('rev_t1');
  });

  it('rejects unsafe ids / render names', async () => {
    await expect(store.get('projects', '../evil')).rejects.toThrow(/Unsafe id/);
    await expect(store.writeRender('p_1', '../escape.pdf', 'x')).rejects.toThrow(/Unsafe render name/);
  });
});

describe('revisions — chain, undo/redo, last-good, stale base', () => {
  it('commits rendered revisions and advances head + last-good', async () => {
    const ids = createDeterministicIdFactory();
    const clock = fixedClock(0);
    let project = await repo.putProject(baseProject(clock));

    const r1 = buildRevision({
      project,
      source: src('<v1/>'),
      origin: 'generation',
      label: 'gen',
      renderStatus: 'rendered',
      renderPath: 'renders/p_1/r1.html',
      idFactory: ids,
      clock,
    });
    ({ project } = await commitRendered(repo, project, r1, clock));
    expect(project.headRevisionId).toBe(r1.id);
    expect(project.lastGoodRevisionId).toBe(r1.id);
    expect(project.undoStack).toEqual([]);

    const r2 = buildRevision({
      project,
      source: src('<v2/>'),
      origin: 'edit',
      label: 'edit',
      renderStatus: 'rendered',
      idFactory: ids,
      clock,
    });
    expect(r2.baseRevisionId).toBe(r1.id);
    ({ project } = await commitRendered(repo, project, r2, clock));
    expect(project.headRevisionId).toBe(r2.id);
    expect(project.undoStack).toEqual([r1.id]);
  });

  it('undo/redo moves head across the chain', async () => {
    const ids = createDeterministicIdFactory();
    const clock = fixedClock(0);
    let project = await repo.putProject(baseProject(clock));
    const r1 = buildRevision({ project, source: src('<v1/>'), origin: 'generation', label: 'gen', renderStatus: 'rendered', idFactory: ids, clock });
    ({ project } = await commitRendered(repo, project, r1, clock));
    const r2 = buildRevision({ project, source: src('<v2/>'), origin: 'edit', label: 'e', renderStatus: 'rendered', idFactory: ids, clock });
    ({ project } = await commitRendered(repo, project, r2, clock));

    const u = await undo(repo, project, clock);
    expect(u?.project.headRevisionId).toBe(r1.id);
    expect(u?.revision?.id).toBe(r1.id);
    project = u!.project;

    const re = await redo(repo, project, clock);
    expect(re?.project.headRevisionId).toBe(r2.id);
    project = re!.project;

    // redo empty now
    expect(await redo(repo, project, clock)).toBeNull();
  });

  it('failed render becomes a draft and preserves last-good head', async () => {
    const ids = createDeterministicIdFactory();
    const clock = fixedClock(0);
    let project = await repo.putProject(baseProject(clock));
    const r1 = buildRevision({ project, source: src('<v1/>'), origin: 'generation', label: 'gen', renderStatus: 'rendered', idFactory: ids, clock });
    ({ project } = await commitRendered(repo, project, r1, clock));

    const draft = buildRevision({ project, source: src('<broken>'), origin: 'edit', label: 'bad', renderStatus: 'failed', renderError: 'boom', idFactory: ids, clock });
    await saveFailedDraft(repo, draft);
    // head + last-good unchanged; draft stored & retrievable with error
    expect(project.headRevisionId).toBe(r1.id);
    expect(project.lastGoodRevisionId).toBe(r1.id);
    const storedDraft = await repo.getRevision(draft.id);
    expect(storedDraft?.renderStatus).toBe('failed');
    expect(storedDraft?.renderError).toBe('boom');
  });

  it('rejects stale-base edits', async () => {
    const clock = fixedClock(0);
    const ids = createDeterministicIdFactory();
    let project = await repo.putProject(baseProject(clock));
    const r1 = buildRevision({ project, source: src('<v1/>'), origin: 'generation', label: 'gen', renderStatus: 'rendered', idFactory: ids, clock });
    ({ project } = await commitRendered(repo, project, r1, clock));
    expect(() => assertBaseCurrent(project, r1.id)).not.toThrow();
    expect(() => assertBaseCurrent(project, 'rev_stale')).toThrow(StaleBaseError);
  });
});
