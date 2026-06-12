/**
 * Unified text quality analysis.
 * Combines de-AI detection, monotony analysis, and diversity scoring
 * into a single quality report with actionable recommendations.
 */

import { stripAiFlavor } from './deai.js';
import { analyzeMonotony, type MonotonyReport } from './monotony.js';
import { analyzeDiversity, type DiversityReport } from './diversity.js';

export interface QualityReport {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  aiFlavorDetected: number;
  monotony: MonotonyReport;
  diversity: DiversityReport;
  processedText: string;
  recommendations: string[];
  wordCount: number;
}

function countAiPatterns(original: string, cleaned: string): number {
  const origLen = original.length;
  const cleanLen = cleaned.length;
  if (origLen === 0) return 0;
  return Math.max(0, origLen - cleanLen);
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter((w) => w.length > 0).length;
  return cjk + latin;
}

export function analyzeQuality(text: string): QualityReport {
  const cleaned = stripAiFlavor(text);
  const aiPatternChars = countAiPatterns(text, cleaned);
  const monotony = analyzeMonotony(cleaned);
  const diversity = analyzeDiversity(cleaned);
  const wordCount = countWords(text);

  const aiPenalty = Math.min(20, Math.floor(aiPatternChars / 10));
  const overallScore = Math.round(
    Math.max(0, (monotony.score * 0.35 + diversity.score * 0.35 + (100 - aiPenalty) * 0.30)),
  );

  const recommendations: string[] = [];
  if (aiPatternChars > 0) {
    recommendations.push(`检测到 ${aiPatternChars} 字符的 AI 典型措辞，已自动清理`);
  }
  recommendations.push(...monotony.suggestions);
  recommendations.push(...diversity.suggestions);

  if (recommendations.length === 0) {
    recommendations.push('文本质量良好，无需调整');
  }

  return {
    overallScore,
    grade: gradeFromScore(overallScore),
    aiFlavorDetected: aiPatternChars,
    monotony,
    diversity,
    processedText: cleaned,
    recommendations,
    wordCount,
  };
}
