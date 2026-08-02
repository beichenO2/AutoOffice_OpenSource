/**
 * Visual "微调" — deck-wide style presets (科技风/党政风/商务) + element-level visual
 * tweaks (居中/字号/线粗…). Guards: aoStyle frontmatter → pack CSS injection,
 * explicit aoAccent still wins on top of a pack, classifier routes the style axis
 * (deck preset vs local tweak), and the style whitelist / deterministic map.
 */
import { describe, it, expect } from 'vitest';
import {
  renderSlidesMd,
  previewHtmlFromSlidesMd,
  deckStyleFromMd,
  normalizeDeckStyleId,
} from '../../src/engine/slidev/generate.js';
import { setDeckStyleInFrontmatter, setDeckAccentInFrontmatter } from '../../src/engine/slidev/edit.js';
import { classifyEditScope, resolveStylePreset } from '../../src/engine/skills.js';
import { deterministicStyleOps, sanitizeStyleMap, mergeInlineStyle, sizeNudgeFactor, roleBaseFontVw } from '../../src/engine/llm-edit.js';
import type { DeckSpec } from '../../src/engine/html/generate.js';

const deck: DeckSpec = {
  title: 't',
  slides: [{ layout: 'content' as never, title: '标题', elements: [{ id: 'b1', type: 'bullet', text: '要点一' }] }],
};
const baseMd = renderSlidesMd(deck);

describe('deck style packs (Tier A · aoStyle frontmatter)', () => {
  it('injects the 科技风 pack: light + restrained tech-blue accent + clean sans', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'tech'));
    expect(html).toContain('--ao-accent:#2563eb');
    expect(html).toContain('Inter');
    expect(html).not.toContain('#0a0a0b'); // NOT the gloomy dark surface
  });

  it('injects the 党政风 pack: 中国红 accent + serif faces', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'gov'));
    expect(html).toContain('--ao-accent:#b01e23');
    expect(html).toContain('Songti SC');
  });

  it('injects the 商务简约 pack: corporate navy accent', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'business'));
    expect(html).toContain('--ao-accent:#1f4e79');
  });

  it('injects the 学术风(国标) pack: navy primary + red emphasis + sans', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'academic'));
    expect(html).toContain('--ao-accent:#16367a');
    expect(html).toContain('Microsoft YaHei');
    expect(html).toContain('#c0392b'); // 蓝主红强调
  });

  it('injects the 极简风 pack: near-black monochrome accent', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'minimal'));
    expect(html).toContain('--ao-accent:#111827');
  });

  it('styles the FIGURE differently per pack (not just color): frame / shadow / radius', () => {
    const tech = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'tech'));
    const gov = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'gov'));
    const minimal = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'minimal'));
    // tech figure = clean light card (fine border + faint blue shadow); gov = matted sharp frame; minimal = bare
    expect(tech).toMatch(/img\.ao-el\{border-radius:\.7vw/);
    expect(tech).toContain('rgba(37,99,235,.12)');
    expect(gov).toMatch(/img\.ao-el\{border-radius:0;box-shadow:none;background:#ffffff;padding:\.5vw/);
    expect(minimal).toMatch(/img\.ao-el\{border-radius:0;border:0;box-shadow:none/);
  });

  it('varies bullet markers + layout per pack (公文层次序数 / dash / oversized-title)', () => {
    const gov = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'gov'));
    const minimal = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'minimal'));
    // gov: 公文层次序数「一、二、三」(GB/T 9704 条目化), not a decorative square
    expect(gov).toContain('content:counter(aoli,simp-chinese-informal) "、"');
    expect(minimal).toMatch(/li\.ao-el::before\{background:#111827;border-radius:0;.*width:1\.5vw;height:\.16vw/); // dash
    // minimal LAYOUT template: oversized title (not just a skin)
    expect(minimal).toContain('font-size:5.4vw');
  });

  it('no pack CSS when aoStyle is absent', () => {
    const html = previewHtmlFromSlidesMd(baseMd);
    expect(html).not.toContain('--ao-accent:#38bdf8');
    expect(html).not.toContain('Space Grotesk');
  });

  it('an explicit aoAccent still overrides the pack accent (accent injected last)', () => {
    const md = setDeckAccentInFrontmatter(setDeckStyleInFrontmatter(baseMd, 'tech'), '#ff0000');
    const html = previewHtmlFromSlidesMd(md);
    expect(html).toContain('--ao-accent:#ff0000');
    // the explicit accent override block sits AFTER the pack's accent token
    expect(html.lastIndexOf('#ff0000')).toBeGreaterThan(html.indexOf('#2563eb'));
  });

  it('deckStyleFromMd reads the id and Chinese aliases; normalizeDeckStyleId maps aliases', () => {
    expect(deckStyleFromMd(setDeckStyleInFrontmatter(baseMd, 'tech'))).toBe('tech');
    expect(deckStyleFromMd(setDeckStyleInFrontmatter(baseMd, '科技风'))).toBe('tech');
    expect(normalizeDeckStyleId('党政风')).toBe('gov');
    expect(normalizeDeckStyleId('商务')).toBe('business');
    expect(normalizeDeckStyleId('nope')).toBeNull();
  });

  it('national-standard aliases (国标/顶会/基金/答辩) map to the academic pack', () => {
    for (const a of ['国标', '国标风', '顶会', '会议', '基金', '基金申请', '答辩']) {
      expect(normalizeDeckStyleId(a)).toBe('academic');
    }
  });

  it('公文/红头 national-standard aliases (GB/T 9704) map to the gov pack', () => {
    for (const a of ['公文格式', '公文风', '红头文件', '红头', '政务风']) {
      expect(normalizeDeckStyleId(a)).toBe('gov');
    }
    expect(resolveStylePreset('帮我改成红头文件那种')).toBe('gov');
    expect(resolveStylePreset('要公文格式的')).toBe('gov');
  });
});

