/**
 * Adversarial de-AI module — systematic rewriting to evade AI text detectors.
 *
 * Targets the three pillars of detection:
 *   1. Perplexity — inject low-frequency synonyms and uncommon phrasings
 *   2. Burstiness — vary sentence lengths and rhythm deliberately
 *   3. Classifier features — disrupt n-gram distributions typical of LLM output
 *
 * All transformations are deterministic (no LLM calls). Designed as a reusable
 * pipeline composable with the existing deai / quality modules.
 */

import { stripAiFlavor } from './deai.js';

/* ================================================================
 * Types
 * ================================================================ */

export interface AdversarialConfig {
  /** Target language: 'zh' | 'en' | 'auto' (default: 'auto') */
  lang?: 'zh' | 'en' | 'auto';
  /** Aggressiveness 1-5 (higher = more rewriting, more risk of meaning shift) */
  strength?: number;
  /** Enable sentence-length jitter pass */
  burstiness?: boolean;
  /** Enable synonym injection pass */
  perplexityBoost?: boolean;
  /** Enable structural shuffle pass */
  structuralShuffle?: boolean;
}

export interface AdversarialReport {
  original: string;
  rewritten: string;
  passes: PassResult[];
  stats: {
    charDelta: number;
    sentenceCountBefore: number;
    sentenceCountAfter: number;
    avgSentLenBefore: number;
    avgSentLenAfter: number;
    sentLenCvBefore: number;
    sentLenCvAfter: number;
  };
}

interface PassResult {
  name: string;
  applied: number;
}

/* ================================================================
 * Sentence utilities
 * ================================================================ */

const SENT_SPLIT_RE = /(?<=[。！？.!?])\s*/;

function splitSentences(text: string): string[] {
  return text.split(SENT_SPLIT_RE).filter((s) => s.trim().length > 0);
}

function isZh(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  return cjk > latin;
}

function sentLen(s: string): number {
  return s.replace(/\s+/g, '').length;
}

function cv(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/* ================================================================
 * Pass 1: Extended phrase replacement (beyond basic deai.ts)
 * Targets classifier-recognized bigrams / trigrams
 * ================================================================ */

const ZH_ADV_PAIRS: Array<[RegExp, string[]]> = [
  [/具有重要意义/g, ['意义不小', '影响深远', '价值颇高']],
  [/发挥着重要作用/g, ['举足轻重', '不可小觑', '地位突出']],
  [/取得了显著(的)?成效/g, ['效果明显', '收效甚佳', '成果可观']],
  [/进行了深入(的)?分析/g, ['做了细致分析', '加以剖析', '予以解读']],
  [/提供了有力(的)?支撑/g, ['给出了支撑', '提供了依据', '打下了基础']],
  [/得到了广泛(的)?应用/g, ['用途很广', '应用面宽', '实践较多']],
  [/面临(着)?巨大(的)?挑战/g, ['挑战不少', '困难不小', '难题待解']],
  [/呈现出(.{2,4})趋势/g, ['走向$1', '有$1的苗头', '朝$1方向发展']],
  [/为(.{2,8})奠定了(.{2,4})基础/g, ['给$1打下了$2底子', '为$1铺了$2路']],
  [/推动了(.{2,8})的发展/g, ['带动了$1前进', '促进了$1进步', '助推了$1']],
  [/实现了(.{2,8})的突破/g, ['在$1上有所突破', '$1取得了进展']],
  [/日益(增长|严峻|复杂|凸显)/g, ['越来越$1', '愈发$1', '逐渐$1']],
  [/旨在/g, ['目的是', '意在', '为了']],
  [/鉴于此/g, ['有鉴于此', '基于这一点', '从这个角度看']],
  [/势在必行/g, ['很有必要', '迫在眉睫', '不可回避']],
  [/行之有效/g, ['切实可行', '确有成效', '管用']],
  [/蓬勃发展/g, ['快速成长', '发展迅猛', '突飞猛进']],
  [/密切相关/g, ['关系紧密', '息息相关', '联系很深']],
];

const EN_ADV_PAIRS: Array<[RegExp, string[]]> = [
  [/\bsignificantly\b/gi, ['notably', 'markedly', 'considerably']],
  [/\bdemonstrate\b/gi, ['show', 'reveal', 'indicate']],
  [/\bfacilitate\b/gi, ['enable', 'help', 'support']],
  [/\butilize\b/gi, ['use', 'employ', 'apply']],
  [/\benhance\b/gi, ['improve', 'boost', 'strengthen']],
  [/\bcomprehensive\b/gi, ['thorough', 'wide-ranging', 'extensive']],
  [/\binnovative\b/gi, ['novel', 'creative', 'original']],
  [/\bstate-of-the-art\b/gi, ['cutting-edge', 'latest', 'advanced']],
  [/\bin order to\b/gi, ['to', 'so as to', 'for']],
  [/\bdue to the fact that\b/gi, ['because', 'since', 'as']],
  [/\bit should be noted that\b/gi, ['note that', '', 'importantly,']],
  [/\bhas been widely adopted\b/gi, ['is now common', 'sees wide use', 'is popular']],
  [/\bexhibit(?:s|ed)?\b/gi, ['show$1', 'display$1', 'have$1']],
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 16) / 32768;
  };
}

