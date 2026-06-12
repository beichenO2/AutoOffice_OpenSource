/**
 * REQ-A06（部分）：规则驱动的「去 AI 味道」文本清理。
 * 确定性替换，不调用 LLM。
 */

const PAIRS: Array<[RegExp, string]> = [
  // Chinese AI patterns
  [/综上所述[,，]?\s*/g, '总体来看，'],
  [/总而言之[,，]?\s*/g, '简要地说，'],
  [/值得注意的是[,，]?\s*/g, '另外，'],
  [/值得一提的是[,，]?\s*/g, '还有一点：'],
  [/众所周知[,，]?\s*/g, ''],
  [/不言而喻[,，]?\s*/g, ''],
  [/本文旨在/g, '下文说明'],
  [/本文将/g, '下面将'],
  [/深入探讨/g, '讨论'],
  [/深入研究/g, '细查'],
  [/不可或缺/g, '必要'],
  [/充分利用/g, '用好'],
  [/显著提升/g, '明显改善'],
  [/大量的/g, '不少'],
  [/丰富的/g, '多样'],
  [/至关重要/g, '很关键'],
  [/如上所述/g, '前面提到的'],
  [/总之[,，]?\s*/g, '简单说，'],
  [/与此同时[,，]?\s*/g, '同时，'],
  [/需要指出的是[,，]?\s*/g, ''],
  [/由此可见[,，]?\s*/g, '所以，'],
  [/毫无疑问[,，]?\s*/g, ''],
  [/无可否认[,，]?\s*/g, ''],
  [/在当今社会/g, '现在'],
  [/在这个快速发展的时代/g, '如今'],
  [/随着科技的不断进步/g, '近年来'],
  // English AI patterns
  [/It is important to note that\s*/gi, 'Note that '],
  [/It is worth noting that\s*/gi, 'Note that '],
  [/It is worth mentioning that\s*/gi, ''],
  [/In conclusion[,]?\s*/gi, 'In short, '],
  [/To conclude[,]?\s*/gi, 'To wrap up, '],
  [/\bLeverage\b/gi, 'Use'],
  [/\bdelve into\b/gi, 'look at'],
  [/\bdelve\b/gi, 'explore'],
  [/\bFurthermore[,]?\s*/gi, 'Also, '],
  [/\bMoreover[,]?\s*/gi, 'Also, '],
  [/\bIt's important to\b/gi, 'You should'],
  [/\bIn today's rapidly evolving\b/gi, "In today's"],
  [/\bIn the realm of\b/gi, 'In'],
  [/\bIt goes without saying\b/gi, ''],
  [/\bplays a (?:crucial|pivotal|vital) role\b/gi, 'matters'],
  [/\bThis (?:comprehensive|in-depth) guide\b/gi, 'This guide'],
  [/\bseamlessly\b/gi, 'smoothly'],
  [/\brobust\b/gi, 'solid'],
  [/\btap into\b/gi, 'use'],
  [/\bgame-changer\b/gi, 'breakthrough'],
  [/\bparadigm shift\b/gi, 'major change'],
  [/\bHowever, it (?:is|'s) (?:important|essential|crucial) to\b/gi, 'But you should'],
];

export function stripAiFlavor(input: string): string {
  let s = input;
  for (const [re, rep] of PAIRS) {
    s = s.replace(re, rep);
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

export function stripAiFlavorDeep(value: unknown): unknown {
  if (typeof value === 'string') return stripAiFlavor(value);
  if (Array.isArray(value)) return value.map(stripAiFlavorDeep);
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      o[k] = stripAiFlavorDeep(v);
    }
    return o;
  }
  return value;
}
