import type { ReportRenderContext } from '../format/types.js';

/** 与 `tools/pptgen/build_pptx.py` 中 THEMES 键一致，供调用方枚举可选主题 */
export const PPTX_THEME_IDS = [
  'academic',
  'business',
  'minimal',
  'nord',
  'tech',
  'warm',
  'slate',
] as const;

export type PptxThemeId = (typeof PPTX_THEME_IDS)[number];

export function isPptxThemeId(value: unknown): value is PptxThemeId {
  return typeof value === 'string' && (PPTX_THEME_IDS as readonly string[]).includes(value);
}

export interface PptxSlideInput {
  title: string;
  /** 每页最多 6 条（引擎会截断） */
  bullets: string[];
  /** Optional Mermaid chart rendered as PNG */
  chart_png_base64?: string;
  chart_alt?: string;
}

/** 传给 Python python-pptx 的载荷 */
export interface PptxDeckPayload {
  theme: PptxThemeId;
  locale: 'zh-CN' | 'en-US';
  title: string;
  subtitle?: string;
  slides: PptxSlideInput[];
}

/** 与 `runReportPipeline` 的 data 约定：`data.pptx` 为幻灯片结构 */
export interface PptxReportData extends Record<string, unknown> {
  pptx: PptxDeckPayload;
}

export function isPptxReportData(data: Record<string, unknown>): data is PptxReportData {
  const p = data.pptx;
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    Array.isArray(o.slides) &&
    isPptxThemeId(o.theme)
  );
}

export function getPptxPayloadFromContext(ctx: ReportRenderContext): PptxDeckPayload | null {
  const d = ctx.data as Record<string, unknown>;
  if (!isPptxReportData(d)) return null;
  return d.pptx;
}

/** 版式校验结果（供生成前调用） */
export interface SlideValidationIssue {
  severity: 'error' | 'warning';
  slideIndex: number;
  code: string;
  message: string;
}

export interface SlideDeckValidationResult {
  ok: boolean;
  issues: SlideValidationIssue[];
}
