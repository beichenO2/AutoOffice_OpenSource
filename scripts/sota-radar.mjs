#!/usr/bin/env node
/**
 * SOTA Radar — weekly tech-stack scan for AutoOffice, with crystallization.
 *
 * Pipeline:
 *   1. Stack fingerprint — extracted from package.json deps + polaris.json
 *      requirements[].tech (with versions and the R-requirements they serve),
 *      not from a hand-written keyword list.
 *   2. Retrieval — digist (:3800) recent items for fingerprint terms plus a
 *      few horizon keywords (things we don't use yet but should watch).
 *   3. Crystallization scoring (explainable, no LLM): directness (names one
 *      of our actual components?) + actionability (release/tool > paper >
 *      discussion) + impact (how many R-requirements it maps to) + novelty
 *      (not already in the previous report).
 *   4. LLM (PolarPrivate proxy) judges only the Top-N crystallized items,
 *      grounded with our current implementation facts. Degrades gracefully.
 *   5. Report to reports/sota-radar-YYYYMMDD.md + info lobster event for the
 *      PolarPilot observer daemon.
 *
 * Hard rule: report only — never touches code or dependencies. Upgrades are
 * executed by humans after reviewing the report.
 *
 * Scheduled via PolarProcess service `autooffice-sota-radar`, cron 0 9 * * 1.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIGIST_URL = (process.env.DIGIST_URL || 'http://127.0.0.1:3800').replace(/\/$/, '');
const POLARPRIVATE_URL = (process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790').replace(/\/$/, '');
const PILOT_URL = (process.env.PILOT_URL || 'http://127.0.0.1:4900').replace(/\/$/, '');
const RADAR_DAYS = Number.parseInt(process.env.RADAR_DAYS || '14', 10);
const TOP_N = Number.parseInt(process.env.RADAR_TOP_N || '5', 10);

/**
 * Horizon keywords: adjacent tech we do NOT use yet but must watch.
 * Kept short on purpose — the load-bearing terms come from the fingerprint.
 */
const HORIZON_KEYWORDS = [
  'typst',
  'slide generation',
  'presentation AI',
  'document generation',
  'AI text detection',
  'pandoc',
];

/** Alias map: dependency name → extra search terms people actually write. */
const TERM_ALIASES = {
  pptxgenjs: ['pptx'],
  docx: ['docx', 'word document'],
  playwright: ['playwright pdf'],
  mermaid: ['mermaid diagram'],
  handlebars: [],
  jszip: [],
  jsdom: [],
  dompurify: [],
  express: [],
  commander: [],
  '@resvg/resvg-js': ['resvg', 'svg render'],
  svgdom: [],
};

/** Deps that are plumbing, not differentiating tech — skip in retrieval. */
const FINGERPRINT_SKIP = new Set(['express', 'commander', 'jsdom', 'jszip', 'handlebars', 'svgdom', 'dompurify']);

async function fetchJson(url, init, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// 1. Stack fingerprint — derive "what actually matters to us" from SSoT
// ---------------------------------------------------------------------------

/**
 * @returns {{ terms: Array<{term:string, component:string, requirements:string[], version?:string}>,
 *             components: Map<string,{version?:string, requirements:string[]}> }}
 */
function buildStackFingerprint() {
  const components = new Map();

  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    for (const [dep, ver] of Object.entries(pkg.dependencies || {})) {
      components.set(dep.toLowerCase(), { version: String(ver), requirements: [] });
    }
  } catch { /* package.json optional */ }

  try {
    const polaris = JSON.parse(readFileSync(join(ROOT, 'polaris.json'), 'utf-8'));
    for (const req of polaris.requirements || []) {
      for (const techName of Object.keys(req.tech || {})) {
        const key = techName.toLowerCase();
        const entry = components.get(key) || { version: req.tech[techName], requirements: [] };
        if (!entry.requirements.includes(req.id)) entry.requirements.push(req.id);
        components.set(key, entry);
      }
    }
  } catch { /* polaris.json optional */ }

  let runtimeDeps = new Set();
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    runtimeDeps = new Set(Object.keys(pkg.dependencies || {}).map((d) => d.toLowerCase()));
  } catch { /* already tolerated above */ }

  const terms = [];
  for (const [name, meta] of components) {
    if (FINGERPRINT_SKIP.has(name)) continue;
    // core = shipped runtime dependency; peripheral = polaris tech only
    // (deployment/LLM infra like docker, llama.cpp) — matters less for
    // "key technology" ranking of the report-generation product itself.
    const tier = runtimeDeps.has(name) ? 'core' : 'peripheral';
    const aliases = TERM_ALIASES[name] ?? [name];
    const searchTerms = aliases.length > 0 ? aliases : [name];
    for (const term of searchTerms) {
      terms.push({ term, component: name, tier, requirements: meta.requirements, version: meta.version });
    }
  }
  return { terms, components };
}

