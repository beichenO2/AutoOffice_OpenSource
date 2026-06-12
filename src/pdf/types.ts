import type { ReportRenderContext } from '../format/types.js';

export const PDF_THEME_IDS = [
  'academic',
  'business',
  'minimal',
  'elegant',
  'technical-report',
  'news-digest',
  'study-notes',
  'study-review',
] as const;

export type PdfThemeId = (typeof PDF_THEME_IDS)[number];

export function isPdfThemeId(value: unknown): value is PdfThemeId {
  return typeof value === 'string' && (PDF_THEME_IDS as readonly string[]).includes(value);
}

export interface PdfSectionInput {
  heading: string;
  level?: 1 | 2 | 3;
  body: string;
  chart?: {
    kind: 'svg' | 'png';
    data: string;
    encoding: 'utf-8' | 'base64';
    mime: string;
  };
}

export interface PdfReportPayload {
  theme: PdfThemeId;
  locale: 'zh-CN' | 'en-US';
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  /** 启用自动目录页 */
  toc?: boolean;
  /** 页眉文字（默认使用 title） */
  headerText?: string;
  sections: PdfSectionInput[];
}

export interface PdfReportData extends Record<string, unknown> {
  pdf: PdfReportPayload;
}

export function isPdfReportData(data: Record<string, unknown>): data is PdfReportData {
  const p = data.pdf;
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    Array.isArray(o.sections) &&
    isPdfThemeId(o.theme)
  );
}

export function getPdfPayloadFromContext(ctx: ReportRenderContext): PdfReportPayload | null {
  const d = ctx.data as Record<string, unknown>;
  if (!isPdfReportData(d)) return null;
  return d.pdf;
}

export interface PdfValidationIssue {
  severity: 'error' | 'warning';
  sectionIndex: number;
  code: string;
  message: string;
}

export interface PdfValidationResult {
  ok: boolean;
  issues: PdfValidationIssue[];
}
