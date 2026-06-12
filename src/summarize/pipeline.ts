import type { RawInput, SummarizeResult } from './types.js';
import { parseInputs } from './parser.js';
import { evaluate } from './evaluator.js';
import { generateMermaid } from './mermaid-gen.js';
import { buildHandoff } from './handoff.js';

/**
 * Main summarize pipeline: parse inputs → evaluate content volume → route → generate Mermaid → build handoff.
 * Returns everything needed for downstream consumers (LLMWiki or KnowLeverage).
 */
export async function summarize(inputs: RawInput[]): Promise<SummarizeResult> {
  if (inputs.length === 0) {
    throw new Error('At least one input is required');
  }

  const parsed = await parseInputs(inputs);
  const evaluation = evaluate(parsed);
  const combinedMarkdown = parsed.map((p) => p.markdown).join('\n\n---\n\n');
  const mermaid = generateMermaid(parsed);
  const handoff = buildHandoff(evaluation, parsed, mermaid, combinedMarkdown);

  return { parsed, evaluation, mermaid, combinedMarkdown, handoff };
}
