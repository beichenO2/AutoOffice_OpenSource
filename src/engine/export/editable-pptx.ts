/**
 * Opt-in editable PPTX export: DeckSpec → native text frames (pptxgenjs).
 *
 * Default PPTX remains WYSIWYG screenshots (`exportDeckPptxWysiwyg`). This track
 * follows scientific-illustrator’s “prefer editable text”: titles and bullets
 * become PowerPoint text boxes with word wrap, 16:9.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import type { DeckSpec, SlideElementSpec, SlideSpec } from '../html/generate.js';

export const PPTX_EDITABLE_ENV = 'AUTOOFFICE_PPTX_EDITABLE';

export function isEditablePptxExportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[PPTX_EDITABLE_ENV] ?? '').trim() === '1';
}

const TEXT_TYPES = new Set<SlideElementSpec['type']>([
  'heading',
  'subheading',
  'paragraph',
  'bullet',
  'note',
  'formula',
]);

/** Rebuild a DeckSpec from AutoOffice preview HTML (`.ao-slide` + `data-ao-type`). */
export function deckSpecFromAoHtml(html: string): DeckSpec {
  const dom = new JSDOM(html || '<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const deckTitle = (doc.querySelector('title')?.textContent ?? '').trim() || 'Deck';
  const slides: SlideSpec[] = [];

  for (const [i, sec] of Array.from(doc.querySelectorAll('.ao-slide')).entries()) {
    const rawLayout = sec.getAttribute('data-ao-layout');
    const layout: SlideSpec['layout'] =
      rawLayout === 'title' || rawLayout === 'section' || rawLayout === 'content' ? rawLayout : 'content';
    const elements: SlideElementSpec[] = [];

    for (const el of Array.from(sec.querySelectorAll('[data-ao-type]'))) {
      const type = el.getAttribute('data-ao-type') as SlideElementSpec['type'] | 'slide' | 'list' | null;
      if (!type || type === 'slide' || type === 'list') continue;
      const rawId = el.getAttribute('data-ao-id') ?? `e${elements.length}`;
      const id = rawId.replace(/^slide-\d+-/, '') || `e${elements.length}`;
      if (type === 'image') {
        elements.push({
          id,
          type: 'image',
          src: el.getAttribute('src') ?? '',
          alt: el.getAttribute('alt') ?? '',
        });
        continue;
      }
      if (!TEXT_TYPES.has(type)) continue;
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      elements.push({ id, type, text });
    }

    const title =
      elements.find((e) => e.type === 'heading')?.text ??
      elements.find((e) => e.type === 'subheading')?.text ??
      `Slide ${i + 1}`;
    slides.push({ title, layout, elements });
  }

  return { title: deckTitle, slides };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxPres = any;

function headingOf(slide: SlideSpec): string {
  return slide.elements.find((e) => e.type === 'heading')?.text?.trim() || slide.title || '';
}

function subtitleOf(slide: SlideSpec): string {
  return (
    slide.elements.find((e) => e.type === 'subheading')?.text?.trim() ||
    slide.elements.find((e) => e.type === 'paragraph' || e.type === 'note')?.text?.trim() ||
    ''
  );
}

function bulletsOf(slide: SlideSpec): string[] {
  return slide.elements
    .filter((e) => e.type === 'bullet')
    .map((e) => (e.text ?? '').trim())
    .filter(Boolean);
}

function bodyParagraphsOf(slide: SlideSpec, skipFirstPara: boolean): string[] {
  const paras = slide.elements
    .filter((e) => e.type === 'paragraph' || e.type === 'note' || e.type === 'formula')
    .map((e) => (e.text ?? '').trim())
    .filter(Boolean);
  return skipFirstPara ? paras.slice(1) : paras;
}

function addTitleSlide(pres: PptxPres, slideSpec: SlideSpec): void {
  const slide = pres.addSlide();
  const title = headingOf(slideSpec) || ' ';
  const sub = subtitleOf(slideSpec);
  slide.addText(title, {
    x: 0.6,
    y: 1.7,
    w: 8.8,
    h: 1.6,
    fontSize: 32,
    bold: true,
    align: 'center',
    valign: 'middle',
    wrap: true,
    color: '1B2233',
    fontFace: 'Calibri',
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.6,
      y: 3.4,
      w: 8.8,
      h: 1.1,
      fontSize: 18,
      align: 'center',
      valign: 'top',
      wrap: true,
      color: '5B6472',
      fontFace: 'Calibri',
    });
  }
}

function addContentSlide(pres: PptxPres, slideSpec: SlideSpec): void {
  const slide = pres.addSlide();
  const title = headingOf(slideSpec) || ' ';
  slide.addText(title, {
    x: 0.5,
    y: 0.28,
    w: 9.0,
    h: 0.72,
    fontSize: 24,
    bold: true,
    wrap: true,
    color: '141B2E',
    fontFace: 'Calibri',
  });

  const bullets = bulletsOf(slideSpec);
  const paras = bodyParagraphsOf(slideSpec, false);
  const runs: Array<{ text: string; options: Record<string, unknown> }> = [];

  for (const p of paras) {
    runs.push({
      text: p,
      options: { fontSize: 16, fontFace: 'Calibri', color: '37415A', breakLine: true, wrap: true },
    });
  }
  for (const b of bullets) {
    runs.push({
      text: b,
      options: {
        fontSize: 16,
        fontFace: 'Calibri',
        color: '212838',
        bullet: true,
        breakLine: true,
        wrap: true,
      },
    });
  }

  if (runs.length > 0) {
    slide.addText(runs, {
      x: 0.5,
      y: 1.15,
      w: 9.0,
      h: 4.15,
      valign: 'top',
      wrap: true,
      paraSpaceAfter: 8,
    });
  }
}

/** In-memory 16:9 PPTX with native title/bullet text frames. */
export async function renderEditablePptx(spec: DeckSpec): Promise<Buffer> {
  const mod = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxCtor = (mod as any).default as new () => PptxPres;
  const pres = new PptxCtor();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'AutoOffice';
  pres.title = spec.title || 'Deck';

  const slides = spec.slides.length > 0 ? spec.slides : [{ title: spec.title || 'Deck', layout: 'title' as const, elements: [{ id: 'title', type: 'heading' as const, text: spec.title || 'Deck' }] }];

  for (const slideSpec of slides) {
    if (slideSpec.layout === 'title') addTitleSlide(pres, slideSpec);
    else addContentSlide(pres, slideSpec);
  }

  const output = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(output as ArrayBuffer);
}

/** Write an editable-objects PPTX to `outPath`. Returns the path. */
export async function exportDeckPptxEditable(spec: DeckSpec, outPath: string): Promise<string> {
  if (!outPath?.trim()) throw new Error('exportDeckPptxEditable: outPath is required');
  const buffer = await renderEditablePptx(spec);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  return outPath;
}
