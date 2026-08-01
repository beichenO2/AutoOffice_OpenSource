import { describe, it, expect } from 'vitest';
import {
  setDeckAccentInFrontmatter,
  recolorColorCardImages,
  deckTextReplace,
  collectDeckTextNodes,
} from '../../src/engine/slidev/index.js';
import { deckAccentFromMd, previewHtmlFromSlidesMd } from '../../src/engine/slidev/generate.js';

const SVG_CARD = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
const SAMPLE_MD = [
  '---',
  'theme: default',
  'title: "测试"',
  'css: styles/index.css',
  '---',
  '',
  '<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-page="1" data-ao-layout="content">',
  '<h1 data-ao-id="slide-1-title" data-ao-type="heading" class="ao-el">标题</h1>',
  `<img data-ao-id="slide-1-img-a" data-ao-type="image" class="ao-el" src="${SVG_CARD}" alt="架构示意">`,
  '<img data-ao-id="slide-1-img-b" data-ao-type="image" class="ao-el" src="https://x/y.png" alt="照片">',
  '</div>',
  '',
].join('\n');

describe('deck theme accent (frontmatter)', () => {
  it('sets, reads and replaces the accent without duplicating or corrupting frontmatter', () => {
    expect(deckAccentFromMd(SAMPLE_MD)).toBeNull();

    const md2 = setDeckAccentInFrontmatter(SAMPLE_MD, '#ff7a59');
    expect(md2.startsWith('---')).toBe(true);
    expect(deckAccentFromMd(md2)).toBe('#ff7a59');
    expect(md2).toContain('data-ao-id="slide-1-title"'); // body untouched

    const md3 = setDeckAccentInFrontmatter(md2, '#123456');
    expect(deckAccentFromMd(md3)).toBe('#123456');
    expect(md3.match(/aoAccent:/g)?.length).toBe(1); // replaced, not appended
  });

  it('normalizes a shorthand / bare hex', () => {
    const md = setDeckAccentInFrontmatter(SAMPLE_MD, 'f0a');
    expect(deckAccentFromMd(md)).toBe('#ff00aa');
  });
});

describe('deck-wide color-card recolor', () => {
  it('recolors only the color-card illustration, preserving its label; leaves photos/URLs alone', () => {
    const { md, changed } = recolorColorCardImages(SAMPLE_MD, ({ label }) => `data:image/svg+xml;base64,NEW-${label}`);
    expect(changed).toEqual(['slide-1-img-a']);
    expect(md).toContain('src="data:image/svg+xml;base64,NEW-架构示意"');
    expect(md).toContain('src="https://x/y.png"'); // real image untouched
  });
});

