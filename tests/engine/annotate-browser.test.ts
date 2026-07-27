/**
 * Browser box-select → annotate → patch loop (Playwright harness).
 *
 * Uses /aoide/annotate-test.html with a forked engine server and real API calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Browser, Page } from 'playwright';

const PORT = 39884;
const BASE = `http://127.0.0.1:${PORT}`;
const hasXelatex = spawnSync('xelatex', ['--version'], { stdio: 'pipe' }).status === 0;

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
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
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitReady(page: Page, timeout = 45000) {
  await page.waitForFunction(() => document.getElementById('test-status')?.dataset.ready === '1', undefined, {
    timeout,
  });
}

async function dragBoxSelect(page: Page, box: { x: number; y: number; w: number; h: number }) {
  await page.evaluate(({ box }) => {
    const overlay = document.getElementById('ao-overlay');
    const surface = window.__aoAnnotateTest.render.surfaceRect();
    const rect = {
      x: box.x,
      y: box.y,
      w: Math.max(box.w, 0.02),
      h: Math.max(box.h, 0.02),
    };
    const down = {
      clientX: surface.left + rect.x * surface.width + 2,
      clientY: surface.top + rect.y * surface.height + 2,
    };
    const up = {
      clientX: surface.left + (rect.x + rect.w) * surface.width - 2,
      clientY: surface.top + (rect.y + rect.h) * surface.height - 2,
    };
    overlay!.dispatchEvent(new PointerEvent('pointerdown', { ...down, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    overlay!.dispatchEvent(new PointerEvent('pointermove', { ...up, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    overlay!.dispatchEvent(new PointerEvent('pointerup', { ...up, button: 0, bubbles: true, pointerId: 1, pointerType: 'mouse' }));
  }, { box });
  await page.waitForSelector('#ao-annotate-form:not(.ao-hidden)', { timeout: 8000 });
}

let serverProcess: ChildProcess | null = null;
let engineHome = '';
let browser: Browser | null = null;

describe('AOIDE browser annotate loop (Playwright)', () => {
  beforeAll(async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    engineHome = await mkdtemp(join(tmpdir(), 'aoide-ann-browser-'));
    serverProcess = fork(join(import.meta.dirname, '..', '..', 'dist', 'cli.js'), ['serve', '-p', String(PORT)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTOOFFICE_DIRECT_PORT: '1',
        AUTOOFFICE_ENGINE_HOME: engineHome,
        AUTOOFFICE_ENGINE_INTERPRETER: 'deterministic',
        AUTOOFFICE_BOXMAP: 'estimate',
        AUTOOFFICE_PPT_SOT: 'html',
      },
    });
    await new Promise<void>((resolve) => {
      const tick = () => {
        httpReq('GET', '/health')
          .then(() => resolve())
          .catch(() => setTimeout(tick, 200));
      };
      setTimeout(tick, 400);
    });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  }, 45000);

  afterAll(async () => {
    await browser?.close();
    serverProcess?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (engineHome) await rm(engineHome, { recursive: true, force: true });
  });

  it('presentation: drag box-select → instruction → patch via API', async () => {
    const create = JSON.parse((await httpReq('POST', '/api/engine/projects', { name: '浏览器框选', kind: 'presentation' })).body);
    const projectId = create.project.id as string;
    await httpReq('POST', `/api/engine/projects/${projectId}/requirements`, {
      text: '做一份季度汇报，包含数据和对比',
    });
    const ov = JSON.parse((await httpReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const revisionId = ov.project.headRevisionId as string;
    const boxesRes = JSON.parse((await httpReq('GET', `/api/engine/revisions/${revisionId}/boxes?page=2`)).body);
    const target = (boxesRes.boxes as Array<{ nodeId: string; x: number; y: number; w: number; h: number }>).find(
      (b) => b.nodeId === 'slide-2-b0',
    );
    expect(target).toBeTruthy();

    const page = await browser!.newPage();
    await page.goto(`${BASE}/aoide/annotate-test.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      async ({ projectId, revisionId, boxes }) => {
        await window.__aoAnnotateTest.setup({
          projectId,
          revisionId,
          kind: 'presentation',
          boxes,
          page: 2,
        });
      },
      { projectId, revisionId, boxes: boxesRes.boxes },
    );
    await waitReady(page);

    await dragBoxSelect(page, target!);
    await page.locator('#ao-annotate-input').fill('改为「浏览器框选已生效」');
    await page.locator('#ao-annotate-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('test-status')?.dataset.submit, undefined, {
      timeout: 15000,
    });

    const submit = await page.evaluate(() => JSON.parse(document.getElementById('test-status')!.dataset.submit!));
    if (!submit.ok) {
      throw new Error(`annotate submit failed: ${JSON.stringify(submit)}`);
    }
    if (!submit.body?.revision) {
      throw new Error(`annotate ambiguous (no revision): ${JSON.stringify(submit.body)}`);
    }
    expect(submit.body.revision).toBeTruthy();

    const ovAfter = JSON.parse((await httpReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const head = ovAfter.revisions.at(-1);
    const html = head?.source?.find((f: { path: string }) => f.path === 'deck.html')?.content ?? '';
    expect(html).toContain('浏览器框选已生效');
    await page.close();
  }, 60000);

  it.skipIf(!hasXelatex)('pdf: drag box-select → instruction → LaTeX patch via API', async () => {
    const create = JSON.parse((await httpReq('POST', '/api/engine/projects', { name: 'PDF框选', kind: 'pdf' })).body);
    const projectId = create.project.id as string;
    await httpReq('POST', `/api/engine/projects/${projectId}/requirements`, {
      text: '写一份简短报告，包含数据表',
    });
    const ov = JSON.parse((await httpReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const revisionId = ov.project.headRevisionId as string;
    const boxesRes = JSON.parse((await httpReq('GET', `/api/engine/revisions/${revisionId}/boxes?page=1`)).body);
    const target =
      (boxesRes.boxes as Array<{ nodeId: string; x: number; y: number; w: number; h: number; page: number }>).find(
        (b) => b.nodeId === 'para-detail',
      ) ??
      (boxesRes.boxes as Array<{ nodeId: string; x: number; y: number; w: number; h: number; page: number }>).find(
        (b) => b.nodeId.startsWith('para-') || b.nodeId.startsWith('sec-'),
      );
    expect(target).toBeTruthy();

    const page = await browser!.newPage();
    await page.goto(`${BASE}/aoide/annotate-test.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      async ({ projectId, revisionId, boxes, pageNum }) => {
        await window.__aoAnnotateTest.setup({
          projectId,
          revisionId,
          kind: 'pdf',
          boxes,
          page: pageNum,
          loadTimeoutMs: 45000,
        });
      },
      { projectId, revisionId, boxes: boxesRes.boxes, pageNum: target!.page ?? 1 },
    );
    await waitReady(page);

    await dragBoxSelect(page, target!);
    await page.locator('#ao-annotate-input').fill('改为「PDF浏览器框选已生效」');
    await page.locator('#ao-annotate-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('test-status')?.dataset.submit, undefined, {
      timeout: 30000,
    });

    const submit = await page.evaluate(() => JSON.parse(document.getElementById('test-status')!.dataset.submit!));
    if (!submit.ok) {
      throw new Error(`annotate submit failed: ${JSON.stringify(submit)}`);
    }
    if (!submit.body?.revision) {
      throw new Error(`annotate ambiguous (no revision): ${JSON.stringify(submit.body)}`);
    }
    expect(submit.body.revision).toBeTruthy();

    const ovAfter = JSON.parse((await httpReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const head = ovAfter.revisions.at(-1);
    const tex = head?.source?.find((f: { path: string }) => f.path === 'main.tex')?.content ?? '';
    expect(tex).toContain('PDF浏览器框选已生效');
    await page.close();
  }, 90000);
});

describe('AOIDE Slidev browser annotate (Playwright)', () => {
  const SLIDEV_PORT = 39885;
  let slidevServer: ChildProcess | null = null;
  let slidevHome = '';
  let slidevBrowser: Browser | null = null;

  beforeAll(async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    slidevHome = await mkdtemp(join(tmpdir(), 'aoide-slidev-browser-'));
    slidevServer = fork(join(import.meta.dirname, '..', '..', 'dist', 'cli.js'), ['serve', '-p', String(SLIDEV_PORT)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTOOFFICE_DIRECT_PORT: '1',
        AUTOOFFICE_ENGINE_HOME: slidevHome,
        AUTOOFFICE_ENGINE_INTERPRETER: 'deterministic',
        AUTOOFFICE_BOXMAP: 'estimate',
        AUTOOFFICE_PPT_SOT: 'slidev',
      },
    });
    await new Promise<void>((resolve) => {
      const tick = () => {
        http
          .request({ hostname: '127.0.0.1', port: SLIDEV_PORT, path: '/health', method: 'GET' }, (res) => {
            res.resume();
            if ((res.statusCode ?? 500) < 400) resolve();
            else setTimeout(tick, 200);
          })
          .on('error', () => setTimeout(tick, 200))
          .end();
      };
      setTimeout(tick, 400);
    });
    const { chromium } = await import('playwright');
    slidevBrowser = await chromium.launch({ headless: true });
  }, 45000);

  afterAll(async () => {
    await slidevBrowser?.close();
    slidevServer?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (slidevHome) await rm(slidevHome, { recursive: true, force: true });
  });

  function slidevReq(method: string, path: string, body?: unknown) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const data = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: SLIDEV_PORT,
          path,
          method,
          headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
        },
      );
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  it('slidev preview iframe: drag box-select → patch slides.md', async () => {
    const create = JSON.parse((await slidevReq('POST', '/api/engine/projects', { name: 'Slidev浏览器', kind: 'presentation' })).body);
    const projectId = create.project.id as string;
    await slidevReq('POST', `/api/engine/projects/${projectId}/requirements`, {
      text: '做一份季度汇报，包含数据和对比',
    });
    const ov = JSON.parse((await slidevReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const revisionId = ov.project.headRevisionId as string;
    const head = ov.revisions.at(-1);
    expect(head?.source?.some((f: { path: string }) => f.path === 'slides.md')).toBe(true);

    const boxesRes = JSON.parse((await slidevReq('GET', `/api/engine/revisions/${revisionId}/boxes?page=2`)).body);
    const target = (boxesRes.boxes as Array<{ nodeId: string; x: number; y: number; w: number; h: number }>).find(
      (b) => b.nodeId === 'slide-2-b0',
    );
    expect(target).toBeTruthy();

    const page = await slidevBrowser!.newPage();
    await page.goto(`http://127.0.0.1:${SLIDEV_PORT}/aoide/annotate-test.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      async ({ projectId, revisionId, boxes }) => {
        await window.__aoAnnotateTest.setup({
          projectId,
          revisionId,
          kind: 'presentation',
          boxes,
          page: 2,
        });
      },
      { projectId, revisionId, boxes: boxesRes.boxes },
    );
    await waitReady(page);

    await dragBoxSelect(page, target!);
    await page.locator('#ao-annotate-input').fill('改为「Slidev浏览器框选已生效」');
    await page.locator('#ao-annotate-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('test-status')?.dataset.submit, undefined, {
      timeout: 15000,
    });

    const submit = await page.evaluate(() => JSON.parse(document.getElementById('test-status')!.dataset.submit!));
    if (!submit.ok) {
      throw new Error(`annotate submit failed: ${JSON.stringify(submit)}`);
    }
    if (!submit.body?.revision) {
      throw new Error(`annotate ambiguous (no revision): ${JSON.stringify(submit.body)}`);
    }
    expect(submit.body.revision).toBeTruthy();

    const ovAfter = JSON.parse((await slidevReq('GET', `/api/engine/projects/${projectId}/overview`)).body);
    const md = ovAfter.revisions.at(-1)?.source?.find((f: { path: string }) => f.path === 'slides.md')?.content ?? '';
    expect(md).toContain('Slidev浏览器框选已生效');
    await page.close();
  }, 60000);
});

declare global {
  interface Window {
    __aoAnnotateTest: {
      setup: (opts: Record<string, unknown>) => Promise<void>;
      render: { whenLoaded: (id: string) => Promise<void> };
      annotate: { setBoxes: (boxes: unknown[], page: number) => void; setEnabled: (on: boolean) => void };
      getLastSubmit: () => unknown;
    };
  }
}