function applyPhraseReplacements(text: string, lang: 'zh' | 'en', strength: number): { text: string; count: number } {
  const pairs = lang === 'zh' ? ZH_ADV_PAIRS : EN_ADV_PAIRS;
  let result = text;
  let count = 0;
  const rng = seededRandom(text.length);

  for (const [pattern, replacements] of pairs) {
    result = result.replace(pattern, (match: string, ...groups: unknown[]) => {
      if (rng() > strength / 5) return match;
      count++;
      const chosen = replacements[Math.floor(rng() * replacements.length)] ?? match;
      let rep = chosen;
      for (let i = 0; i < groups.length - 2; i++) {
        const g = groups[i];
        if (typeof g === 'string') {
          rep = rep.replace(`$${i + 1}`, g);
        }
      }
      return rep;
    });
  }

  return { text: result, count };
}

/* ================================================================
 * Pass 2: Burstiness injection — vary sentence rhythm
 * Split overly long uniform sentences; merge very short adjacent ones
 * ================================================================ */

function injectBurstiness(text: string, lang: 'zh' | 'en', strength: number): { text: string; count: number } {
  const sentences = splitSentences(text);
  if (sentences.length < 4) return { text, count: 0 };

  const lens = sentences.map(sentLen);
  const currentCv = cv(lens);

  if (currentCv >= 0.35) return { text, count: 0 };

  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const rng = seededRandom(text.length + 7);
  const result: string[] = [];
  let changes = 0;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const len = sentLen(s);

    if (len > mean * 1.6 && rng() < strength / 5) {
      const zhSplitters = [/([，,])(?=.{15,})/];
      const enSplitters = [/(,\s)(?=\S{10,})/];
      const splitters = lang === 'zh' ? zhSplitters : enSplitters;

      let didSplit = false;
      for (const sp of splitters) {
        const m = s.search(sp);
        if (m > s.length * 0.3 && m < s.length * 0.7) {
          result.push(s.slice(0, m + 1).trim() + (lang === 'zh' ? '。' : '.'));
          result.push(s.slice(m + 1).trim());
          didSplit = true;
          changes++;
          break;
        }
      }
      if (!didSplit) result.push(s);
    } else if (
      len < mean * 0.4 &&
      i + 1 < sentences.length &&
      sentLen(sentences[i + 1]!) < mean * 0.5 &&
      rng() < strength / 5
    ) {
      const joiner = lang === 'zh' ? '，' : ', ';
      const merged = s.replace(/[。.]\s*$/, '') + joiner + sentences[i + 1]!;
      result.push(merged);
      i++;
      changes++;
    } else {
      result.push(s);
    }
  }

  return { text: result.join(''), count: changes };
}

/* ================================================================
 * Pass 3: Structural micro-edits — disrupt token distribution
 * Insert parenthetical asides, reorder clauses, swap connectors
 * ================================================================ */

