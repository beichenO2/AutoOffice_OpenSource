import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  emitLobsterEvent,
  setEventsFilePath,
  clearDedupCache,
} from '../src/lobster/emitter.js';
import {
  getLobsterStatus,
  getLobsterHealth,
} from '../src/lobster/adapter.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'lobster-adapter-'));
  setEventsFilePath(join(tmpDir, 'lobster-events.jsonl'));
  clearDedupCache();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('getLobsterStatus', () => {
  it('returns project info with no events', async () => {
    const status = await getLobsterStatus();
    expect(status.project).toBe('AutoOffice');
    expect(status.version).toBeTruthy();
    expect(status.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(status.recent_events).toEqual([]);
  });

  it('summarizes recent events by type', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'a' }, { dedup_key: 'x1' });
    await emitLobsterEvent('bug', 'warning', { message: 'b' }, { dedup_key: 'x2' });
    await emitLobsterEvent('contract_red', 'error', { message: 'c' }, { dedup_key: 'x3' });

    const status = await getLobsterStatus();
    expect(status.recent_events).toHaveLength(2);

    const bugSummary = status.recent_events.find((e) => e.type === 'bug');
    expect(bugSummary).toBeDefined();
    expect(bugSummary!.count).toBe(2);

    const redSummary = status.recent_events.find((e) => e.type === 'contract_red');
    expect(redSummary).toBeDefined();
    expect(redSummary!.count).toBe(1);
  });
});

describe('getLobsterHealth', () => {
  it('returns ok when no errors', async () => {
    const health = await getLobsterHealth();
    expect(health.ok).toBe(true);
    expect(health.error_count).toBe(0);
    expect(health.last_error).toBeUndefined();
    expect(health.events_file_ok).toBe(true);
  });

  it('reports errors when bug events exist', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'render failed' }, { dedup_key: 'h1' });

    const health = await getLobsterHealth();
    expect(health.ok).toBe(false);
    expect(health.error_count).toBe(1);
    expect(health.last_error).toBeDefined();
    expect(health.last_error!.type).toBe('bug');
    expect(health.last_error!.message).toBe('render failed');
  });

  it('counts both bug and contract_red events', async () => {
    await emitLobsterEvent('bug', 'error', { message: 'a' }, { dedup_key: 'h2' });
    await emitLobsterEvent('contract_red', 'error', { message: 'b' }, { dedup_key: 'h3' });

    const health = await getLobsterHealth();
    expect(health.error_count).toBe(2);
  });
});