describe('deck-wide term unification (deckTextReplace)', () => {
  const DECK_MD = [
    '---',
    'theme: default',
    'title: "用户手册"', // frontmatter mentions 用户 — must stay untouched
    '---',
    '',
    '<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-page="1" data-ao-layout="content">',
    '<h1 data-ao-id="slide-1-title" data-ao-type="heading" class="ao-el">用户旅程</h1>',
    '<p data-ao-id="slide-1-p" data-ao-type="paragraph" class="ao-el">为用户创造价值</p>',
    `<img data-ao-id="slide-1-img" data-ao-type="image" class="ao-el" src="${SVG_CARD}" alt="用户示意">`,
    '</div>',
    '',
    '<div class="ao-slide" data-ao-id="slide-2" data-ao-type="slide" data-ao-page="2" data-ao-layout="content">',
    '<h2 data-ao-id="slide-2-h" data-ao-type="subheading" class="ao-el">用户反馈</h2>',
    '</div>',
    '',
  ].join('\n');

  it('replaces the term in every slide body text, counting only visible occurrences', () => {
    const { md, count } = deckTextReplace(DECK_MD, '用户', '客户');
    expect(count).toBe(3); // h1 + p + h2 text — NOT the alt attr or frontmatter title
    expect(md).toContain('>客户旅程</h1>');
    expect(md).toContain('>为客户创造价值</p>');
    expect(md).toContain('>客户反馈</h2>');
  });

  it('never touches frontmatter, tags or attributes (data-ao-id / alt stay intact)', () => {
    const { md } = deckTextReplace(DECK_MD, '用户', '客户');
    expect(md).toContain('title: "用户手册"'); // frontmatter untouched
    expect(md).toContain('alt="用户示意"'); // attribute untouched
    expect(md).toContain('data-ao-id="slide-1-title"');
    expect(md).toContain('data-ao-id="slide-2-h"'); // ids stable → boxmap contract safe
  });

  it('with syncAltLabels, unifies the img alt caption too — but never data-ao-id / src', () => {
    const { md, count } = deckTextReplace(DECK_MD, '用户', '客户', { syncAltLabels: true });
    expect(count).toBe(4); // 3 body-text + 1 alt caption
    expect(md).toContain('alt="客户示意"'); // caption unified
    expect(md).toContain('data-ao-id="slide-1-img"'); // id never touched
    expect(md).toContain(`src="${SVG_CARD}"`); // src never touched
    expect(md).toContain('title: "用户手册"'); // frontmatter still untouched
  });

  it('is a no-op (count 0) when the term is absent or identical', () => {
    expect(deckTextReplace(DECK_MD, '不存在的词', 'x').count).toBe(0);
    expect(deckTextReplace(DECK_MD, '用户', '用户').count).toBe(0);
    expect(deckTextReplace(DECK_MD, '', 'x').count).toBe(0);
  });

  it('escapes HTML-special terms so they match the escaped body text', () => {
    const md = ['---', 't: x', '---', '', '<p data-ao-id="p1" class="ao-el">A&amp;B公司 出品</p>', ''].join('\n');
    const r = deckTextReplace(md, 'A&B公司', '新公司');
    expect(r.count).toBe(1);
    expect(r.md).toContain('>新公司 出品</p>');
  });
});

describe('collectDeckTextNodes (deck-wide semantic unify input)', () => {
  const DECK_MD = [
    '---', 'theme: default', '---', '',
    '<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-page="1">',
    '<h1 data-ao-id="slide-1-title" data-ao-type="heading" class="ao-el">用户旅程</h1>',
    '<p data-ao-id="slide-1-p" data-ao-type="paragraph" class="ao-el">为用户创造价值</p>',
    '<img data-ao-id="slide-1-img" data-ao-type="image" class="ao-el" src="data:image/svg+xml;base64,x" alt="示意">',
    '<ul data-ao-id="slide-1-bullets" data-ao-type="list" class="ao-el"><li data-ao-id="slide-1-b0" class="ao-el">要点一</li></ul>',
    '</div>', '',
    '<div class="ao-slide" data-ao-id="slide-2" data-ao-type="slide" data-ao-page="2">',
    '<h2 data-ao-id="slide-2-h" data-ao-type="subheading" class="ao-el">用户反馈</h2>',
    '</div>', '',
  ].join('\n');

  it('returns leaf text nodes (headings/paras/bullets) only — not images, list wrappers or slide containers', () => {
    const nodes = collectDeckTextNodes(DECK_MD);
    const ids = nodes.map((n) => n.nodeId);
    expect(ids).toEqual(['slide-1-title', 'slide-1-p', 'slide-1-b0', 'slide-2-h']);
    expect(ids).not.toContain('slide-1-img'); // image excluded
    expect(ids).not.toContain('slide-1-bullets'); // list wrapper excluded
    expect(ids).not.toContain('slide-1'); // slide container excluded
    expect(nodes.find((n) => n.nodeId === 'slide-2-h')?.text).toBe('用户反馈');
  });
});

describe('preview theme override', () => {
  it('default render keeps the original accent tokens (byte-stable default)', () => {
    const html = previewHtmlFromSlidesMd(SAMPLE_MD);
    expect(html).toContain('--ao-accent:#3a63e8');
    expect(html).not.toContain('#ff7a59');
  });

  it('an accent in frontmatter injects a whole-deck theme override', () => {
    const md = setDeckAccentInFrontmatter(SAMPLE_MD, '#ff7a59');
    const html = previewHtmlFromSlidesMd(md);
    expect(html).toContain('--ao-accent:#ff7a59');
    expect(html).toContain('color-mix(in srgb,#ff7a59'); // derived shades + cover tint
  });
});