// ---------------------------------------------------------------------------
// 2. Retrieval
// ---------------------------------------------------------------------------

async function searchKeyword(kw) {
  const url = `${DIGIST_URL}/api/items/recent?q=${encodeURIComponent(kw)}&limit=10`;
  const data = await fetchJson(url);
  const cutoff = Date.now() - RADAR_DAYS * 24 * 3600 * 1000;
  return (data.items || []).filter((it) => {
    const ts = Date.parse(it.timestamp || '');
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// 3. Crystallization — explainable scoring of what is a "key technology"
// ---------------------------------------------------------------------------

/** Signals that an item is actionable tech (usable now) vs. just discussion. */
const ACTIONABLE_RE = /show hn|release|\bv?\d+\.\d+(\.\d+)?\b|sdk|cli|open.?source|library|engine|framework/i;
const PAPER_RE = /arxiv/i;

function previousReportUrls() {
  const dir = join(ROOT, 'reports');
  if (!existsSync(dir)) return new Set();
  const seen = new Set();
  for (const f of readdirSync(dir)) {
    if (!/^sota-radar-\d{8}\.md$/.test(f)) continue;
    const text = readFileSync(join(dir, f), 'utf-8');
    for (const m of text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) seen.add(m[1]);
  }
  return seen;
}

/**
 * Score one item. Every point is explainable and reported.
 * @returns {{score:number, reasons:string[], requirements:string[]}}
 */
function crystallize(item, matchedTerms, fingerprint, seenUrls) {
  let score = 0;
  const reasons = [];
  const reqs = new Set();
  const title = (item.title || '').toLowerCase();

  // Directness: names one of our actual components (or its alias) in title.
  // Core (shipped runtime dep) outranks peripheral (deploy/LLM infra).
  const direct = matchedTerms.filter((t) => title.includes(t.term.toLowerCase()));
  if (direct.length > 0) {
    const coreHit = direct.some((d) => d.tier !== 'peripheral');
    score += coreHit ? 3 : 2;
    reasons.push(`直指${coreHit ? '核心' : '外围'}组件 ${[...new Set(direct.map((d) => d.component))].join('/')}`);
  } else {
    score += 1; // matched only via search recall
  }
  for (const t of matchedTerms) for (const r of t.requirements) reqs.add(r);

  // Impact: maps to more of our R-requirements → more of the product touched.
  if (reqs.size >= 2) {
    score += 2;
    reasons.push(`覆盖 ${reqs.size} 项需求(${[...reqs].join(',')})`);
  } else if (reqs.size === 1) {
    score += 1;
    reasons.push(`关联需求 ${[...reqs][0]}`);
  }

  // Actionability: a release/tool beats a paper beats a thread.
  if (ACTIONABLE_RE.test(item.title || '')) {
    score += 2;
    reasons.push('可落地（发布/工具/版本）');
  } else if (PAPER_RE.test(item.platform || '')) {
    score += 1;
    reasons.push('论文（方法参考）');
  }

  // Novelty: first appearance across all previous radar reports.
  if (!seenUrls.has(item.source_url)) {
    score += 1;
  } else {
    reasons.push('往期已收录');
    score -= 1;
  }

  return { score, reasons, requirements: [...reqs] };
}

// ---------------------------------------------------------------------------
// 4. Grounded LLM judgement on the crystallized Top-N only
// ---------------------------------------------------------------------------

async function llmJudgeTop(topItems, fingerprint) {
  if (topItems.length === 0) return null;

  const stackFacts = [...fingerprint.components.entries()]
    .filter(([name]) => !FINGERPRINT_SKIP.has(name))
    .map(([name, m]) => `- ${name}@${m.version ?? '?'}${m.requirements.length ? `（服务需求 ${m.requirements.join(',')}）` : ''}`)
    .join('\n');

  const itemLines = topItems
    .map((e, i) => `${i + 1}. [${e.item.title}](${e.item.source_url}) · ${e.item.platform} · 结晶分 ${e.score}（${e.reasons.join('；')}）`)
    .join('\n');

  const body = {
    model: '0001',
    max_tokens: 900,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          '你是 AutoOffice 的技术雷达评审。AutoOffice 当前实现事实（唯一依据，不得假设其它实现）：\n' +
          `${stackFacts}\n输出格式：pptx/pdf/docx/latex/html + de-AI 文本处理。\n\n` +
          '对下面已按结晶分排序的候选逐条判断：【采纳评估/继续观察/忽略】+ 一句依据（必须引用上面的实现事实说明它替换/增强哪个组件、影响哪个需求）+ 一句风险。' +
          '禁止泛泛而谈，禁止引入列表之外的条目。最后用一行回答：本期是否存在值得立项评估的关键技术？',
      },
      { role: 'user', content: itemLines.slice(0, 10_000) },
    ],
  };
  const data = await fetchJson(`${POLARPRIVATE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 120_000);
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function emitPilotEvent(reportRelPath, totalHits) {
  const day = new Date().toISOString().slice(0, 10);
  await fetchJson(`${PILOT_URL}/api/pilot/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'custom',
      source_project: 'AutoOffice',
      target_project: 'AutoOffice',
      severity: 'info',
      payload: { kind: 'sota-radar', report: reportRelPath, hits: totalHits },
      dedup_key: `sota-radar:${day}`,
    }),
  });
}

