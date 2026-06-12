/** 报告输出目标：后续各引擎在此枚举上挂接 */
export type ReportFormat = 'pptx' | 'pdf' | 'latex' | 'latex-pdf' | 'html' | 'docx';

export type RenderStage = 'template' | 'layout' | 'export';

export interface RenderArtifact {
  /** 中间或最终产物的 MIME 类型提示 */
  mime: string;
  /** UTF-8 文本或 base64 二进制占位 */
  body: string;
  encoding: 'utf-8' | 'base64';
}

export interface ReportRenderContext<TData extends Record<string, unknown> = Record<string, unknown>> {
  format: ReportFormat;
  /** 结构化载荷（来自上游龙虾或 CLI） */
  data: TData;
  /** Handlebars / 后续引擎共用的模板源字符串或路径 */
  template: { kind: 'inline'; source: string } | { kind: 'file'; path: string };
  locale?: 'zh-CN' | 'en-US';
}

export interface FormatAdapter<TData extends Record<string, unknown> = Record<string, unknown>> {
  readonly format: ReportFormat;
  /** 将「模板渲染后的中间表示」转为目标格式占位输出 */
  finalize(intermediateHtml: string, ctx: ReportRenderContext<TData>): Promise<RenderArtifact>;
}
