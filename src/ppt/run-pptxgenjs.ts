import type { PptxDeckPayload, PptxSlideInput } from './types.js';

const THEMES: Record<string, {
  primary: string; secondary: string; text: string; muted: string;
  bg: string; titleBg: string; accentBg: string;
  heading: string; body: string;
}> = {
  academic: {
    primary: '1A365D', secondary: '2C5A8F', text: '2D3741', muted: '64748B',
    bg: 'FFFFFF', titleBg: 'F8FAFC', accentBg: '2C5A8F',
    heading: 'Noto Serif SC', body: 'Noto Sans SC',
  },
  business: {
    primary: '0F172A', secondary: '30588C', text: '1E293B', muted: '64748B',
    bg: 'FFFFFF', titleBg: 'F1F5F9', accentBg: '30588C',
    heading: 'Arial', body: 'Calibri',
  },
  minimal: {
    primary: '18181B', secondary: '3F3F46', text: '27272A', muted: '71717A',
    bg: 'FFFFFF', titleBg: 'FAFAFA', accentBg: '3F3F46',
    heading: 'Helvetica', body: 'Helvetica',
  },
  nord: {
    primary: '2E3440', secondary: '5E81AC', text: '3B4252', muted: '7B88A1',
    bg: 'ECEFF4', titleBg: 'D8DEE9', accentBg: '5E81AC',
    heading: 'Segoe UI', body: 'Segoe UI',
  },
  tech: {
    primary: '0D1117', secondary: '238636', text: 'C9D1D9', muted: '8B949E',
    bg: '0D1117', titleBg: '161B22', accentBg: '238636',
    heading: 'JetBrains Mono', body: 'Inter',
  },
  warm: {
    primary: '78350F', secondary: 'B45309', text: '451A03', muted: '92400E',
    bg: 'FFFBEB', titleBg: 'FEF3C7', accentBg: 'D97706',
    heading: 'Georgia', body: 'Verdana',
  },
  slate: {
    primary: '1E293B', secondary: '475569', text: '334155', muted: '94A3B8',
    bg: 'F8FAFC', titleBg: 'E2E8F0', accentBg: '475569',
    heading: 'Trebuchet MS', body: 'Calibri',
  },
};

function getTheme(id: string) {
  return THEMES[id] ?? THEMES.business!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTitleSlide(pres: any, payload: PptxDeckPayload, theme: ReturnType<typeof getTheme>): void {
  const slide = pres.addSlide();
  slide.background = { color: theme.titleBg };

  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: '42%', w: '100%', h: 0.06, fill: { color: theme.accentBg },
  });

  slide.addText(payload.title, {
    x: 0.8, y: '20%', w: '85%', h: 1.5,
    fontSize: 32, fontFace: theme.heading, color: theme.primary,
    bold: true, align: 'center', valign: 'bottom',
  });

  if (payload.subtitle) {
    slide.addText(payload.subtitle, {
      x: 0.8, y: '52%', w: '85%', h: 0.8,
      fontSize: 18, fontFace: theme.body, color: theme.secondary,
      align: 'center', valign: 'top',
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addContentSlide(pres: any, input: PptxSlideInput, theme: ReturnType<typeof getTheme>): void {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: '100%', h: 0.06, fill: { color: theme.accentBg },
  });

  slide.addText(input.title, {
    x: 0.5, y: 0.3, w: '90%', h: 0.7,
    fontSize: 24, fontFace: theme.heading, color: theme.primary, bold: true,
  });

  const bulletTexts = input.bullets.map(b => ({
    text: b, options: { fontSize: 16, fontFace: theme.body, color: theme.text, bullet: true, breakLine: true },
  }));

  const hasChart = !!input.chart_png_base64;

  slide.addText(bulletTexts, {
    x: 0.5, y: 1.2, w: hasChart ? '50%' : '90%', h: hasChart ? 3.5 : 4.2,
    valign: 'top', paraSpaceAfter: 8,
  });

  if (input.chart_png_base64) {
    try {
      slide.addImage({
        data: `image/png;base64,${input.chart_png_base64}`,
        x: '55%', y: 1.2, w: '40%', h: 3.5,
      });
    } catch { /* skip invalid image */ }
  }
}

export async function renderPptxWithPptxGenJS(payload: PptxDeckPayload): Promise<Buffer> {
  const mod = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxCtor = (mod as any).default as new () => any;
  const theme = getTheme(payload.theme);
  const pres = new PptxCtor();

  pres.layout = 'LAYOUT_16x9';
  pres.author = 'AutoOffice';

  addTitleSlide(pres, payload, theme);

  for (const slide of payload.slides) {
    addContentSlide(pres, slide, theme);
  }

  const output = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(output as ArrayBuffer);
}
