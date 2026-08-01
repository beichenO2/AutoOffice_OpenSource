import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/integrations/llm-proxy.js', () => ({
  chatCompletion: vi.fn(),
  checkLlmProxyHealth: vi.fn(async () => ({ available: true })),
}));

import { chatCompletion } from '../../src/integrations/llm-proxy.js';
import { llmGenerateDeckSpec, fallbackDeckSpec } from '../../src/engine/llm-generate.js';
import { renderFormulaMathml } from '../../src/engine/html/generate.js';
import { renderSlidevSource } from '../../src/engine/slidev/index.js';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { SLIDES_MD } from '../../src/engine/slidev/index.js';

const mockChat = vi.mocked(chatCompletion);
const DECK_JSON = JSON.stringify({
  title: '固态电池 2026',
  slides: [
    { layout: 'title', heading: '固态电池 2026', subtitle: '从试产走向商用' },
    { heading: '现状', bullets: ['无量产整车', 'Toyota/QuantumScape 试产线', '成本约为锂电 3-5 倍'] },
    { heading: '路线图', paragraph: '2027-2028 高端车小批量，2030 前后量产。' },
  ],
});

beforeEach(() => {
  mockChat.mockReset();
  mockChat.mockResolvedValue(DECK_JSON);
});

describe('llmGenerateDeckSpec (mocked GLM)', () => {
  it('maps a GLM deck outline into a DeckSpec (cover + bullets + paragraph)', async () => {
    const deck = await llmGenerateDeckSpec('固态电池', 'Toyota 试产；成本高', { slides: 5 });
    expect(deck).toBeTruthy();
    expect(deck!.title).toBe('固态电池 2026');
    expect(deck!.slides).toHaveLength(3);
    expect(deck!.slides[0]!.layout).toBe('title');
    expect(deck!.slides[0]!.elements.some((e) => e.type === 'heading')).toBe(true);
    const content = deck!.slides[1]!;
    expect(content.title).toBe('现状');
    expect(content.elements.filter((e) => e.type === 'bullet')).toHaveLength(3);
    expect(deck!.slides[2]!.elements.some((e) => e.type === 'paragraph')).toBe(true);
  });

  it('returns null on unusable output (caller falls back)', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue('no json');
    expect(await llmGenerateDeckSpec('x')).toBeNull();
  });
});

describe('fallbackDeckSpec (deterministic, offline)', () => {
  it('builds a multi-slide deck from research lines', () => {
    const deck = fallbackDeckSpec('量子计算', '纠错取得进展\n超导与离子阱两条路线\n2026 出现千比特原型机');
    expect(deck.title).toBe('量子计算');
    expect(deck.slides.length).toBeGreaterThanOrEqual(2);
    expect(deck.slides[0]!.layout).toBe('title');
    const bullets = deck.slides.flatMap((s) => s.elements).filter((e) => e.type === 'bullet');
    expect(bullets.length).toBeGreaterThan(0);
  });
});

describe('createDeckFromTopic (route, mocked GLM)', () => {
  let dir: string;
  let svc: EngineService;
  beforeEach(async () => {
    process.env.AUTOOFFICE_PPT_SOT = 'slidev';
    process.env.AUTOOFFICE_BOXMAP = 'estimate';
    process.env.AUTOOFFICE_LLM_EDIT = '1';
    dir = await mkdtemp(join(tmpdir(), 'aoide-gen-'));
    svc = new EngineService({ root: dir, idFactory: createDeterministicIdFactory('gen'), clock: fixedClock(1_700_000_000_000) });
  });
  afterEach(async () => {
    delete process.env.AUTOOFFICE_PPT_SOT;
    delete process.env.AUTOOFFICE_BOXMAP;
    delete process.env.AUTOOFFICE_LLM_EDIT;
    await rm(dir, { recursive: true, force: true });
  });

  it('generates a real Slidev deck from a topic via GLM, box-selectable + committed', async () => {
    const res = await svc.createDeckFromTopic('固态电池报告', '固态电池 2026 进展', 'Toyota 试产线；成本约锂电 3-5 倍');
    expect(res.usedLlm).toBe(true);
    expect(res.slides).toBe(3);
    expect(res.revision).toBeTruthy();

    const md = res.revision.source.find((f) => f.path === SLIDES_MD)!.content;
    expect(md).toContain('无量产整车'); // a GLM bullet landed in the deck
    expect(md).toContain('固态电池 2026'); // deck/cover title

    // The generated deck is the project head and is box-selectable.
    const ov = await svc.getOverview(res.project.id);
    expect(ov.project.headRevisionId).toBe(res.revision.id);
    const { boxes } = await svc.getBoxes(res.revision.id, 2);
    expect(boxes.length).toBeGreaterThan(0);
  });

  it('falls back to the deterministic deck when the LLM edit flag is off', async () => {
    delete process.env.AUTOOFFICE_LLM_EDIT;
    const res = await svc.createDeckFromTopic('离线报告', '离线主题', '要点一要点一\n要点二要点二');
    expect(res.usedLlm).toBe(false);
    expect(res.slides).toBeGreaterThanOrEqual(2);
    expect(res.revision.source.some((f) => f.path === SLIDES_MD)).toBe(true);
  });

  it('guided generation: forwards outline + guidance to GLM, inserts chosen images, renders formulas', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue(JSON.stringify({
      title: '梯度下降',
      slides: [
        { layout: 'title', heading: '梯度下降', subtitle: '优化基础' },
        { heading: '更新规则', bullets: ['沿负梯度方向迭代'], formulas: ['w_{t+1}=w_t-\\eta\\nabla L(w_t)'] },
      ],
    }));
    const res = await svc.createDeckFromTopic('梯度下降', '梯度下降优化方法', '机器学习优化', {
      outline: '1. 封面\n2. 更新规则（含公式）',
      guidance: '学习率记作 eta；损失函数记作 L。',
      allowFormulas: true,
      images: [{ slide: 2, src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: '损失曲面' }],
    });
    expect(res.usedLlm).toBe(true);
    // outline + guidance were forwarded into the GLM prompt
    const userMsg = String(mockChat.mock.calls[0]![0]![1]!.content);
    expect(userMsg).toContain('更新规则（含公式）');
    expect(userMsg).toContain('学习率记作 eta');
    const md = res.revision.source.find((f) => f.path === SLIDES_MD)!.content;
    expect(md).toContain('data-ao-type="formula"');
    expect(md).toContain('<math'); // LaTeX → MathML rendered into the deck
    expect(md).toContain('data:image/svg+xml'); // chosen image inserted
  });
});

describe('formula rendering (KaTeX → MathML)', () => {
  it('renders LaTeX to native MathML (no JS/fonts needed)', () => {
    const html = renderFormulaMathml('E=mc^2', true);
    expect(html).toContain('<math');
    expect(html).toContain('</math>');
  });

  it('degrades gracefully on invalid LaTeX (no throw)', () => {
    expect(() => renderFormulaMathml('\\frac{', true)).not.toThrow();
  });

  it('a formula element becomes a box-selectable MathML node in slides.md', () => {
    const src = renderSlidevSource({
      title: 't',
      slides: [
        { title: 't', layout: 'title', elements: [{ id: 'title', type: 'heading', text: 't' }] },
        { title: '公式', layout: 'content', elements: [{ id: 'f0', type: 'formula', text: '\\int_0^1 x\\,dx' }] },
      ],
    });
    const md = src.find((f) => f.path === SLIDES_MD)!.content;
    expect(md).toContain('data-ao-id="slide-2-f0"');
    expect(md).toContain('data-ao-type="formula"');
    expect(md).toContain('<math');
  });
});
