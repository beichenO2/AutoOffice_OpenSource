import type { ReportRenderContext } from '../format/types.js';

export const LATEX_THEME_IDS = [
  'article',
  'report',
  'beamer',
  'cvpr',
  'uestc-thesis',
] as const;

export type LatexThemeId = (typeof LATEX_THEME_IDS)[number];

export function isLatexThemeId(value: unknown): value is LatexThemeId {
  return typeof value === 'string' && (LATEX_THEME_IDS as readonly string[]).includes(value);
}

export interface LatexSectionInput {
  heading: string;
  level?: 1 | 2 | 3;
  body: string;
  /** LaTeX 公式（不含 $..$ 包裹） */
  math?: string;
  /** Base64-encoded PNG chart for inline image embedding */
  chartPngBase64?: string;
  mermaidCode?: string;
}

export interface LatexReportPayload {
  theme: LatexThemeId;
  locale: 'zh-CN' | 'en-US';
  title: string;
  author?: string;
  date?: string;
  abstract?: string;
  toc?: boolean;
  bibliography?: string[];
  sections: LatexSectionInput[];
}

export interface LatexReportData extends Record<string, unknown> {
  latex: LatexReportPayload;
}

export function isLatexReportData(data: Record<string, unknown>): data is LatexReportData {
  const p = data.latex;
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    Array.isArray(o.sections) &&
    isLatexThemeId(o.theme)
  );
}

export function getLatexPayloadFromContext(ctx: ReportRenderContext): LatexReportPayload | null {
  const d = ctx.data as Record<string, unknown>;
  if (!isLatexReportData(d)) return null;
  return d.latex;
}

export interface LatexValidationIssue {
  severity: 'error' | 'warning';
  sectionIndex: number;
  code: string;
  message: string;
}

export interface LatexValidationResult {
  ok: boolean;
  issues: LatexValidationIssue[];
}
