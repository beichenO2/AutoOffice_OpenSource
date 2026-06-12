import type { ReportRenderContext } from '../format/types.js';

export const DOCX_THEME_IDS = [
  'academic',
  'business',
  'minimal',
] as const;

export type DocxThemeId = (typeof DOCX_THEME_IDS)[number];

export function isDocxThemeId(value: unknown): value is DocxThemeId {
  return typeof value === 'string' && (DOCX_THEME_IDS as readonly string[]).includes(value);
}

export interface DocxSectionInput {
  heading: string;
  level?: 1 | 2 | 3;
  body: string;
  /** 可选的表格数据 */
  table?: { headers: string[]; rows: string[][] };
  chartPngBase64?: string;
}

export interface DocxReportPayload {
  theme: DocxThemeId;
  locale: 'zh-CN' | 'en-US';
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  toc?: boolean;
  headerText?: string;
  footerText?: string;
  sections: DocxSectionInput[];
}

export interface DocxReportData extends Record<string, unknown> {
  docx: DocxReportPayload;
}

export function isDocxReportData(data: Record<string, unknown>): data is DocxReportData {
  const p = data.docx;
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    Array.isArray(o.sections) &&
    isDocxThemeId(o.theme)
  );
}

export function getDocxPayloadFromContext(ctx: ReportRenderContext): DocxReportPayload | null {
  const d = ctx.data as Record<string, unknown>;
  if (!isDocxReportData(d)) return null;
  return d.docx;
}

export interface DocxValidationIssue {
  severity: 'error' | 'warning';
  sectionIndex: number;
  code: string;
  message: string;
}

export interface DocxValidationResult {
  ok: boolean;
  issues: DocxValidationIssue[];
}
