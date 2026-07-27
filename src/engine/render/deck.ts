/**
 * HTML deck rendering helpers (Playwright) and export adapters.
 */
import { chromium, type Browser } from 'playwright';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let sharedBrowser: Browser | null = null;

/** Local file:// decks have no network; `networkidle` stalls or adds seconds of idle wait. */
const FILE_HTML_WAIT = 'load' as const;

async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

export async function closeRenderBrowser(): Promise<void> {
  if (sharedBrowser?.isConnected()) {
    await sharedBrowser.close();
  }
  sharedBrowser = null;
}

/** Launch shared Chromium and run a tiny measure so first real deck render is warm. */
export async function warmRenderBrowser(): Promise<void> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent(
      '<!DOCTYPE html><html><body><div class="ao-slide" style="width:1280px;height:720px"><span data-ao-id="warm" data-ao-type="text">warm</span></div></body></html>',
      { waitUntil: 'domcontentloaded' },
    );
    await page.evaluate(() => {
      document.querySelector('[data-ao-id]')?.getBoundingClientRect();
    });
  } finally {
    await page.close();
  }
}

export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'aoide-html-pdf-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf-8');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`file://${file}`, { waitUntil: FILE_HTML_WAIT });
    const pdf = await page.pdf({ printBackground: true, width: '1280px', height: '720px' });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function measureDeckBoxes(html: string): Promise<
  Array<{ nodeId: string; page: number; x: number; y: number; w: number; h: number }>
> {
  const dir = await mkdtemp(join(tmpdir(), 'aoide-measure-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf-8');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`file://${file}`, { waitUntil: FILE_HTML_WAIT });
    const boxes = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.ao-slide'));
      const out: Array<{ nodeId: string; page: number; x: number; y: number; w: number; h: number }> = [];
      slides.forEach((slide, idx) => {
        const slideRect = slide.getBoundingClientRect();
        slide.querySelectorAll('[data-ao-id]').forEach((el) => {
          const id = el.getAttribute('data-ao-id');
          if (!id || el.getAttribute('data-ao-type') === 'slide') return;
          const r = el.getBoundingClientRect();
          out.push({
            nodeId: id,
            page: idx + 1,
            x: (r.left - slideRect.left) / slideRect.width,
            y: (r.top - slideRect.top) / slideRect.height,
            w: r.width / slideRect.width,
            h: r.height / slideRect.height,
          });
        });
      });
      return out;
    });
    await page.close();
    return boxes;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function exportDeckPptxImageFallback(html: string): Promise<Buffer> {
  const mod = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxCtor = (mod as any).default as new () => any;
  const pptx = new PptxCtor();
  pptx.layout = 'LAYOUT_16x9';

  const dir = await mkdtemp(join(tmpdir(), 'aoide-pptx-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf-8');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`file://${file}`, { waitUntil: FILE_HTML_WAIT });
    const slides = page.locator('.ao-slide');
    const count = await slides.count();
    for (let i = 0; i < count; i++) {
      const shot = await slides.nth(i).screenshot({ type: 'png' });
      const slide = pptx.addSlide();
      slide.addImage({
        data: `image/png;base64,${Buffer.from(shot).toString('base64')}`,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
      });
    }
    await page.close();
    const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    return data;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
