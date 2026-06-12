/**
 * Statistical monotony detection for AI-generated text.
 * AI text tends to have repetitive sentence structures, uniform paragraph lengths,
 * and predictable transition patterns. This module detects these patterns.
 */

export interface MonotonyReport {
  score: number;
  issues: MonotonyIssue[];
  suggestions: string[];
}

export interface MonotonyIssue {
  type: 'sentence-length' | 'paragraph-length' | 'starter-repetition' | 'transition-overuse';
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function detectSentenceLengthMonotony(sentences: string[]): MonotonyIssue | null {
  if (sentences.length < 5) return null;
  const lengths = sentences.map((s) => s.length);
  const cv = coefficientOfVariation(lengths);
  if (cv < 0.25) {
    return {
      type: 'sentence-length',
      severity: cv < 0.15 ? 'high' : 'medium',
      detail: `句子长度变化系数仅 ${(cv * 100).toFixed(1)}%，AI 文本通常句子长度过于均匀。建议混合使用短句和长句。`,
    };
  }
  return null;
}

function detectParagraphLengthMonotony(paragraphs: string[]): MonotonyIssue | null {
  if (paragraphs.length < 3) return null;
  const lengths = paragraphs.map((p) => p.length);
  const cv = coefficientOfVariation(lengths);
  if (cv < 0.2) {
    return {
      type: 'paragraph-length',
      severity: cv < 0.1 ? 'high' : 'medium',
      detail: `段落长度变化系数仅 ${(cv * 100).toFixed(1)}%，段落长度过于统一。建议有长有短。`,
    };
  }
  return null;
}

function detectStarterRepetition(sentences: string[]): MonotonyIssue | null {
  if (sentences.length < 4) return null;

  const starters = sentences.map((s) => {
    const hasCjk = /[\u4e00-\u9fff]/.test(s);
    if (hasCjk) {
      return s.slice(0, 4);
    }
    const words = s.split(/\s+/);
    return words.slice(0, 2).join(' ').toLowerCase();
  });

  const freq = new Map<string, number>();
  for (const s of starters) {
    freq.set(s, (freq.get(s) || 0) + 1);
  }

  const repeated = [...freq.entries()].filter(([_, count]) => count >= 3);
  if (repeated.length > 0) {
    const examples = repeated.map(([s, c]) => `"${s}" (${c}次)`).join(', ');
    return {
      type: 'starter-repetition',
      severity: repeated.some(([_, c]) => c >= 5) ? 'high' : 'medium',
      detail: `多个句子以相同词语开头: ${examples}。建议变换句式开头。`,
    };
  }
  return null;
}

const COMMON_TRANSITIONS = [
  '首先', '其次', '然后', '接下来', '最后', '总之',
  '此外', '另外', '同时', '因此', '所以', '但是', '然而',
  'first', 'second', 'third', 'next', 'then', 'finally',
  'additionally', 'however', 'therefore', 'consequently',
];

function detectTransitionOveruse(text: string): MonotonyIssue | null {
  const lower = text.toLowerCase();
  let count = 0;
  for (const t of COMMON_TRANSITIONS) {
    const regex = new RegExp(`\\b${t}[,，]?\\s`, 'gi');
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }

  const sentences = splitSentences(text);
  if (sentences.length < 3) return null;

  const ratio = count / sentences.length;
  if (ratio > 0.4) {
    return {
      type: 'transition-overuse',
      severity: ratio > 0.6 ? 'high' : 'medium',
      detail: `过渡词使用率 ${(ratio * 100).toFixed(0)}%（${count}/${sentences.length}句），AI 文本倾向于每句都加过渡词。`,
    };
  }
  return null;
}

export function analyzeMonotony(text: string): MonotonyReport {
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);

  const issues: MonotonyIssue[] = [];

  const slIssue = detectSentenceLengthMonotony(sentences);
  if (slIssue) issues.push(slIssue);

  const plIssue = detectParagraphLengthMonotony(paragraphs);
  if (plIssue) issues.push(plIssue);

  const srIssue = detectStarterRepetition(sentences);
  if (srIssue) issues.push(srIssue);

  const toIssue = detectTransitionOveruse(text);
  if (toIssue) issues.push(toIssue);

  const severityWeights = { low: 5, medium: 15, high: 30 };
  const totalPenalty = issues.reduce((sum, i) => sum + severityWeights[i.severity], 0);
  const score = Math.max(0, 100 - totalPenalty);

  const suggestions: string[] = [];
  if (issues.some((i) => i.type === 'sentence-length')) {
    suggestions.push('交替使用长短句，打破节奏单调感');
  }
  if (issues.some((i) => i.type === 'paragraph-length')) {
    suggestions.push('段落长度要有变化，重要论点可以用短段落强调');
  }
  if (issues.some((i) => i.type === 'starter-repetition')) {
    suggestions.push('变换句式开头，避免连续用相同结构起始');
  }
  if (issues.some((i) => i.type === 'transition-overuse')) {
    suggestions.push('减少过渡词，有些句子之间的逻辑关系读者可以自行推断');
  }

  return { score, issues, suggestions };
}
