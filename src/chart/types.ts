export type RenderTarget = 'svg' | 'png' | 'html-embed';

export interface ChartRenderResult {
  target: RenderTarget;
  data: string;
  encoding: 'utf-8' | 'base64';
  mime: string;
}

export interface ChartRendererOptions {
  /** Preferred render target */
  target?: RenderTarget;
  /** Opt in to remote render fallbacks such as kroki.io */
  allowRemote?: boolean;
  /** Theme: default, dark, forest, neutral */
  theme?: string;
  /** Width in px (for PNG) */
  width?: number;
  /** Height in px (for PNG) */
  height?: number;
  /** Background color */
  backgroundColor?: string;
}
