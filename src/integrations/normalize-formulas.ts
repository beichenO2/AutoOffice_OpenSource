/**
 * normalize-formulas.ts — Post-OCR formula protection layer.
 *
 * Detects bare math/chemistry in Markdown text and wraps with LaTeX $...$ / $$...$$.
 * Uses LLM for ambiguous cases; regex for obvious patterns.
 *
 * Adapted from KnowLever's normalize-formulas.js.
 */
import { chatCompletion } from './llm-proxy.js';

const MATH_SYMBOLS = /[αβγδεζηθικλμνξπρστυφχψωΔΣΠ∫∂∞≥≤≠≈∈∉⊂⊃∪∩±×÷√∝∀∃⇒⇔→←↑↓]/;
const SUPERSCRIPT_PATTERN = /(?<![$`])\b([A-Za-z]+)(\d+)\b(?![$`])/g;
const CHEMICAL_FORMULA = /\b([A-Z][a-z]?(?:\d+)?(?:[A-Z][a-z]?(?:\d+)?){1,})\b/g;

export interface FormulaNormalizeResult {
  changed: boolean;
  candidates: number;
  fixed: number;
  output: string;
}

export interface FormulaCandidate {
  line: number;
  text: string;
  reason: string;
  matches?: string[];
}

export function detectMathCandidates(text: string): FormulaCandidate[] {
  const lines = text.split('\n');
  const candidates: FormulaCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('```') || line.startsWith('    ') || line.startsWith('\t')) continue;
    if (/\$[^$]+\$/.test(line)) continue;

    if (MATH_SYMBOLS.test(line)) {
      candidates.push({ line: i + 1, text: line, reason: 'math_symbol' });
      continue;
    }

    if (SUPERSCRIPT_PATTERN.test(line)) {
      SUPERSCRIPT_PATTERN.lastIndex = 0;
      candidates.push({ line: i + 1, text: line, reason: 'bare_superscript' });
      continue;
    }

    const chemMatches = line.match(CHEMICAL_FORMULA);
    if (chemMatches) {
      const confirmed = chemMatches.filter(m =>
        /[A-Z][a-z]?\d/.test(m) && m.length >= 3 && m.length <= 20,
      );
      if (confirmed.length > 0) {
        candidates.push({ line: i + 1, text: line, reason: 'chemical_formula', matches: confirmed });
      }
    }
  }

  return candidates;
}

const FORMULA_FIX_PROMPT = `你是公式格式化助手。以下文本行中可能含有未用 LaTeX 包裹的数学公式或化学式。

规则：
- 数学公式/变量用 $...$ 包裹（inline）或 $$...$$ 包裹（独占一行的长公式）
- 化学式也用 $...$ 包裹：$H_2O$, $NaOH$, $CH_3COOH$
- 上下标：$x^2$, $C_A^n$, $a_1$
- 希腊字母：$\\alpha$, $\\beta$, $\\gamma$
- 箭头：$\\to$, $\\rightarrow$
- 如果一行已经有 $ 包裹的部分，不要重复包裹
- 只修改需要 LaTeX 包裹的部分，保持其余文本不变
- 如果某行不含任何公式，原样返回

请对每一行输出修正后的结果。只输出修正后的行，不要解释。`;

async function fixFormulasViaLlm(lines: string[]): Promise<string[]> {
  if (lines.length === 0) return [];

  const userContent = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

  try {
    const output = await chatCompletion(
      [
        { role: 'system', content: FORMULA_FIX_PROMPT },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.1, maxTokens: 32768 },
    );

    const fixedLines = output.split('\n')
      .map((l: string) => l.replace(/^\d+\.\s*/, '').trim())
      .filter((l: string) => l.length > 0);

    if (fixedLines.length === lines.length) return fixedLines;
    return lines;
  } catch {
    return lines;
  }
}

/**
 * Normalize formulas in markdown text: detect bare math and wrap with LaTeX.
 * Returns the processed text and stats.
 */
export async function normalizeFormulas(text: string): Promise<FormulaNormalizeResult> {
  const candidates = detectMathCandidates(text);

  if (candidates.length === 0) {
    return { changed: false, candidates: 0, fixed: 0, output: text };
  }

  const lines = text.split('\n');
  let totalFixed = 0;
  const batchSize = 20;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchTexts = batch.map(c => c.text);
    const fixed = await fixFormulasViaLlm(batchTexts);

    for (let j = 0; j < batch.length; j++) {
      const lineIdx = batch[j]!.line - 1;
      if (fixed[j] && fixed[j] !== lines[lineIdx]) {
        lines[lineIdx] = fixed[j]!;
        totalFixed++;
      }
    }
  }

  return {
    changed: totalFixed > 0,
    candidates: candidates.length,
    fixed: totalFixed,
    output: lines.join('\n'),
  };
}
