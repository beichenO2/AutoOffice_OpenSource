import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  emitLobsterEvent,
  readEvents,
  setEventsFilePath,
  clearDedupCache,
} from '../src/lobster/emitter.js';
import type { LobsterEvent } from '../src/lobster/types.js';

let tmpDir: string;
let eventsFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'lobster-test-'));
  eventsFile = join(tmpDir, 'lobster-events.jsonl');
  setEventsFilePath(eventsFile);
  clearDedupCache();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('emitLobsterEvent', () => {
  it('writes a valid event to the JSONL file', async () => {
    const result = await emitLobsterEvent('bug', 'error', { message: 'test error' });
    expect(result.written).toBe(true);
    expect(result.deduped).toBe(false);

    const content = await readFile(eventsFile, 'utf-8');
    const event = JSON.parse(content.trim()) as LobsterEvent;
    expect(event.type).toBe('bug');
    expect(event.severity).toBe('error');
    expect(event.source_project).toBe('AutoOffice');
    expect(event.payload.message).toBe('test error');
    expect(event.dedup_key).toBeTruthy();
    expect(new Date(event.ts).getTime()).toBeGreaterThan(0);
  });

  it('deduplicates events with the same dedup_key within the window', async () => {
    const r1 = await emitLobsterEvent('bug', 'error', { message: 'dup' }, { dedup_key: 'same-key' });
    const r2 = await emitLobsterEvent('bug', 'error', { message: 'dup' }, { dedup_key: 'same-key' });

    expect(r1.written).toBe(true);
    expect(r2.deduped).toBe(true);
    expect(r2.written).toBe(false);

    const events = await readEvents();
    expect(events).toHaveLength(1);
  });

  it('allows different dedup_keys', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'a' }, { dedup_key: 'key-a' });
    await emitLobsterEvent('bug', 'error', { message: 'b' }, { dedup_key: 'key-b' });

    const events = await readEvents();
    expect(events).toHaveLength(2);
  });

  it('sets target_project when provided', async () => {
    await emitLobsterEvent('bug', 'warning', { message: 'cross' }, { target_project: 'PolarClaw' });

    const events = await readEvents();
    expect(events[0]!.target_project).toBe('PolarClaw');
  });

  it('validates event schema - rejects invalid type', async () => {
    await expect(
      emitLobsterEvent('invalid_type' as 'bug', 'error', { message: 'bad' }),
    ).rejects.toThrow('Invalid lobster event');
  });

  it('validates event schema - rejects invalid severity', async () => {
    await expect(
      emitLobsterEvent('bug', 'extreme' as 'error', { message: 'bad' }),
    ).rejects.toThrow('Invalid lobster event');
  });

  it('http_ok is false when SOTAgent is not reachable', async () => {
    const origPort = process.env.SOTAGENT_PORT;
    process.env.SOTAGENT_PORT = '19999';
    try {
      const result = await emitLobsterEvent('bug', 'error', { message: 'test' });
      expect(result.http_ok).toBe(false);
    } finally {
      if (origPort !== undefined) process.env.SOTAGENT_PORT = origPort;
      else delete process.env.SOTAGENT_PORT;
    }
  });
});

describe('readEvents', () => {
  it('returns empty array when file does not exist', async () => {
    const events = await readEvents();
    expect(events).toEqual([]);
  });

  it('filters by type', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'bug1' }, { dedup_key: 'a' });
    await emitLobsterEvent('contract_red', 'error', { message: 'red1' }, { dedup_key: 'b' });

    const bugs = await readEvents({ type: 'bug' });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]!.type).toBe('bug');
  });

  it('filters by since timestamp', async () => {
    const beforeTs = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 50));
    await emitLobsterEvent('bug', 'error', { message: 'after' }, { dedup_key: 'c' });

    const events = await readEvents({ since: beforeTs });
    expect(events).toHaveLength(1);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await emitLobsterEvent('bug', 'info', { message: `event-${i}` }, { dedup_key: `k-${i}` });
    }

    const events = await readEvents({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it('parses JSONL lines correctly', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'line1' }, { dedup_key: 'l1' });
    await emitLobsterEvent('contract_red', 'warning', { message: 'line2' }, { dedup_key: 'l2' });

    const events = await readEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('bug');
    expect(events[1]!.type).toBe('contract_red');
  });
});
