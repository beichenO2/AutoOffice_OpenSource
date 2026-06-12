import type { ParsedContent, EvaluationResult, RouteDecision } from './types.js';

const SMALL_CONTENT_THRESHOLD = 3000;
const LLMWIKI_THRESHOLD = 30000;

function computeComplexity(contents: ParsedContent[]): number {
  if (contents.length === 0) return 0;

  const totalWords = contents.reduce((s, c) => s + c.wordCount, 0);
  const totalParas = contents.reduce((s, c) => s + c.paragraphCount, 0);
  const avgWordsPerPara = totalParas > 0 ? totalWords / totalParas : totalWords;
  const multiLang = new Set(contents.map((c) => c.lang)).size > 1;
  const multiSource = contents.length > 1;

  let score = 0;
  score += Math.min(30, Math.floor(totalWords / 500));
  score += Math.min(20, Math.floor(avgWordsPerPara / 50));
  score += multiSource ? 15 : 0;
  score += multiLang ? 10 : 0;
  score += Math.min(25, contents.length * 5);

  return Math.min(100, score);
}

function decideRoute(totalWords: number, complexity: number): { route: RouteDecision; reason: string } {
  // Keep `inline` reserved in the type system, but follow the current
  // llmwiki-first product decision for smaller inputs.
  if (totalWords <= SMALL_CONTENT_THRESHOLD) {
    return {
      route: 'llmwiki',
      reason: `内容量较少 (${totalWords} 词)，适合交给 LLMWiki 做快速整理与可视化呈现。`,
    };
  }
  if (totalWords <= LLMWIKI_THRESHOLD) {
    return {
      route: 'llmwiki',
      reason: `中等内容量 (${totalWords} 词)，适合交给 LLMWiki 做小专题整理，生成可视化静态页面。`,
    };
  }
  return {
    route: 'knowleverage',
    reason: `大量内容 (${totalWords} 词, 复杂度 ${complexity}/100)，交给知识杠杆做 RAG 管理 + Skill 蒸馏。`,
  };
}

export function evaluate(contents: ParsedContent[]): EvaluationResult {
  const totalWords = contents.reduce((s, c) => s + c.wordCount, 0);
  const totalBytes = contents.reduce((s, c) => s + c.byteLength, 0);
  const complexity = computeComplexity(contents);
  const { route, reason } = decideRoute(totalWords, complexity);

  return { totalWords, totalBytes, complexity, route, reason };
}

export { SMALL_CONTENT_THRESHOLD, LLMWIKI_THRESHOLD };
