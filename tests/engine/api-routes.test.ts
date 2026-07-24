import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PORT = 39881;
let serverProcess: ReturnType<typeof import('node:child_process').fork> | null = null;
let engineHome = '';

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString(), headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('engine — HTTP /api/engine routes', () => {
  beforeAll(async () => {
    engineHome = await mkdtemp(join(tmpdir(), 'aoide-api-'));
    const { fork } = await import('node:child_process');
    serverProcess = fork(join(import.meta.dirname, '..', '..', 'dist', 'cli.js'), ['serve', '-p', String(PORT)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        AUTOOFFICE_DIRECT_PORT: '1',
        AUTOOFFICE_ENGINE_HOME: engineHome,
      },
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        httpReq('GET', '/health')
          .then(() => resolve())
          .catch(() => setTimeout(check, 200));
      };
      setTimeout(check, 500);
    });
  }, 15000);

  afterAll(async () => {
    serverProcess?.kill();
    if (engineHome) await rm(engineHome, { recursive: true, force: true });
  });

  it('serves AOIDE static shell at /aoide/', async () => {
    const res = await httpReq('GET', '/aoide/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('AutoOffice');
  });

  it('creates a presentation project and runs a requirement', async () => {
    const create = await httpReq('POST', '/api/engine/projects', { name: 'API 测试', kind: 'presentation' });
    expect(create.status).toBe(201);
    const created = JSON.parse(create.body) as { ok: boolean; project: { id: string } };
    expect(created.ok).toBe(true);
    expect(created.project.id).toBeTruthy();

    const req = await httpReq('POST', `/api/engine/projects/${created.project.id}/requirements`, {
      text: '做一份季度汇报，包含数据和对比',
    });
    expect(req.status).toBe(200);
    const payload = JSON.parse(req.body) as { ok: boolean; task: { status: string } };
    expect(payload.ok).toBe(true);
    expect(payload.task.status).toBe('completed');

    const overview = await httpReq('GET', `/api/engine/projects/${created.project.id}/overview`);
    expect(overview.status).toBe(200);
    const ov = JSON.parse(overview.body) as { project: { headRevisionId: string | null } };
    expect(ov.project.headRevisionId).toBeTruthy();
  });

  it('lists demo standard profiles without fabricating national standards', async () => {
    const res = await httpReq('GET', '/api/engine/standards/profiles');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body) as { profiles: Array<{ id: string; name: string }> };
    expect(data.profiles.length).toBeGreaterThan(0);
    for (const p of data.profiles) {
      expect(p.name.toLowerCase()).not.toMatch(/gb\/t|国标|verified national/);
      expect(p.name).toMatch(/演示/);
    }
  });
});
