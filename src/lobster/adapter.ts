import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { stat } from 'node:fs/promises';
import { readEvents, getEventsFilePath } from './emitter.js';
import { AUTOOFFICE_VERSION } from '../index.js';
import type {
  LobsterStatusResponse,
  LobsterHealthResponse,
  LobsterTestResult,
  LobsterEventSummary,
  LobsterEventType,
} from './types.js';

const startTime = Date.now();
const TEST_TIMEOUT_MS = 30_000;

export async function getLobsterStatus(): Promise<LobsterStatusResponse> {
  const events = await readEvents({ limit: 100 });

  const countMap = new Map<LobsterEventType, { count: number; last_ts: string }>();
  for (const e of events) {
    const existing = countMap.get(e.type);
    if (!existing || e.ts > existing.last_ts) {
      countMap.set(e.type, {
        count: (existing?.count ?? 0) + 1,
        last_ts: e.ts,
      });
    } else {
      existing.count += 1;
    }
  }

  const recentEvents: LobsterEventSummary[] = Array.from(countMap.entries()).map(
    ([type, { count, last_ts }]) => ({ type, count, last_ts }),
  );

  return {
    project: 'AutoOffice',
    version: AUTOOFFICE_VERSION,
    uptime_ms: Date.now() - startTime,
    recent_events: recentEvents,
  };
}

export async function getLobsterHealth(): Promise<LobsterHealthResponse> {
  const filePath = getEventsFilePath();
  let eventsFileOk = false;

  try {
    const dir = dirname(filePath);
    await stat(dir);
    eventsFileOk = true;
  } catch {
    // Dir doesn't exist yet, but it's fine — it will be created on first emit
    eventsFileOk = true;
  }

  const errorEvents = await readEvents({ type: 'bug', limit: 50 });
  const contractRedEvents = await readEvents({ type: 'contract_red', limit: 50 });
  const allErrors = [...errorEvents, ...contractRedEvents].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
  );

  const lastError = allErrors[0];

  return {
    ok: allErrors.length === 0,
    error_count: allErrors.length,
    last_error: lastError
      ? {
          type: lastError.type,
          message: String(lastError.payload.message ?? lastError.payload.error ?? ''),
          ts: lastError.ts,
        }
      : undefined,
    events_file_ok: eventsFileOk,
  };
}

export async function runLobsterTest(): Promise<LobsterTestResult> {
  const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');

  return new Promise((resolveResult) => {
    const startMs = Date.now();
    const child = execFile(
      'npx',
      ['vitest', 'run', '--reporter=json', 'tests/lobster-'],
      {
        cwd: projectRoot,
        timeout: TEST_TIMEOUT_MS,
        env: { ...process.env, NODE_ENV: 'test' },
      },
      (error, stdout, _stderr) => {
        const durationMs = Date.now() - startMs;

        try {
          const jsonMatch = stdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]) as {
              numPassedTests?: number;
              numFailedTests?: number;
              numTotalTests?: number;
            };
            resolveResult({
              passed: result.numPassedTests ?? 0,
              failed: result.numFailedTests ?? 0,
              total: result.numTotalTests ?? 0,
              duration_ms: durationMs,
            });
            return;
          }
        } catch {
          // Parse failure — fallback below
        }

        if (error) {
          resolveResult({
            passed: 0,
            failed: 0,
            total: 0,
            duration_ms: durationMs,
            error: error.message.slice(0, 200),
          });
          return;
        }

        resolveResult({
          passed: 0,
          failed: 0,
          total: 0,
          duration_ms: durationMs,
          error: 'Could not parse vitest output',
        });
      },
    );

    child.unref();
  });
}
