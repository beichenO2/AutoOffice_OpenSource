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
  return shotsToPptx(await captureDeckShots(html));
}

/**
 * Capture one PNG per slide — or, with `withClicks`, one PNG per Slidev click
 * step (S7 `v-click`) — straight from the *preview HTML*. Because this is the
 * exact DOM + CSS the user sees at /aoide/, the resulting PDF/PPTX is WYSIWYG
 * with the live preview (deep gradient cover, frame-title rule, accent bullets,
 * page numbers, MathML formulas — all reproduced), instead of the bare Slidev
 * default theme the CLI export used to produce. Shots are 2× (deviceScaleFactor)
 * for crisp text. Click stepping mirrors Slidev: a slide with K v-click
 * fragments yields K+1 states (step 0 hides all clicks; step j reveals the first
 * j), so the page/slide counts match `slidev export --with-clicks`.
 */
export async function captureDeckShots(
  html: string,
  opts: { withClicks?: boolean } = {},
): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), 'aoide-shots-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf-8');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await page.goto(`file://${file}`, { waitUntil: FILE_HTML_WAIT });
    // Fonts (CJK) must be laid out before we snapshot, or the first shots clip.
    await page.evaluate(async () => {
      try {
        await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      } catch {
        /* fonts API absent — proceed */
      }
    });
    const slides = page.locator('.ao-slide');
    const count = await slides.count();
    const shots: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const slide = slides.nth(i);
      const clickCount = opts.withClicks ? await slide.locator('[v-click]').count() : 0;
      if (clickCount === 0) {
        shots.push(Buffer.from(await slide.screenshot({ type: 'png' })));
        continue;
      }
      for (let step = 0; step <= clickCount; step++) {
        await slide.evaluate((el, s) => {
          const clicks = Array.from(el.querySelectorAll('[v-click]'));
          clicks.forEach((c, idx) => {
            (c as HTMLElement).style.opacity = idx < s ? '1' : '0';
          });
        }, step);
        shots.push(Buffer.from(await slide.screenshot({ type: 'png' })));
      }
      await slide.evaluate((el) => {
        el.querySelectorAll('[v-click]').forEach((c) => {
          (c as HTMLElement).style.opacity = '';
        });
      });
    }
    await page.close();
    return shots;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Assemble per-slide PNG shots into a paginated PDF (one shot per page). */
async function shotsToPdf(shots: Buffer[]): Promise<Buffer> {
  if (shots.length === 0) return htmlToPdfBuffer('<!doctype html><html><body></body></html>');
  const imgs = shots
    .map((b) => `<img src="data:image/png;base64,${b.toString('base64')}">`)
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:1280px 720px;margin:0}
html,body{margin:0;padding:0;background:#fff}
img{width:1280px;height:720px;display:block;break-after:page;page-break-after:always}
img:last-child{break-after:auto;page-break-after:auto}
</style></head><body>${imgs}</body></html>`;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ width: '1280px', height: '720px', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Assemble per-slide PNG shots into an image-based PPTX (full-bleed per slide). */
async function shotsToPptx(shots: Buffer[]): Promise<Buffer> {
  const mod = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxCtor = (mod as any).default as new () => any;
  const pptx = new PptxCtor();
  pptx.layout = 'LAYOUT_16x9';
  for (const shot of shots) {
    const slide = pptx.addSlide();
    slide.addImage({ data: `image/png;base64,${shot.toString('base64')}`, x: 0, y: 0, w: '100%', h: '100%' });
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

/**
 * WYSIWYG PDF export from preview HTML — matches the live /aoide/ preview exactly.
 * `withClicks` expands each Slidev v-click step into its own page (S7).
 */
export async function exportDeckPdfWysiwyg(html: string, opts: { withClicks?: boolean } = {}): Promise<Buffer> {
  return shotsToPdf(await captureDeckShots(html, opts));
}

/**
 * WYSIWYG PDF export as a *vector* document (the default export). Renders the exact
 * preview HTML through Chromium's print path (`page.pdf`), so the report looks like the
 * live /aoide/ preview AND keeps selectable / searchable text — small file, crisp at any
 * zoom — instead of the screenshot bitmap `exportDeckPdfWysiwyg` produces. The preview
 * HTML's `@media print` rules put one `.ao-slide` per 1280×720 page. Use the screenshot
 * path only for opt-in step-animated (`withClicks`) exports, where each v-click step needs
 * its own page and cannot be a single vector render.
 */
export async function exportDeckPdfVector(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'aoide-vec-pdf-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf-8');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`file://${file}`, { waitUntil: FILE_HTML_WAIT });
    await page.evaluate(async () => {
      try {
        await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      } catch {
        /* fonts API absent — proceed */
      }
    });
    const pdf = await page.pdf({ printBackground: true, width: '1280px', height: '720px' });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** WYSIWYG PPTX export from preview HTML — matches the live /aoide/ preview exactly. */
export async function exportDeckPptxWysiwyg(html: string, opts: { withClicks?: boolean } = {}): Promise<Buffer> {
  return shotsToPptx(await captureDeckShots(html, opts));
}
