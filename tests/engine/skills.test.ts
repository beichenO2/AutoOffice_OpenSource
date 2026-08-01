import { describe, it, expect } from 'vitest';
import { classifyEditScope, parseDeckTextReplace } from '../../src/engine/skills.js';

describe('classifyEditScope (PPT generalization skill)', () => {
  it('color / palette intent generalizes to the whole deck', () => {
    for (const s of ['换成暖色调', '整体配色改成蓝色', 'make the palette warmer', '这个色调太冷，换暖一点']) {
      const p = classifyEditScope(s);
      expect(p.scope, s).toBe('deck');
      expect(p.axis, s).toBe('color');
    }
  });

  it('wording / content intent stays local', () => {
    for (const s of ['这句太啰嗦了，精炼一点', '改成「季度经营回顾」', 'make this shorter']) {
      const p = classifyEditScope(s);
      expect(p.scope, s).toBe('local');
      expect(p.axis, s).toBe('text');
    }
  });

  it('a non-color image change is a local image edit', () => {
    const p = classifyEditScope('换成另一张示意图', { isImage: true });
    expect(p.scope).toBe('local');
    expect(p.axis).toBe('image');
  });

  it('a color change framed on an image still generalizes to the deck', () => {
    const p = classifyEditScope('这张图换暖色', { isImage: true });
    expect(p.scope).toBe('deck');
    expect(p.axis).toBe('color');
  });

  it('an explicit "only this" forces local even for a color instruction', () => {
    const p = classifyEditScope('只改这一处的颜色，换成红色');
    expect(p.scope).toBe('local');
    expect(p.axis).toBe('color');
  });

  it('a deck-wide term unification generalizes to the whole deck (text axis)', () => {
    const cases: Array<[string, string, string]> = [
      ['把全部『AI』统一改成『人工智能』', 'AI', '人工智能'],
      ['所有的「用户」都改成「客户」', '用户', '客户'],
      ['整册把 KPI 统一替换为 关键指标', 'KPI', '关键指标'],
      ['replace all AI with 人工智能', 'AI', '人工智能'],
    ];
    for (const [s, from, to] of cases) {
      const p = classifyEditScope(s);
      expect(p.scope, s).toBe('deck');
      expect(p.axis, s).toBe('text');
      expect(p.textReplace, s).toEqual({ from, to });
    }
  });

  it('a free-form GLOBAL rewrite (no A→B) becomes a deck-wide semantic unify', () => {
    for (const s of ['把整册文字都精炼一点', '所有页面都写得更专业些']) {
      const p = classifyEditScope(s);
      expect(p.scope, s).toBe('deck'); // semantic unify (GLM), not a deterministic rename
      expect(p.axis, s).toBe('text');
      expect(p.textReplace, s).toBeUndefined(); // no A→B pair → semantic path
    }
  });

  it('a rename without a global hint stays local (a single literal replace)', () => {
    const p = classifyEditScope('把 AI 改成 人工智能'); // no 全部/所有/统一 → local
    expect(p.scope).toBe('local');
    expect(p.axis).toBe('text');
    expect(p.textReplace).toBeUndefined();
  });
});

describe('parseDeckTextReplace (A→B term extraction)', () => {
  it('extracts quoted / bare terms across common zh + en phrasings', () => {
    expect(parseDeckTextReplace('把全部『AI』统一改成『人工智能』')).toEqual({ from: 'AI', to: '人工智能' });
    expect(parseDeckTextReplace('所有的「用户」都改成「客户」')).toEqual({ from: '用户', to: '客户' });
    expect(parseDeckTextReplace('将 KPI 统一替换为 关键指标')).toEqual({ from: 'KPI', to: '关键指标' });
    expect(parseDeckTextReplace('replace all "AI" with "人工智能"')).toEqual({ from: 'AI', to: '人工智能' });
  });

  it('returns null for a free-form rewrite (not a rename)', () => {
    expect(parseDeckTextReplace('这句太啰嗦了，精炼一点')).toBeNull();
    expect(parseDeckTextReplace('把整册文字都精炼一点')).toBeNull();
    expect(parseDeckTextReplace('')).toBeNull();
  });
});