async function main() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');

  // 1. fingerprint from SSoT (before this run's report exists)
  const fingerprint = buildStackFingerprint();
  const seenUrls = previousReportUrls();

  // 2. retrieval: fingerprint terms + horizon keywords
  const queries = [
    ...fingerprint.terms.map((t) => ({ label: t.term, terms: [t] })),
    ...HORIZON_KEYWORDS.map((kw) => ({ label: kw, terms: [] })),
  ];

  /** url → { item, matchedTerms:Set, labels:Set } */
  const pool = new Map();
  const sectionStats = [];
  for (const q of queries) {
    try {
      const items = await searchKeyword(q.label);
      sectionStats.push({ label: q.label, hits: items.length, error: null });
      for (const it of items) {
        const entry = pool.get(it.source_url) || { item: it, matchedTerms: new Map(), labels: new Set() };
        for (const t of q.terms) entry.matchedTerms.set(t.term, t);
        entry.labels.add(q.label);
        pool.set(it.source_url, entry);
      }
    } catch (err) {
      sectionStats.push({ label: q.label, hits: 0, error: String(err?.message || err) });
    }
  }

  // 3. crystallize
  const scored = [...pool.values()].map((e) => {
    const res = crystallize(e.item, [...e.matchedTerms.values()], fingerprint, seenUrls);
    return { ...e, ...res };
  }).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);
  const totalHits = pool.size;

  // 4. grounded judgement on Top-N only
  let judgement = null;
  let judgementNote = '';
  try {
    judgement = await llmJudgeTop(top, fingerprint);
    if (!judgement) judgementNote = '（本期无候选，未请求评审）';
  } catch (err) {
    judgementNote = `（LLM 评审不可用，本期只出结晶分：${String(err?.message || err)}）`;
  }

  // 5. report
  const lines = [
    `# AutoOffice SOTA 雷达 — ${now.toISOString().slice(0, 10)}`,
    '',
    `> 数据源：digist 采集库（近 ${RADAR_DAYS} 天）· 指纹词 ${fingerprint.terms.length} + 视野词 ${HORIZON_KEYWORDS.length} · 去重命中 ${totalHits} 条`,
    '> 结晶分 = 直指在用组件(3/1) + 需求覆盖(≤2) + 可落地性(≤2) + 新颖度(±1)，逐条给出理由。',
    '> 本报告只做情报聚合，不自动改动任何代码或依赖；升级需人工评审后执行。',
    '',
    '## 关键技术结晶（Top ' + top.length + '）',
    '',
  ];

  for (const [i, e] of top.entries()) {
    const day = (e.item.timestamp || '').slice(0, 10);
    lines.push(`${i + 1}. **[${e.item.title}](${e.item.source_url})** · ${e.item.platform} · ${day}`);
    lines.push(`   - 结晶分 **${e.score}** — ${e.reasons.join('；') || '仅检索召回'}`);
    if (e.requirements.length) lines.push(`   - 影响需求：${e.requirements.join(', ')}`);
    lines.push('');
  }

  lines.push('## 评审（基于当前实现事实）', '', judgement ?? judgementNote ?? '（无）', '');

  lines.push('## 全部命中（按结晶分）', '');
  for (const e of scored) {
    const day = (e.item.timestamp || '').slice(0, 10);
    lines.push(`- [${e.score}] [${e.item.title}](${e.item.source_url}) · ${e.item.platform} · ${day} · 来源词: ${[...e.labels].join(', ')}`);
  }
  lines.push('');

  lines.push('## 检索统计', '');
  for (const s of sectionStats) {
    lines.push(`- ${s.label}: ${s.error ? `失败(${s.error})` : `${s.hits} 条`}`);
  }
  lines.push('');

  const reportRel = join('reports', `sota-radar-${stamp}.md`);
  const reportAbs = join(ROOT, reportRel);
  mkdirSync(dirname(reportAbs), { recursive: true });
  writeFileSync(reportAbs, lines.join('\n'), 'utf-8');
  console.log(`[sota-radar] report written: ${reportRel} (${totalHits} unique hits, top score ${top[0]?.score ?? '-'})`);

  try {
    await emitPilotEvent(reportRel, totalHits);
    console.log('[sota-radar] pilot event emitted');
  } catch (err) {
    console.warn(`[sota-radar] pilot event skipped: ${String(err?.message || err)}`);
  }
}

main().catch((err) => {
  console.error('[sota-radar] failed:', err);
  process.exit(1);
});
