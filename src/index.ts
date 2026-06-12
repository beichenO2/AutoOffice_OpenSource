export const AUTOOFFICE_NAME = 'autooffice';
export const AUTOOFFICE_VERSION = '0.4.0';
export const AUTOOFFICE_REPORT_GEN_CAPABILITY = 'autooffice.report_gen';

export {
  compileTemplate,
  renderTemplateString,
  renderTemplateFile,
  registerDefaultHelpers,
} from './template/engine.js';

export type {
  ReportFormat,
  RenderStage,
  RenderArtifact,
  ReportRenderContext,
  FormatAdapter,
} from './format/types.js';

export {
  runReportPipeline,
  registerFormatAdapter,
  getFormatAdapter,
} from './format/pipeline.js';
export {
  SUPPORTED_GENERATE_FORMATS,
  isSupportedGenerateFormat,
  normalizeGenerateFormat,
  autoConvertPayload,
} from './format/generic-report-data.js';

export { registerFormatAdapters } from './format/format-adapters.js';

export { stripAiFlavor, stripAiFlavorDeep } from './text/deai.js';
export type { MonotonyReport, MonotonyIssue } from './text/monotony.js';
export { analyzeMonotony } from './text/monotony.js';

export type { DiversityReport, DiversityMetrics } from './text/diversity.js';
export { analyzeDiversity } from './text/diversity.js';

export type { QualityReport } from './text/quality.js';
export { analyzeQuality } from './text/quality.js';
export type { PptxDeckPayload, PptxSlideInput, PptxThemeId, PptxReportData } from './ppt/types.js';
export { PPTX_THEME_IDS, isPptxThemeId } from './ppt/types.js';
export { createPptxAdapter } from './ppt/pptx-adapter.js';
export { renderPptxWithPython } from './ppt/run-python-pptx.js';

export type { PdfReportPayload, PdfSectionInput, PdfThemeId, PdfReportData } from './pdf/types.js';
export { PDF_THEME_IDS, isPdfThemeId } from './pdf/types.js';
export { createPdfAdapter } from './pdf/pdf-adapter.js';
export { renderPdfWithWeasyPrint } from './pdf/run-weasyprint.js';

export type { DocxReportPayload, DocxSectionInput, DocxThemeId, DocxReportData } from './docx/types.js';
export { DOCX_THEME_IDS, isDocxThemeId } from './docx/types.js';
export { createDocxAdapter } from './docx/docx-adapter.js';
export { renderDocxWithPythonDocx } from './docx/run-python-docx.js';

export type { LatexReportPayload, LatexSectionInput, LatexThemeId, LatexReportData } from './latex/types.js';
export { LATEX_THEME_IDS, isLatexThemeId } from './latex/types.js';
export { createLatexAdapter } from './latex/latex-adapter.js';
export { renderLatexSource, renderLatexToPdf } from './latex/run-xelatex.js';

export type {
  RawInput,
  InputKind,
  ParsedContent,
  RouteDecision,
  EvaluationResult,
  MermaidOutput,
  LlmWikiGraphNode,
  LlmWikiGraphPayload,
  HandoffFile,
  LlmWikiHandoff,
  KnowLeverageIngestDocument,
  KnowLeverageHandoff,
  DownstreamHandoff,
  SummarizeResult,
} from './summarize/types.js';
export {
  parseInput,
  parseInputs,
  normalizeRawInput,
  normalizeRawInputs,
  countWords,
  countParagraphs,
  detectLang,
} from './summarize/parser.js';
export { evaluate } from './summarize/evaluator.js';
export { generateMermaid } from './summarize/mermaid-gen.js';
export { buildHandoff, buildLlmWikiHandoff, buildKnowLeverageHandoff } from './summarize/handoff.js';
export { summarize } from './summarize/pipeline.js';

export type { ChartRenderResult, ChartRendererOptions, RenderTarget } from './chart/types.js';
export { renderMermaid, wrapMermaidHtml } from './chart/mermaid-render.js';

export type { DocWorkflowConfig, DocTask } from './workflow/doc-workflow.js';
export type { BatchJob, BatchResult } from './batch/processor.js';
export { processBatch, generateMultiFormat } from './batch/processor.js';

export type {
  LobsterEvent,
  LobsterEventType,
  LobsterSeverity,
  LobsterStatusResponse,
  LobsterHealthResponse,
  LobsterTestResult,
  LobsterEventSummary,
} from './lobster/index.js';
export {
  LOBSTER_EVENT_TYPES,
  LOBSTER_SEVERITIES,
  emitLobsterEvent,
  readEvents,
  getEventsFilePath,
  setEventsFilePath,
  clearDedupCache,
  getLobsterStatus,
  getLobsterHealth,
  runLobsterTest,
} from './lobster/index.js';

export type { TemplateInfo } from './templates/gallery.js';
export { listTemplates, getTemplate, getTemplateSource } from './templates/gallery.js';

export type { RAGQueryResult, EnrichmentResult } from './integrations/knowleverage.js';
export {
  KNOWLEVERAGE_DIR_ENV,
  DEFAULT_KNOWLEVERAGE_DIR,
  getKnowLeverageDir,
  findPythonForKnowLeverage,
  queryRAG,
  ingestDocument,
  enrichWithRAG,
  normalizePositiveIntegerOption,
} from './integrations/knowleverage.js';

export type { WikiScaffoldResult } from './integrations/llmwiki.js';
export { createWikiScaffold } from './integrations/llmwiki.js';
export {
  API_WIKI_ROOT_ENV,
  DEFAULT_API_WIKI_ROOT,
  getApiWikiRoot,
  resolveApiWikiOutputDir,
  resolveCliWikiOutputDir,
} from './wiki-output.js';

export type {
  ToolStatus,
  ExternalToolsReport,
  ExternalEngineId,
  FormatSupportRecommendation,
  ConversionPath,
  ExternalToolsSummary,
} from './integrations/external-tools.js';
export {
  detectExternalTools,
  buildExternalToolsSummary,
  convertWithPandoc,
  convertWithLibreOffice,
} from './integrations/external-tools.js';
export {
  getDocWorkflowConfig,
  createGenerateTask,
  createSummarizeTask,
  planBatchGeneration,
} from './workflow/doc-workflow.js';
