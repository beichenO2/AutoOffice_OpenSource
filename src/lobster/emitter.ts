import { appendFile, readFile, stat, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { LobsterEvent, LobsterEventType, LobsterSeverity } from './types.js';
import { LOBSTER_EVENT_TYPES, LOBSTER_SEVERITIES } from './types.js';

const SOURCE_PROJECT = 'AutoOffice';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEDUP_WINDOW_MS = 60_000;

let eventsFilePath: string | null = null;
const recentDedupKeys = new Map<string, number>();

export function getEventsFilePath(): string {
  if (eventsFilePath) return eventsFilePath;
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
  eventsFilePath = resolve(projectRoot, 'lobster-events.jsonl');
  return eventsFilePath;
}

export function setEventsFilePath(p: string): void {
  eventsFilePath = p;
}

function validateEvent(event: LobsterEvent): string | null {
  if (!event.ts || isNaN(Date.parse(event.ts))) return 'invalid ts';
  if (!LOBSTER_EVENT_TYPES.includes(event.type as LobsterEventType)) return `invalid type: ${event.type}`;
  if (!event.source_project) return 'missing source_project';
  if (!LOBSTER_SEVERITIES.includes(event.severity as LobsterSeverity)) return `invalid severity: ${event.severity}`;
  if (!event.dedup_key) return 'missing dedup_key';
  if (typeof event.payload !== 'object' || event.payload === null) return 'payload must be an object';
  return null;
}

function isDuplicate(dedupKey: string): boolean {
  const now = Date.now();
  const last = recentDedupKeys.get(dedupKey);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;

  for (const [k, t] of recentDedupKeys) {
    if (now - t >= DEDUP_WINDOW_MS) recentDedupKeys.delete(k);
  }

  recentDedupKeys.set(dedupKey, now);
  return false;
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const s = await stat(filePath);
    if (s.size >= MAX_FILE_BYTES) {
      const rotated = filePath.replace(/\.jsonl$/, `.${Date.now()}.jsonl`);
      await rename(filePath, rotated);
    }
  } catch {
    // File doesn't exist yet
  }
}

async function tryHttpPost(event: LobsterEvent): Promise<boolean> {
  const sotPort = process.env.SOTAGENT_PORT ?? '4800';
  const url = `http://127.0.0.1:${sotPort}/api/lobster/events`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function emitLobsterEvent(
  type: LobsterEventType,
  severity: LobsterSeverity,
  payload: Record<string, unknown>,
  options?: {
    dedup_key?: string;
    target_project?: string;
  },
): Promise<{ written: boolean; deduped: boolean; http_ok: boolean }> {
  const dedupKey = options?.dedup_key ?? `${type}:${JSON.stringify(payload)}`;

  if (isDuplicate(dedupKey)) {
    return { written: false, deduped: true, http_ok: false };
  }

  const event: LobsterEvent = {
    ts: new Date().toISOString(),
    type,
    source_project: SOURCE_PROJECT,
    target_project: options?.target_project,
    severity,
    payload,
    dedup_key: dedupKey,
  };

  const validationError = validateEvent(event);
  if (validationError) {
    throw new Error(`Invalid lobster event: ${validationError}`);
  }

  const filePath = getEventsFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await rotateIfNeeded(filePath);
  await appendFile(filePath, JSON.stringify(event) + '\n');

  const httpOk = await tryHttpPost(event);

  return { written: true, deduped: false, http_ok: httpOk };
}

export async function readEvents(options?: {
  since?: string;
  type?: LobsterEventType;
  limit?: number;
}): Promise<LobsterEvent[]> {
  const filePath = getEventsFilePath();
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.trim().split('\n').filter(Boolean);
  let events: LobsterEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as LobsterEvent);
    } catch {
      // Skip malformed lines
    }
  }

  if (options?.since) {
    const sinceTs = new Date(options.since).getTime();
    events = events.filter((e) => new Date(e.ts).getTime() >= sinceTs);
  }

  if (options?.type) {
    events = events.filter((e) => e.type === options.type);
  }

  if (options?.limit && options.limit > 0) {
    events = events.slice(-options.limit);
  }

  return events;
}

export function clearDedupCache(): void {
  recentDedupKeys.clear();
}
