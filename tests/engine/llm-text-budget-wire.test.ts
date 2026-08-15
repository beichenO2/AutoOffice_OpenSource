/**
 * U5a / L4 — wire enforceDeckTextBudget into LLM deck generation.
 *
 * Hard 6/80/280 budget in the system prompt; after parse, oversized DeckSpec
 * is repaired deterministically (drop extra bullets, truncate with …).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DeckSpec, SlideElementSpec, SlideSpec } from '../../src/engine/html/generate.js';
import { enforceDeckTextBudget, repairDeckTextBudget } from '../../src/engine/text-budget.js';

vi.mock('../../src/integrations/llm-proxy.js', () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from '../../src/integrations/llm-proxy.js';
import { llmGenerateDeckSpec } from '../../src/engine/llm-generate.js';

const mockChat = vi.mocked(chatCompletion);

const CJK = '测';
const OVER_BULLET = CJK.repeat(81);
const OVER_PARA = CJK.repeat(281);
const ELLIPSIS = '…';

function slide(layout: NonNullable<SlideSpec['layout']>, title: string, elements: SlideElementSpec[]): SlideSpec {
  return { title, layout, elements };
}

function deckOf(slides: SlideSpec[]): DeckSpec {
  return { title: '超标夹具', slides };
}

function nBullets(n: number, text = '要点'): SlideElementSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    type: 'bullet' as const,
    text: `${text}${i + 1}`,
  }));
}

function units(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

describe('repairDeckTextBudget — oversized DeckSpec → ok', () => {
  it('drops extra content-slide bullets, truncates with …, and passes enforce', () => {
    const oversized = deckOf([
      slide('title', '封面', [{ id: 'h', type: 'heading', text: '封面标题' }]),
      slide('content', '超标页', [
        ...nBullets(7, '保留或丢弃'),
        { id: 'long-b', type: 'bullet', text: OVER_BULLET },
        { id: 'p1', type: 'paragraph', text: OVER_PARA },
      ]),
    ]);

    expect(enforceDeckTextBudget(oversized).ok).toBe(false);

    const repaired = repairDeckTextBudget(oversized);
    const result = enforceDeckTextBudget(repaired);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);

    const content = repaired.slides[1]!;
    const bullets = content.elements.filter((el) => el.type === 'bullet');
    expect(bullets).toHaveLength(6);
    expect(content.elements.some((el) => el.id === 'b7')).toBe(false);

    for (const b of bullets) {
      expect(units(b.text ?? '')).toBeLessThanOrEqual(80);
    }
    const para = content.elements.find((el) => el.type === 'paragraph');
    expect(para).toBeTruthy();
    expect(units(para!.text ?? '')).toBeLessThanOrEqual(280);
    expect(para!.text?.endsWith(ELLIPSIS)).toBe(true);
  });

  it('truncates an 81-unit bullet to ≤80 including …', () => {
    const oversized = deckOf([
      slide('content', '超长要点', [{ id: 'b1', type: 'bullet', text: OVER_BULLET }]),
    ]);
    const repaired = repairDeckTextBudget(oversized);
    const text = repaired.slides[0]!.elements[0]!.text ?? '';
    expect(text.endsWith(ELLIPSIS)).toBe(true);
    expect(units(text)).toBeLessThanOrEqual(80);
    expect(enforceDeckTextBudget(repaired).ok).toBe(true);
  });

  it('does not drop extra bullets on title/section slides (only length-repair)', () => {
    const oversized = deckOf([
      slide('title', '封面', [...nBullets(7, '封面条'), { id: 'b-long', type: 'bullet', text: OVER_BULLET }]),
    ]);
    const repaired = repairDeckTextBudget(oversized);
    const bullets = repaired.slides[0]!.elements.filter((el) => el.type === 'bullet');
    expect(bullets).toHaveLength(8);
    expect(units(bullets[7]!.text ?? '')).toBeLessThanOrEqual(80);
    expect(enforceDeckTextBudget(repaired).ok).toBe(true);
  });

  it('does not mutate the input DeckSpec', () => {
    const oversized = deckOf([
      slide('content', '七点页', nBullets(7)),
    ]);
    const before = JSON.stringify(oversized);
    repairDeckTextBudget(oversized);
    expect(JSON.stringify(oversized)).toBe(before);
  });
});

describe('llmGenerateDeckSpec — prompt + post-parse budget wire', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockChat.mockResolvedValue(
      JSON.stringify({
        title: '合规',
        slides: [
          { layout: 'title', heading: '合规', subtitle: '副题' },
          { heading: '要点', bullets: ['一条', '二条'] },
        ],
      }),
    );
  });

  it('puts 6 / 80 / 280 hard-budget rules in the system prompt', async () => {
    await llmGenerateDeckSpec('主题', '调研');
    expect(mockChat).toHaveBeenCalled();
    const system = String(mockChat.mock.calls[0]![0]![0]!.content);
    expect(system).toMatch(/6/);
    expect(system).toMatch(/80/);
    expect(system).toMatch(/280/);
  });

  it('repairs oversized LLM JSON so the returned DeckSpec is in budget', async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        title: '超标生成',
        slides: [
          { layout: 'title', heading: '超标生成', subtitle: '副题' },
          {
            heading: '超标页',
            bullets: [
              OVER_BULLET,
              '短2',
              '短3',
              '短4',
              '短5',
              '短6',
              '第7条应被丢掉',
            ],
            paragraph: OVER_PARA,
          },
        ],
      }),
    );

    const deck = await llmGenerateDeckSpec('超标主题', '调研资料');
    expect(deck).toBeTruthy();
    const result = enforceDeckTextBudget(deck!);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);

    const content = deck!.slides.find((s) => s.layout === 'content')!;
    expect(content.elements.filter((el) => el.type === 'bullet')).toHaveLength(6);
  });
});
