/**
 * File-based persistent store. One JSON file per entity so a crash can only
 * ever lose/half-write a single record (atomic temp+rename), never the set.
 * Recoverable by re-reading the directory; idempotent by id.
 */
import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, isAbsolute, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_.-]+$/;

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Unsafe id: ${JSON.stringify(id)}`);
}

function assertSafeCollection(c: string): void {
  if (!ID_RE.test(c)) throw new Error(`Unsafe collection: ${JSON.stringify(c)}`);
}

export interface Entity {
  id: string;
}

export class EngineStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private colDir(collection: string): string {
    assertSafeCollection(collection);
    return join(this.root, collection);
  }

  private entityPath(collection: string, id: string): string {
    assertSafeId(id);
    return join(this.colDir(collection), `${id}.json`);
  }

  async put<T extends Entity>(collection: string, entity: T): Promise<T> {
    const dir = this.colDir(collection);
    await mkdir(dir, { recursive: true });
    const file = this.entityPath(collection, entity.id);
    await atomicWrite(file, JSON.stringify(entity, null, 2));
    return entity;
  }

  async get<T extends Entity>(collection: string, id: string): Promise<T | null> {
    try {
      const raw = await readFile(this.entityPath(collection, id), 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async list<T extends Entity>(collection: string): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.colDir(collection));
    } catch (err: unknown) {
      if (isEnoent(err)) return [];
      throw err;
    }
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.colDir(collection), name), 'utf-8');
        out.push(JSON.parse(raw) as T);
      } catch {
        // Skip half-written / corrupt single record; the rest remain usable.
      }
    }
    return out;
  }

  async remove(collection: string, id: string): Promise<boolean> {
    try {
      await rm(this.entityPath(collection, id));
      return true;
    } catch (err: unknown) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }

  /** Write a render artifact; returns a project-relative path (never absolute). */
  async writeRender(projectId: string, name: string, data: Buffer | string): Promise<string> {
    assertSafeId(projectId);
    // Render file names are simple `basename.ext`; reject anything with a path.
    if (isAbsolute(name) || name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new Error(`Unsafe render name: ${name}`);
    }
    const rel = join('renders', projectId, name);
    const abs = join(this.root, rel);
    await mkdir(join(this.root, 'renders', projectId), { recursive: true });
    await atomicWrite(abs, data);
    return rel;
  }

  renderAbsPath(rel: string): string {
    const abs = normalize(join(this.root, rel));
    if (!abs.startsWith(normalize(this.root) + sep) && abs !== normalize(this.root)) {
      throw new Error(`Render path escapes store root: ${rel}`);
    }
    return abs;
  }

  async readRender(rel: string): Promise<Buffer> {
    return readFile(this.renderAbsPath(rel));
  }

  async exists(): Promise<boolean> {
    try {
      await stat(this.root);
      return true;
    } catch {
      return false;
    }
  }
}

async function atomicWrite(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.tmp.${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
