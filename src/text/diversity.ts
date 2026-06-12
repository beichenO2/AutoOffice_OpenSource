/**
 * Sentence diversity analysis — measures how varied the writing patterns are.
 * Returns a score and specific suggestions for making text sound more natural.
 */

export interface DiversityReport {
  /** Overall diversity score 0-100 (higher = more diverse/natural) */
  score: number;
  metrics: DiversityMetrics;
  suggestions: string[];
}

export interface DiversityMetrics {
  /** Variety of sentence starters (0-1, higher = more varied) */
  starterVariety: number;
  /** Standard deviation of sentence lengths as fraction of mean */
  lengthVariation: number;
  /** Ratio of unique bigrams to total bigrams */
  bigramDiversity: number;
  /** Average words per sentence */
  avgSentenceLength: number;
  /** Fraction of sentences that are questions, exclamations, or other non-declarative */
  nonDeclarativeRatio: number;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function tokenize(text: string): string[] {
  const hasCjk = /[\u4e00-\u9fff]/.test(text);
  if (hasCjk) {
    return [...text].filter((c) => /[\u4e00-\u9fff\w]/.test(c));
  }
  return text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
}

function computeStarterVariety(sentences: string[]): number {
  if (sentences.length < 3) return 1;
  const starters = sentences.map((s) => {
    const hasCjk = /[\u4e00-\u9fff]/.test(s);
    if (hasCjk) return s.slice(0, 2);
    return s.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  });
  const unique = new Set(starters);
  return unique.size / starters.length;
}

function computeLengthVariation(sentences: string[]): number {
  if (sentences.length < 3) return 0.5;
  const lengths = sentences.map((s) => s.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

function computeBigramDiversity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length < 3) return 1;
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  if (bigrams.length === 0) return 1;
  const unique = new Set(bigrams);
  return unique.size / bigrams.length;
}

function computeNonDeclarativeRatio(text: string): number {
  const allEndings = text.match(/[。！？.!?]/g) || [];
  if (allEndings.length === 0) return 0;
  const nonDeclarative = allEndings.filter((e) => e === '？' || e === '!' || e === '！' || e === '?');
  return nonDeclarative.length / allEndings.length;
}

export function analyzeDiversity(text: string): DiversityReport {
  const sentences = splitSentences(text);

  if (sentences.length < 2) {
    return {
      score: 100,
      metrics: {
        starterVariety: 1,
        lengthVariation: 0.5,
        bigramDiversity: 1,
        avgSentenceLength: text.length,
        nonDeclarativeRatio: 0,
      },
      suggestions: [],
    };
  }

  const starterVariety = computeStarterVariety(sentences);
  const lengthVariation = computeLengthVariation(sentences);
  const bigramDiversity = computeBigramDiversity(text);
  const avgSentenceLength = sentences.reduce((sum, s) => sum + tokenize(s).length, 0) / sentences.length;
  const nonDeclarativeRatio = computeNonDeclarativeRatio(text);

  const metrics: DiversityMetrics = {
    starterVariety,
    lengthVariation,
    bigramDiversity,
    avgSentenceLength,
    nonDeclarativeRatio,
  };

  let score = 0;
  score += Math.min(25, starterVariety * 25);
  score += Math.min(25, Math.min(lengthVariation, 0.8) / 0.8 * 25);
  score += Math.min(25, bigramDiversity * 25);
  score += Math.min(15, nonDeclarativeRatio * 75);
  score += avgSentenceLength > 5 && avgSentenceLength < 30 ? 10 : 5;

  const suggestions: string[] = [];
  if (starterVariety < 0.5) {
    suggestions.push('句子开头过于相似，建议变换起始词和句式结构');
  }
  if (lengthVariation < 0.25) {
    suggestions.push('句子长度过于均匀，建议穿插长短句');
  }
  if (bigramDiversity < 0.5) {
    suggestions.push('词组搭配重复率高，建议使用同义词替换');
  }
  if (nonDeclarativeRatio === 0 && sentences.length > 5) {
    suggestions.push('全部是陈述句，偶尔加一个反问句或设问句会更生动');
  }

  return { score: Math.round(Math.min(100, score)), metrics, suggestions };
}
