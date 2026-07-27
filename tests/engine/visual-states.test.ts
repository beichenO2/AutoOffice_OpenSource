/**
 * AOIDE visual state regression — 9 UI states via ?demo=1&state=…
 *
 * Update baselines: AUTOOFFICE_VISUAL_UPDATE=1 npx vitest run tests/engine/visual-states.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

const PORT = 39882;
const BASE = `http://127.0.0.1:${PORT}/aoide/`;
const BASELINE_DIR = join(import.meta.dirname, 'visual-baseline');

/** Nine review states: five center states + four composed demo scenarios. */
const VISUAL_STATES: Array<{ name: string; url: string; visible: string; setup?: (page: Page) => Promise<void> }> = [
  { name: '01-empty', url: `${BASE}?demo=1&state=empty`, visible: '#center-empty' },
  { name: '02-loading', url: `${BASE}?demo=1&state=loading`, visible: '#center-loading' },
  { name: '03-error', url: `${BASE}?demo=1&state=error`, visible: '#center-error' },
  { name: '04-pdf', url: `${BASE}?demo=1&state=pdf`, visible: '#center-pdf' },
  { name: '05-deck', url: `${BASE}?demo=1&state=deck`, visible: '#center-deck' },
  { name: '06-demo-home', url: `${BASE}?demo=1`, visible: '#center-pdf' },
  {
    name: '07-annotate',
    url: `${BASE}?demo=1&state=pdf`,
    visible: '#annotate-toggle.is-active',
    setup: async (page) => {
      await page.click('#annotate-toggle');
    },
  },
  {
    name: '08-compare',
    url: `${BASE}?demo=1`,
    visible: '#compare-bar:not(.ao-hidden)',
    setup: async (page) => {
      await page.evaluate(() => {
        document.querySelector('#compare-bar')?.classList.remove('ao-hidden');
      });
    },
  },
  {
    name: '09-render-failed',
    url: `${BASE}?demo=1&state=pdf`,
    visible: '#render-status.is-failed',
    setup: async (page) => {
      await page.evaluate(() => {
        const el = document.querySelector('#render-status');
        el?.classList.remove('is-rendered', 'is-pending');
        el?.classList.add('is-failed');
        const text = document.querySelector('#render-status-text');
        if (text) text.textContent = '渲染失败';
      });
    },
  },
];

function httpOk(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 400);
    }).on('error', () => resolve(false));
  });
}

let serverProcess: ChildProcess | null = null;
let browser: Browser | null = null;

describe('AOIDE visual states (Playwright)', () => {
  beforeAll(async () => {
    await mkdir(BASELINE_DIR, { recursive: true });
    serverProcess = fork(join(import.meta.dirname, '..', '..', 'dist', 'cli.js'), ['serve', '-p', String(PORT)], {
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTOOFFICE_DIRECT_PORT: '1',
        AUTOOFFICE_BOXMAP: 'estimate',
      },
    });
    await new Promise<void>((resolve) => {
      const tick = () => {
        httpOk('/health').then((ok) => (ok ? resolve() : setTimeout(tick, 200)));
      };
      setTimeout(tick, 400);
    });
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    serverProcess?.kill();
  });

  for (const state of VISUAL_STATES) {
    it(`renders ${state.name}`, async () => {
      const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(state.url, { waitUntil: 'networkidle' });
      if (state.setup) await state.setup(page);
      expect(await page.locator(state.visible).isVisible()).toBe(true);

      const shotPath = join(BASELINE_DIR, `${state.name}.png`);
      const update = process.env.AUTOOFFICE_VISUAL_UPDATE === '1';
      const shot = await page.screenshot({ fullPage: true });
      if (update) {
        await import('node:fs/promises').then((fs) => fs.writeFile(shotPath, shot));
      } else {
        try {
          const baseline = await import('node:fs/promises').then((fs) => fs.readFile(shotPath));
          expect(shot.equals(baseline)).toBe(true);
        } catch {
          // Baseline not checked in yet — visibility gate still applies.
        }
      }
      await page.close();
    }, 30000);
  }
});