describe('per-style LAYOUT templates (真·换版式，非换皮) — the data-ao-style axis', () => {
  it('tags <body> with data-ao-style so packs own layout, not just skin', () => {
    expect(previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'tech')))
      .toContain('<body data-ao-deck="1" data-ao-style="tech">');
    expect(previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'minimal')))
      .toContain('<body data-ao-deck="1" data-ao-style="minimal">');
    // no aoStyle → plain body, no layout axis
    expect(previewHtmlFromSlidesMd(baseMd)).toContain('<body data-ao-deck="1">');
    expect(previewHtmlFromSlidesMd(baseMd)).not.toContain('data-ao-style=');
  });

  it('科技 = HERO: right full-bleed figure panel (edge-to-edge, tinted) + statement title', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'tech'));
    // figure bleeds to the right/top/bottom edges, half-width, on a light-blue panel
    expect(html).toMatch(/body\[data-ao-style="tech"\] \.ao-slide\[data-ao-media\] > img\.ao-el\{[^}]*top:0;right:0;bottom:0/);
    expect(html).toMatch(/body\[data-ao-style="tech"\][^{]*img\.ao-el\{[^}]*width:46vw;height:100%/);
    expect(html).toMatch(/body\[data-ao-style="tech"\][^{]*img\.ao-el\{[^}]*background:#eef4ff/);
    // page number moves off the panel to the left on hero image slides
    expect(html).toMatch(/body\[data-ao-style="tech"\] \.ao-slide\[data-ao-media\]:not\(\[data-ao-layout="title"\]\)::before\{right:auto;left:7\.4vw/);
  });

  it('极简 = TITLE-DOMINANT: oversized title, generous padding, small offset figure', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'minimal'));
    expect(html).toMatch(/body\[data-ao-style="minimal"\][^{]*h1\.ao-el\{[^}]*font-size:5\.4vw/);
    expect(html).toContain('.ao-slide{padding:8.4vw 9vw 7.4vw;}'); // extra air
    // figure stays modest (a small accent, not the hero) — width capped at 30vw
    expect(html).toMatch(/body\[data-ao-style="minimal"\] \.ao-slide\[data-ao-media\] > img\.ao-el\{[^}]*width:30vw;max-width:30vw/);
  });

  it('学术/国标 = RIGOROUS: numbered points, "01 /" section eyebrow, figure plate, readable floor', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'academic'));
    // enumerated points (研究内容/技术路线 条目化), not decorative squares
    expect(html).toContain('body[data-ao-style="academic"] ul.ao-el{counter-reset:aoli;}');
    expect(html).toMatch(/body\[data-ao-style="academic"\] li\.ao-el::before\{[^}]*content:counter\(aoli\)/);
    // section eyebrow reads "01  /"
    expect(html).toContain('content:counter(aosec,decimal-leading-zero) "  /"');
    // figure is a formal plate (accent rule at its head)
    expect(html).toMatch(/body\[data-ao-style="academic"\] \.ao-slide\[data-ao-media\] > img\.ao-el\{border-top:\.34vw solid var\(--ao-accent\)/);
    // dense slides keep a readable bullet floor (顶会/基金：大字可读)
    expect(html).toMatch(/body\[data-ao-style="academic"\] \.ao-slide\[data-ao-media\]\[data-ao-dense\] li\.ao-el\{font-size:2vw/);
  });

  it('党政 = 公文/红头 (GB/T 9704): full-width 红色反线 + centered 小标宋 title + 层次序数 + 公文 page number', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'gov'));
    // 「红色反线」spans the 版心 (left/right = 7.4vw page margins), sits in the 版头 band
    expect(html).toMatch(/body\[data-ao-style="gov"\] \.ao-slide:not\(\[data-ao-layout="title"\]\)::after\{[^}]*left:7\.4vw;right:7\.4vw;top:4\.6vw/);
    // centered serif (方正小标宋) title
    expect(html).toMatch(/body\[data-ao-style="gov"\] \.ao-slide:not\(\[data-ao-layout="title"\]\) > h1\.ao-el\{[^}]*text-align:center/);
    expect(html).toContain('STZhongsong');
    // 公文层次序数「一、二、三」bullets (not decorative squares)
    expect(html).toContain('content:counter(aoli,simp-chinese-informal) "、"');
    // 公文 page number 「— N —」(数字左右一字线), centred
    expect(html).toContain('content:"— " counter(aopage) " —"');
    // 红头 cover = ivory (not the dark gradient of the base cover)
    expect(html).toMatch(/body\[data-ao-style="gov"\] \.ao-slide\[data-ao-layout="title"\]\{[^}]*background:#fbf8f2/);
  });

  it('商务 = 咨询式 (页眉栏 + 左侧识别条): left navy rail + full-width header rule + uppercase kicker', () => {
    const html = previewHtmlFromSlidesMd(setDeckStyleInFrontmatter(baseMd, 'business'));
    // left vertical identity rail (repurposed foot tab) running the full slide height
    expect(html).toMatch(/body\[data-ao-style="business"\] \.ao-slide:not\(\[data-ao-layout="title"\]\)::after\{[^}]*left:0;top:0;bottom:0;width:\.62vw/);
    // full-width header rule under the title (letterhead), not the base's short tick
    expect(html).toMatch(/body\[data-ao-style="business"\][^{]*h1\.ao-el::after\{[^}]*width:100%/);
    // uppercase navy kicker eyebrow
    expect(html).toMatch(/body\[data-ao-style="business"\][^{]*h1\.ao-el::before\{[^}]*text-transform:uppercase/);
    // extra left padding to clear the identity rail
    expect(html).toMatch(/body\[data-ao-style="business"\] \.ao-slide:not\(\[data-ao-layout="title"\]\)\{padding-left:9vw/);
  });
});

describe('classifyEditScope — style axis (Tier A/B routing)', () => {
  it('a whole-deck style preset → deck-scope style with the pack id', () => {
    const p = classifyEditScope('整册改成科技风');
    expect(p).toMatchObject({ scope: 'deck', axis: 'style', styleId: 'tech' });
    expect(classifyEditScope('换成党政风格').styleId).toBe('gov');
  });

  it('an element visual tweak → local-scope style', () => {
    expect(classifyEditScope('把这个标题居中')).toMatchObject({ scope: 'local', axis: 'style' });
    expect(classifyEditScope('这条线细一点')).toMatchObject({ scope: 'local', axis: 'style' });
    expect(classifyEditScope('字大一点')).toMatchObject({ scope: 'local', axis: 'style' });
  });

  it('"only this" pins even a preset to local; color/text axes unchanged', () => {
    expect(classifyEditScope('只改这一处 居中').scope).toBe('local');
    expect(classifyEditScope('换成蓝色配色')).toMatchObject({ scope: 'deck', axis: 'color' });
    expect(classifyEditScope('这句太啰嗦了')).toMatchObject({ scope: 'local', axis: 'text' });
  });

  it('resolveStylePreset maps keywords to canonical ids', () => {
    expect(resolveStylePreset('做成科技感一点')).toBe('tech');
    expect(resolveStylePreset('政务风')).toBe('gov');
    expect(resolveStylePreset('企业商务')).toBe('business');
    expect(resolveStylePreset('改成学术风')).toBe('academic');
    expect(resolveStylePreset('来个极简风')).toBe('minimal');
    expect(resolveStylePreset('随便改改')).toBeNull();
  });

  it('normalizeDeckStyleId maps the new packs too', () => {
    expect(normalizeDeckStyleId('学术')).toBe('academic');
    expect(normalizeDeckStyleId('极简')).toBe('minimal');
  });
});

describe('element visual tweak whitelist (Tier B)', () => {
  it('deterministicStyleOps maps common phrases without an LLM', () => {
    expect(deterministicStyleOps('居中')).toEqual({ 'text-align': 'center' });
    expect(deterministicStyleOps('把它加粗')).toEqual({ 'font-weight': '800' });
    expect(deterministicStyleOps('行距紧凑一些')).toEqual({ 'line-height': '1.25' });
    // font-size is NOT a keyword (larger/smaller would shrink a vw title) — no key here
    expect(deterministicStyleOps('字大一点')['font-size']).toBeUndefined();
  });

  it('size nudge → a reliable concrete vw from the node role', () => {
    expect(sizeNudgeFactor('字大一点')).toBeGreaterThan(1);
    expect(sizeNudgeFactor('小一点')).toBeLessThan(1);
    expect(sizeNudgeFactor('居中')).toBe(1);
    // h1 base 3.5vw × 1.18 ≈ 4.13vw (a real enlargement, not a shrink to ~19px)
    expect(roleBaseFontVw('h1') * sizeNudgeFactor('标题大一点')).toBeCloseTo(4.13, 1);
  });

  it('sanitizeStyleMap keeps whitelisted valid props and drops the rest', () => {
    const out = sanitizeStyleMap({
      'text-align': 'center',
      color: '红',
      'font-size': '3vw',
      position: 'absolute', // not whitelisted → dropped
      'line-height': '99', // out of range → dropped
    });
    expect(out).toEqual({ 'text-align': 'center', color: '#c0392b', 'font-size': '3vw' });
  });

  it('mergeInlineStyle merges new props over existing ones', () => {
    expect(mergeInlineStyle('color:#000;font-size:2vw', { color: '#c0392b', 'text-align': 'center' }))
      .toBe('color:#c0392b;font-size:2vw;text-align:center');
  });
});
