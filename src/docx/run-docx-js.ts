import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, Header, Footer, PageNumber, NumberFormat,
  ImageRun, BorderStyle, ShadingType, TableOfContents,
} from 'docx';
import type { DocxReportPayload, DocxSectionInput } from './types.js';

const THEMES: Record<string, { primary: string; secondary: string; heading: string; body: string }> = {
  academic: { primary: '1A365D', secondary: '2C5A8F', heading: 'Times New Roman', body: 'Noto Sans SC' },
  business: { primary: '0F172A', secondary: '30588C', heading: 'Arial', body: 'Calibri' },
  minimal:  { primary: '18181B', secondary: '3F3F46', heading: 'Helvetica', body: 'Helvetica' },
};

function getTheme(id: string) {
  return THEMES[id] ?? THEMES.business!;
}

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

function buildSection(section: DocxSectionInput, theme: ReturnType<typeof getTheme>): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(new Paragraph({
    heading: HEADING_MAP[section.level ?? 1] ?? HeadingLevel.HEADING_1,
    children: [new TextRun({ text: section.heading, font: theme.heading, color: theme.primary })],
    spacing: { before: 360, after: 120 },
  }));

  for (const line of section.body.split('\n')) {
    if (!line.trim()) {
      elements.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    elements.push(new Paragraph({
      children: [new TextRun({ text: line, font: theme.body, size: 22 })],
      spacing: { after: 60 },
    }));
  }

  if (section.table) {
    const { headers, rows } = section.table;
    const headerRow = new TableRow({
      children: headers.map(h => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, font: theme.body, size: 20, color: 'FFFFFF' })],
          alignment: AlignmentType.CENTER,
        })],
        shading: { type: ShadingType.SOLID, color: theme.primary },
      })),
    });
    const dataRows = rows.map(row => new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cell, font: theme.body, size: 20 })],
        })],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'D4D4D8' },
        },
      })),
    }));
    elements.push(new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  if (section.chartPngBase64) {
    try {
      const imgData = Buffer.from(section.chartPngBase64, 'base64');
      elements.push(new Paragraph({
        children: [new ImageRun({ data: imgData, transformation: { width: 500, height: 300 }, type: 'png' })],
        spacing: { before: 200, after: 200 },
      }));
    } catch { /* skip invalid image */ }
  }

  return elements;
}

export async function renderDocxWithDocxJs(payload: DocxReportPayload): Promise<Buffer> {
  const theme = getTheme(payload.theme);

  const titleSection: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: payload.title, bold: true, font: theme.heading, size: 48, color: theme.primary })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 200 },
    }),
  ];

  if (payload.subtitle) {
    titleSection.push(new Paragraph({
      children: [new TextRun({ text: payload.subtitle, font: theme.body, size: 28, color: theme.secondary })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }));
  }

  if (payload.author || payload.date) {
    titleSection.push(new Paragraph({
      children: [new TextRun({
        text: [payload.author, payload.date].filter(Boolean).join(' · '),
        font: theme.body, size: 20, color: '64748B',
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }));
  }

  const contentSections = payload.sections.flatMap(s => buildSection(s, theme));

  const tocChildren: (Paragraph | Table | TableOfContents)[] = [...titleSection];
  if (payload.toc) {
    tocChildren.push(new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }));
  }
  tocChildren.push(...contentSections);

  const doc = new Document({
    sections: [{
      properties: {},
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({
              text: payload.headerText ?? payload.title,
              font: theme.body, size: 16, color: '94A3B8',
            })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: payload.footerText ?? '', font: theme.body, size: 16, color: '94A3B8' }),
              new TextRun({ children: [PageNumber.CURRENT], font: theme.body, size: 16, color: '94A3B8' }),
              new TextRun({ text: ' / ', font: theme.body, size: 16, color: '94A3B8' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: theme.body, size: 16, color: '94A3B8' }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: tocChildren,
    }],
    numbering: { config: [] },
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