const ZH_CONNECTOR_SWAPS: Array<[RegExp, string[]]> = [
  [/^此外[，,]?\s*/m, ['除此之外，', '再者，', '另一方面，', '还有，']],
  [/^因此[，,]?\s*/m, ['所以，', '正因如此，', '于是，', '据此，']],
  [/^然而[，,]?\s*/m, ['不过，', '但是，', '话说回来，', '可是，']],
  [/^同时[，,]?\s*/m, ['与此同时，', '并且，', '加之，']],
  [/^第一[，,]?\s*/m, ['首先，', '先看第一点，', '一是']],
  [/^第二[，,]?\s*/m, ['其次，', '再看第二点，', '二是']],
  [/^第三[，,]?\s*/m, ['接着说第三点，', '此外，', '三是']],
  [/^第四[，,]?\s*/m, ['再往下看，', '另外，', '四是']],
  [/^第五[，,]?\s*/m, ['最后一点，', '还有，', '五是']],
];

const EN_CONNECTOR_SWAPS: Array<[RegExp, string[]]> = [
  [/^Additionally[,]?\s*/im, ['On top of that, ', 'Beyond this, ', 'What\'s more, ']],
  [/^Therefore[,]?\s*/im, ['So ', 'Thus, ', 'As a result, ', 'Consequently, ']],
  [/^However[,]?\s*/im, ['That said, ', 'On the other hand, ', 'Yet, ', 'Still, ']],
  [/^Meanwhile[,]?\s*/im, ['At the same time, ', 'In parallel, ']],
];

function structuralShuffle(text: string, lang: 'zh' | 'en', strength: number): { text: string; count: number } {
  const sentences = splitSentences(text);
  const rng = seededRandom(text.length + 13);
  let count = 0;
  const swaps = lang === 'zh' ? ZH_CONNECTOR_SWAPS : EN_CONNECTOR_SWAPS;

  const result = sentences.map((s) => {
    if (rng() > strength / 5) return s;

    for (const [pattern, replacements] of swaps) {
      if (pattern.test(s)) {
        const chosen = replacements[Math.floor(rng() * replacements.length)] ?? s;
        const newS = s.replace(pattern, chosen);
        if (newS !== s) {
          count++;
          return newS;
        }
      }
    }
    return s;
  });

  return { text: result.join(''), count };
}

/* ================================================================
 * Public API
 * ================================================================ */

const DEFAULT_CONFIG: Required<AdversarialConfig> = {
  lang: 'auto',
  strength: 3,
  burstiness: true,
  perplexityBoost: true,
  structuralShuffle: true,
};

export function adversarialRewrite(input: string, config?: AdversarialConfig): AdversarialReport {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lang = cfg.lang === 'auto' ? (isZh(input) ? 'zh' : 'en') : cfg.lang;

  let text = stripAiFlavor(input);
  const passes: PassResult[] = [];

  if (cfg.perplexityBoost) {
    const r = applyPhraseReplacements(text, lang, cfg.strength);
    text = r.text;
    passes.push({ name: 'perplexity-boost', applied: r.count });
  }

  if (cfg.burstiness) {
    const r = injectBurstiness(text, lang, cfg.strength);
    text = r.text;
    passes.push({ name: 'burstiness-inject', applied: r.count });
  }

  if (cfg.structuralShuffle) {
    const r = structuralShuffle(text, lang, cfg.strength);
    text = r.text;
    passes.push({ name: 'structural-shuffle', applied: r.count });
  }

  const sentsBefore = splitSentences(input);
  const sentsAfter = splitSentences(text);

  return {
    original: input,
    rewritten: text,
    passes,
    stats: {
      charDelta: text.length - input.length,
      sentenceCountBefore: sentsBefore.length,
      sentenceCountAfter: sentsAfter.length,
      avgSentLenBefore: sentsBefore.length > 0
        ? Math.round(sentsBefore.reduce((s, x) => s + sentLen(x), 0) / sentsBefore.length)
        : 0,
      avgSentLenAfter: sentsAfter.length > 0
        ? Math.round(sentsAfter.reduce((s, x) => s + sentLen(x), 0) / sentsAfter.length)
        : 0,
      sentLenCvBefore: Math.round(cv(sentsBefore.map(sentLen)) * 100) / 100,
      sentLenCvAfter: Math.round(cv(sentsAfter.map(sentLen)) * 100) / 100,
    },
  };
}
