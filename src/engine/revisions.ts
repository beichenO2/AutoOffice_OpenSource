/**
 * Revision chain: immutable revisions, undo/redo stacks, last-good preservation,
 * and stale-base concurrency detection.
 *
 * Invariant: `project.headRevisionId` always points at a RENDERED revision (or
 * null before the first successful render). A failed render is stored as a
 * draft revision that does NOT advance head or change last-good, so the last
 * usable document is never destroyed by a bad edit.
 */
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import type { IdFactory } from './ids.js';
import { hashSourceTree, randomIdFactory } from './ids.js';
import type { Project, Revision, RevisionOrigin, SourceFile } from './types.js';
import type { Repo } from './repo.js';

export class StaleBaseError extends Error {
  readonly expected: string | null;
  readonly got: string;
  constructor(expected: string | null, got: string) {
    super(`Stale base revision: edit based on ${got} but head is ${expected ?? 'null'}`);
    this.name = 'StaleBaseError';
    this.expected = expected;
    this.got = got;
  }
}

export interface NewRevisionInput {
  project: Project;
  source: SourceFile[];
  origin: RevisionOrigin;
  label: string;
  renderStatus: 'rendered' | 'failed';
  renderPath?: string;
  renderMime?: string;
  renderError?: string;
  sourceMapId?: string;
  editIntentId?: string;
  patchSummary?: string;
  idFactory?: IdFactory;
  clock?: Clock;
}

/** Build a Revision object (pure; does not persist). */
export function buildRevision(input: NewRevisionInput): Revision {
  const idFactory = input.idFactory ?? randomIdFactory;
  const clock = input.clock ?? systemClock;
  return {
    id: idFactory('rev'),
    projectId: input.project.id,
    baseRevisionId: input.project.headRevisionId,
    origin: input.origin,
    createdAt: clock(),
    sourceHash: hashSourceTree(input.source),
    source: input.source,
    renderPath: input.renderPath,
    renderMime: input.renderMime,
    renderStatus: input.renderStatus,
    renderError: input.renderError,
    sourceMapId: input.sourceMapId,
    editIntentId: input.editIntentId,
    patchSummary: input.patchSummary,
    label: input.label,
  };
}

/** Reject an edit whose declared base is not the current head. */
export function assertBaseCurrent(project: Project, baseRevisionId: string): void {
  if (project.headRevisionId !== baseRevisionId) {
    throw new StaleBaseError(project.headRevisionId, baseRevisionId);
  }
}

/**
 * Persist a rendered revision and advance the chain. Pushes the previous head
 * onto the undo stack, clears redo, updates head and last-good.
 */
export async function commitRendered(
  repo: Repo,
  project: Project,
  revision: Revision,
  clock: Clock = systemClock,
): Promise<{ project: Project; revision: Revision }> {
  if (revision.renderStatus !== 'rendered') {
    throw new Error('commitRendered requires renderStatus="rendered"');
  }
  await repo.putRevision(revision);
  const undoStack = [...project.undoStack];
  if (project.headRevisionId) undoStack.push(project.headRevisionId);
  const updated: Project = {
    ...project,
    headRevisionId: revision.id,
    lastGoodRevisionId: revision.id,
    undoStack,
    redoStack: [],
    updatedAt: clock(),
  };
  await repo.putProject(updated);
  return { project: updated, revision };
}

/** Persist a failed-render draft. Head and last-good are untouched. */
export async function saveFailedDraft(repo: Repo, revision: Revision): Promise<Revision> {
  if (revision.renderStatus !== 'failed') {
    throw new Error('saveFailedDraft requires renderStatus="failed"');
  }
  await repo.putRevision(revision);
  return revision;
}

export async function undo(
  repo: Repo,
  project: Project,
  clock: Clock = systemClock,
): Promise<{ project: Project; revision: Revision | null } | null> {
  if (project.undoStack.length === 0) return null;
  const undoStack = [...project.undoStack];
  const target = undoStack.pop() as string;
  const redoStack = [...project.redoStack];
  if (project.headRevisionId) redoStack.push(project.headRevisionId);
  const rev = await repo.getRevision(target);
  const updated: Project = {
    ...project,
    headRevisionId: target,
    lastGoodRevisionId: rev && rev.renderStatus === 'rendered' ? target : project.lastGoodRevisionId,
    undoStack,
    redoStack,
    updatedAt: clock(),
  };
  await repo.putProject(updated);
  return { project: updated, revision: rev };
}

export async function redo(
  repo: Repo,
  project: Project,
  clock: Clock = systemClock,
): Promise<{ project: Project; revision: Revision | null } | null> {
  if (project.redoStack.length === 0) return null;
  const redoStack = [...project.redoStack];
  const target = redoStack.pop() as string;
  const undoStack = [...project.undoStack];
  if (project.headRevisionId) undoStack.push(project.headRevisionId);
  const rev = await repo.getRevision(target);
  const updated: Project = {
    ...project,
    headRevisionId: target,
    lastGoodRevisionId: rev && rev.renderStatus === 'rendered' ? target : project.lastGoodRevisionId,
    undoStack,
    redoStack,
    updatedAt: clock(),
  };
  await repo.putProject(updated);
  return { project: updated, revision: rev };
}
