import { KNOWLEVERAGE_RAG_CLASS, KNOWLEVERAGE_RAG_MODULE } from '../integrations/knowleverage.js';
import type {
  ParsedContent,
  EvaluationResult,
  MermaidOutput,
  SummarizeResult,
  DownstreamHandoff,
  LlmWikiHandoff,
  KnowLeverageHandoff,
  LlmWikiGraphNode,
} from './types.js';

function extractKeyConceptsForGraph(
  concepts: string[],
  combinedMarkdown: string,
): LlmWikiGraphNode {
  const root: LlmWikiGraphNode = {
    id: 'root',
    label: '主题概览',
    children: concepts.slice(0, 8).map((c, i) => ({
      id: `concept-${i}`,
      label: c,
    })),
  };
  return root;
}

function extractGlossary(combinedMarkdown: string): Record<string, string> {
  const glossary: Record<string, string> = {};
  const boldRe = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = boldRe.exec(combinedMarkdown)) !== null) {
    const term = match[1]?.trim();
    if (term && term.length > 1 && term.length < 30) {
      glossary[term] = `参见文档中关于"${term}"的描述`;
    }
  }
  return glossary;
}

function _buildLlmWikiHandoff(
  parsed: ParsedContent[],
  mermaid: MermaidOutput,
  combinedMarkdown: string,
): LlmWikiHandoff {
  const headings = combinedMarkdown.match(/^#\s+(.+)$/m);
  const rootLabel = headings?.[1]?.trim() || '主题概览';

  return {
    target: 'llmwiki',
    capability: 'llmwiki.wiki_generator',
    projectDirName: `wiki-${Date.now()}`,
    buildCommand: 'npm run build',
    graph: {
      tree: extractKeyConceptsForGraph(mermaid.concepts, combinedMarkdown),
      glossary: extractGlossary(combinedMarkdown),
    },
    files: [
      { path: 'wiki/overview.md', content: `# ${rootLabel}\n\n${combinedMarkdown.slice(0, 2000)}` },
      ...parsed.map((p, i) => ({
        path: `wiki/source-${i + 1}.md`,
        content: p.markdown,
      })),
      { path: 'content/mermaid.md', content: `# 架构图\n\n\`\`\`mermaid\n${mermaid.code}\n\`\`\`` },
      {
        path: 'output/assets/data/graph.json',
        content: JSON.stringify({
          tree: { label: rootLabel, children: mermaid.concepts.map((c) => ({ label: c })) },
          glossary: extractGlossary(combinedMarkdown),
        }, null, 2),
      },
    ],
  };
}

function _buildKnowLeverageHandoff(
  parsed: ParsedContent[],
  combinedMarkdown: string,
): KnowLeverageHandoff {
  return {
    target: 'knowleverage',
    capability: 'knowleverage.rag_engine',
    api: {
      type: 'python_library',
      module: KNOWLEVERAGE_RAG_MODULE,
      className: KNOWLEVERAGE_RAG_CLASS,
      method: 'ingest_document',
      followUpMethod: 'build_context',
    },
    documents: parsed.map((p, i) => ({
      docId: `autooffice-summary:doc-${i}-${Date.now()}`,
      text: p.markdown,
      extraMeta: {
        kind: 'source_document',
        source_kind: p.source.kind,
        source_value: p.source.value.slice(0, 200),
        lang: p.lang,
        word_count: String(p.wordCount),
      },
    })),
    suggestedQuery: '请总结这些文档的核心观点',
  };
}

export function buildLlmWikiHandoff(result: SummarizeResult): LlmWikiHandoff {
  return _buildLlmWikiHandoff(result.parsed, result.mermaid, result.combinedMarkdown);
}

export function buildKnowLeverageHandoff(result: SummarizeResult): KnowLeverageHandoff {
  return _buildKnowLeverageHandoff(result.parsed, result.combinedMarkdown);
}

export function buildHandoff(
  evaluation: EvaluationResult,
  parsed: ParsedContent[],
  mermaid: MermaidOutput,
  combinedMarkdown: string,
): DownstreamHandoff {
  const result = { parsed, evaluation, mermaid, combinedMarkdown } as SummarizeResult;
  if (evaluation.route === 'knowleverage') {
    return buildKnowLeverageHandoff(result);
  }
  // `inline` is kept for forward compatibility, but currently falls back
  // to the LLMWiki-style handoff until a direct-return contract exists.
  return buildLlmWikiHandoff(result);
}
