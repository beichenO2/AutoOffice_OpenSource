import { KNOWLEVERAGE_RAG_CLASS, KNOWLEVERAGE_RAG_MODULE } from '../integrations/knowleverage.js';

export type InputKind = 'text' | 'file' | 'url' | 'archive';

export interface RawInput {
  kind: InputKind;
  /** For 'text': the raw string. For 'file'/'archive': absolute path. For 'url': the URL. */
  value: string;
  /** Optional hint for the source format (e.g. 'pdf', 'md', 'html'). */
  formatHint?: string;
}

export interface ParsedContent {
  /** Original input reference */
  source: RawInput;
  /** Extracted text content in Markdown */
  markdown: string;
  /** Byte length of the extracted text */
  byteLength: number;
  /** Word count (CJK characters counted individually) */
  wordCount: number;
  /** Number of paragraphs / logical sections */
  paragraphCount: number;
  /** Detected language: 'zh' | 'en' | 'mixed' */
  lang: 'zh' | 'en' | 'mixed';
}

/**
 * `inline` is reserved for future direct-return flows.
 * Current product behavior remains llmwiki-first for smaller inputs.
 */
export type RouteDecision = 'inline' | 'llmwiki' | 'knowleverage';

export interface EvaluationResult {
  /** Total word count across all parsed contents */
  totalWords: number;
  /** Total byte length */
  totalBytes: number;
  /** Complexity score 0-100 */
  complexity: number;
  /** Routing decision */
  route: RouteDecision;
  /** Human-readable reasoning */
  reason: string;
}

export interface MermaidOutput {
  /** The Mermaid diagram source code */
  code: string;
  /** Diagram type used */
  diagramType: 'graph' | 'flowchart' | 'mindmap';
  /** Key concepts extracted */
  concepts: string[];
}

export interface LlmWikiGraphNode {
  id: string;
  label: string;
  children?: LlmWikiGraphNode[];
}

export interface LlmWikiGraphPayload {
  tree: LlmWikiGraphNode;
  glossary: Record<string, string>;
}

export interface HandoffFile {
  path: string;
  content: string;
}

export interface LlmWikiHandoff {
  target: 'llmwiki';
  capability: 'llmwiki.wiki_generator';
  projectDirName: string;
  buildCommand: string;
  graph: LlmWikiGraphPayload;
  files: HandoffFile[];
}

export interface KnowLeverageIngestDocument {
  docId: string;
  text: string;
  extraMeta: Record<string, string>;
}

export interface KnowLeverageHandoff {
  target: 'knowleverage';
  capability: 'knowleverage.rag_engine';
  api: {
    type: 'python_library';
    module: typeof KNOWLEVERAGE_RAG_MODULE;
    className: typeof KNOWLEVERAGE_RAG_CLASS;
    method: 'ingest_document';
    followUpMethod: 'build_context';
  };
  documents: KnowLeverageIngestDocument[];
  suggestedQuery: string;
}

export type DownstreamHandoff = LlmWikiHandoff | KnowLeverageHandoff;

export interface SummarizeResult {
  /** All parsed inputs */
  parsed: ParsedContent[];
  /** Evaluation / routing result */
  evaluation: EvaluationResult;
  /** Generated Mermaid architecture diagram */
  mermaid: MermaidOutput;
  /** Combined markdown content */
  combinedMarkdown: string;
  /** Route-specific payload for downstream systems */
  handoff: DownstreamHandoff;
}
