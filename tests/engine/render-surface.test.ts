/**
 * AOIDE render surface — iframe load / error / timeout lifecycle.
 *
 * Uses the minimal harness at /aoide/render-test.html (no main.js).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Browser, Page } from 'playwright';

const PORT = 39883;
const BASE = `http://127.0.0.1:${PORT}/aoide/`;

const GOOD_SLIDE_URL = `${BASE}fixtures/good-slide.html`;
const BAD_SLIDE_URL = `${BASE}fixtures/bad-slide.html`;

function httpOk(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${PORT}${path}`, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 400);
      })
      .on('error', () => resolve(false));
  });
}

async function waitHarnessStatus(page: Page, status: string, timeout = 8000) {
  await page.waitForFunction(
    (s) => document.getElementById('test-status')?.dataset.status === s,
    status,
    { timeout },
  );
}

async function statusLog(page: Page): Promise<Array<{ st: string; revisionId?: string; reason?: string }>> {
  return page.evaluate(() => {
    const raw = document.getElementById('test-status')?.dataset.log;
    return raw ? JSON.parse(raw) : [];
  });
}

let serverProcess: ChildProcess | null = null;
let browser: Browser | null = null;

describe('AOIDE render surface lifecycle (Playwright)', () => {
  beforeAll(async () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');
    serverProcess = fork(join(import.meta.dirname, '..', '..', 'dist', 'cli.js'), ['serve', '-p', String(PORT)], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test', AUTOOFFICE_DIRECT_PORT: '1' },
    });
    await new Promise<void>((resolve) => {
      const tick = () => {
        httpOk('/health').then((ok) => (ok ? resolve() : setTimeout(tick, 200)));
      };
      setTimeout(tick, 400);
    });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    serverProcess?.kill();
  });

  it('transitions loading → loaded for a valid presentation iframe', async () => {
    const page = await browser!.newPage();
    await page.goto(`${BASE}render-test.html`, { waitUntil: 'domcontentloaded' });

    await page.evaluate((url) => {
      window.__aoRenderTest.render.mount({
        url,
        kind: 'presentation',
        revisionId: 'rev-good',
        timeoutMs: 8000,
      });
    }, GOOD_SLIDE_URL);

    await waitHarnessStatus(page, 'loaded');
    const log = await statusLog(page);
    expect(log.map((e) => e.st)).toEqual(expect.arrayContaining(['loading', 'loaded']));
    expect(await page.locator('#ao-render-frame').count()).toBe(1);
    expect(await page.evaluate(() => window.__aoRenderTest.render.status)).toBe('loaded');
    await page.close();
  }, 15000);

  it('marks failed when presentation HTML has no slide surface', async () => {
    const page = await browser!.newPage();
    await page.goto(`${BASE}render-test.html`, { waitUntil: 'domcontentloaded' });

    await page.evaluate((url) => {
      window.__aoRenderTest.render.mount({
        url,
        kind: 'presentation',
        revisionId: 'rev-bad',
        timeoutMs: 8000,
      });
    }, BAD_SLIDE_URL);

    await waitHarnessStatus(page, 'failed');
    const log = await statusLog(page);
    expect(log.some((e) => e.st === 'failed' && e.reason === 'error')).toBe(true);
    expect(await page.evaluate(() => window.__aoRenderTest.render.status)).toBe('failed');
    await page.close();
  }, 15000);

  it('times out when iframe src never completes', async () => {
    const page = await browser!.newPage();
    await page.route('**/ao-hung-load**', () => {});
    await page.goto(`${BASE}render-test.html`, { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      window.__aoRenderTest.render.mount({
        url: `${location.origin}/aoide/ao-hung-load`,
        kind: 'pdf',
        revisionId: 'rev-hung',
        timeoutMs: 600,
      });
    });

    await waitHarnessStatus(page, 'failed', 5000);
    const log = await statusLog(page);
    expect(log.some((e) => e.st === 'failed' && e.reason === 'timeout')).toBe(true);
    await page.close();
  });

  it('keeps the previous good revision visible after a failed load', async () => {
    const page = await browser!.newPage();
    await page.goto(`${BASE}render-test.html`, { waitUntil: 'domcontentloaded' });

    await page.evaluate((url) => {
      window.__aoRenderTest.render.mount({
        url,
        kind: 'presentation',
        revisionId: 'rev-keep',
        timeoutMs: 8000,
      });
    }, GOOD_SLIDE_URL);
    await waitHarnessStatus(page, 'loaded');

    await page.evaluate((url) => {
      window.__aoRenderTest.render.mount({
        url,
        kind: 'presentation',
        revisionId: 'rev-next-bad',
        timeoutMs: 8000,
      });
    }, BAD_SLIDE_URL);
    await waitHarnessStatus(page, 'failed');

    const revisionId = await page.locator('#ao-render-frame').getAttribute('data-revision-id');
    expect(revisionId).toBe('rev-keep');
    expect(await page.evaluate(() => window.__aoRenderTest.render.status)).toBe('failed');
    await page.close();
  }, 20000);
});

declare global {
  interface Window {
    __aoRenderTest: {
      render: {
        mount: (opts: Record<string, unknown>) => HTMLIFrameElement;
        status: string;
      };
      statusLog: Array<{ st: string; revisionId?: string; reason?: string }>;
    };
  }
}
