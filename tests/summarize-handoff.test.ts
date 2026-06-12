import { describe, it, expect } from 'vitest';
import { summarize } from '../src/summarize/pipeline.js';
import { buildHandoff, buildLlmWikiHandoff, buildKnowLeverageHandoff } from '../src/summarize/handoff.js';
import type { EvaluationResult, MermaidOutput, ParsedContent } from '../src/summarize/types.js';

describe('summarize handoff adapters', () => {
  it('builds llmwiki scaffold artifacts from summary output', async () => {
    const result = await summarize([{
      kind: 'text',
      value: '# AutoOffice\n\n## Frontend\n\n**React** + **TypeScript**\n\n## Backend\n\n**Node.js** + **Express**',
    }]);

    const handoff = buildLlmWikiHandoff(result);
    expect(handoff.target).toBe('llmwiki');
    expect(handoff.capability).toBe('llmwiki.wiki_generator');
    expect(handoff.files.some((file) => file.path === 'wiki/overview.md')).toBe(true);
    expect(handoff.files.some((file) => file.path === 'wiki/source-1.md')).toBe(true);

    const graphFile = handoff.files.find((file) => file.path === 'output/assets/data/graph.json');
    expect(graphFile).toBeDefined();

    const graph = JSON.parse(graphFile?.content ?? '{}') as { tree?: { label?: string }; glossary?: Record<string, string> };
    expect(graph.tree?.label).toBe('AutoOffice');
    expect(Object.keys(graph.glossary ?? {})).toContain('React');
  });

  it('builds knowleverage ingest plan for large content', async () => {
    const largeInput = '# Enterprise Knowledge Base\n\n' + Array.from({ length: 220 }, (_, i) =>
      `## Topic ${i}\n\n${'Knowledge retrieval systems connect documents, embeddings, queries, and summaries in complex ways. '.repeat(16)}`,
    ).join('\n\n');

    const result = await summarize([{ kind: 'text', value: largeInput }]);
    expect(result.evaluation.route).toBe('knowleverage');

    const handoff = buildKnowLeverageHandoff(result);
    expect(handoff.target).toBe('knowleverage');
    expect(handoff.capability).toBe('knowleverage.rag_engine');
    expect(handoff.api.method).toBe('ingest_document');
    expect(handoff.documents.some((doc) => doc.extraMeta.kind === 'source_document')).toBe(true);
    expect(handoff.documents[0]?.docId).toContain('autooffice-summary:');
    expect(handoff.suggestedQuery.length).toBeGreaterThan(0);
  });

  it('summarize attaches the selected downstream handoff', async () => {
    const result = await summarize([{ kind: 'text', value: '# Topic\n\n## Part A\n\n**Design**\n\n## Part B\n\n**Delivery**' }]);
    expect(result.handoff.target).toBe('llmwiki');
    expect(result.handoff.capability).toBe('llmwiki.wiki_generator');
  });

  it('falls back to llmwiki handoff for reserved inline route', () => {
    const parsed: ParsedContent[] = [{
      source: { kind: 'text', value: '# Topic\n\nBody' },
      markdown: '# Topic\n\nBody',
      byteLength: 14,
      wordCount: 3,
      paragraphCount: 2,
      lang: 'en',
    }];
    const evaluation: EvaluationResult = {
      totalWords: 3,
      totalBytes: 14,
      complexity: 1,
      route: 'inline',
      reason: 'reserved for future direct return',
    };
    const mermaid: MermaidOutput = {
      code: 'graph TD\n  ROOT["Topic"]',
      diagramType: 'graph',
      concepts: ['Topic'],
    };

    const handoff = buildHandoff(evaluation, parsed, mermaid, parsed[0]?.markdown ?? '');
    expect(handoff.target).toBe('llmwiki');
    expect(handoff.capability).toBe('llmwiki.wiki_generator');
  });
});
