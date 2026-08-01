/**
 * Generation-quality gate scenarios (see docs/demos/test-scenarios.md).
 * Each case exercises ONE emphasis in isolation (image/text/formula/grounding)
 * across the AI / math / medical directions, with a mocked GLM so the suite is
 * deterministic and offline-safe. These lock in the acceptance criteria the app
 * must keep meeting as the generator evolves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../src/integrations/llm-proxy.js', () => ({
  chatCompletion: vi.fn(),
  checkLlmProxyHealth: vi.fn(async () => ({ available: true })),
}));

import { chatCompletion } from '../../src/integrations/llm-proxy.js';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { SLIDES_MD } from '../../src/engine/slidev/index.js';
import { splitSlidevPages, deckHasClicks } from '../../src/engine/slidev/generate.js';
import { verifyDeckGrounding, extractSpecificNumbers } from '../../src/engine/llm-generate.js';
import { renderInlineText, type DeckSpec } from '../../src/engine/html/generate.js';

const mockChat = vi.mocked(chatCompletion);
const deckJson = (slides: unknown[]): string => JSON.stringify({ title: 't', slides });
const mdOf = (res: { revision: { source: { path: string; content: string }[] } }): string =>
  res.revision.source.find((f) => f.path === SLIDES_MD)!.content;
const count = (md: string, re: RegExp): number => (md.match(re) || []).length;

describe('gate scenarios — generation quality (mocked GLM, deterministic)', () => {
  let dir: string;
  let svc: EngineService;
  beforeEach(async () => {
    process.env.AUTOOFFICE_PPT_SOT = 'slidev';
    process.env.AUTOOFFICE_BOXMAP = 'estimate';
    process.env.AUTOOFFICE_LLM_EDIT = '1';
    dir = await mkdtemp(join(tmpdir(), 'aoide-gate-'));
    svc = new EngineService({ root: dir, idFactory: createDeterministicIdFactory('gate'), clock: fixedClock(1_700_000_000_000) });
    mockChat.mockReset();
  });
  afterEach(async () => {
    delete process.env.AUTOOFFICE_PPT_SOT;
    delete process.env.AUTOOFFICE_BOXMAP;
    delete process.env.AUTOOFFICE_LLM_EDIT;
    await rm(dir, { recursive: true, force: true });
  });

  it('S1 · AI 图文排版：选好的插图定点插入指定页且可框选', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: 'Transformer 架构综述', subtitle: '自注意力与并行' },
      { heading: '自注意力', bullets: ['Q/K/V 线性映射', '缩放点积注意力', '多头并行'] },
      { heading: '编码器结构', bullets: ['残差连接', '层归一化'] },
    ]));
    const res = await svc.createDeckFromTopic('Transformer', 'Transformer 架构综述', 'attention is all you need', {
      images: [
        { slide: 2, src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', alt: '注意力示意' },
        { slide: 3, src: 'https://example.com/enc.png', alt: '编码器' },
      ],
    });
    const md = mdOf(res);
    expect(md).toContain('data:image/svg+xml'); // pinned into slide 2
    expect(md).toContain('https://example.com/enc.png'); // pinned into slide 3
    expect(md).toContain('data-ao-type="image"');
    const { boxes } = await svc.getBoxes(res.revision.id, 2);
    expect(boxes.length).toBeGreaterThan(0); // image on slide 2 is box-selectable
  });

  it('S2 · AI 文字多：遵循大纲、页数与要点密度达标、无空页', async () => {
    const slides: unknown[] = [{ layout: 'title', heading: '大模型安全与对齐', subtitle: '2026 进展' }];
    for (let i = 0; i < 6; i++) {
      slides.push({ heading: `主题 ${i + 1}`, bullets: ['要点一要点一', '要点二要点二', '要点三要点三', '要点四要点四', '要点五要点五'] });
    }
    mockChat.mockResolvedValue(deckJson(slides));
    const res = await svc.createDeckFromTopic('安全对齐', '大模型安全与对齐进展', '大量调研要点', {
      outline: '1. 封面\n2-7. 六个主题各一页',
    });
    const userMsg = String(mockChat.mock.calls[0]![0]![1]!.content);
    expect(userMsg).toContain('六个主题'); // outline forwarded verbatim
    expect(res.slides).toBeGreaterThanOrEqual(7);
    const md = mdOf(res);
    expect(count(md, /data-ao-type="bullet"/g)).toBeGreaterThanOrEqual(24); // dense, not a one-liner per page
  });

  it('S3 · 数学 公式多：每内容页含 LaTeX 并渲染为 MathML、公式可框选', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '梯度下降与反向传播', subtitle: '优化基础' },
      { heading: '更新规则', bullets: ['沿负梯度迭代'], formulas: ['w_{t+1}=w_t-\\eta\\nabla L(w_t)'] },
      { heading: '链式法则', formulas: ['\\frac{\\partial L}{\\partial w}=\\frac{\\partial L}{\\partial y}\\frac{\\partial y}{\\partial w}'] },
    ]));
    const res = await svc.createDeckFromTopic('梯度下降', '梯度下降与反向传播', '', { allowFormulas: true });
    const md = mdOf(res);
    expect(count(md, /data-ao-type="formula"/g)).toBeGreaterThanOrEqual(2);
    expect(count(md, /<math/g)).toBeGreaterThanOrEqual(2);
  });

  it('S4 · 数学 复杂公式：积分/上下限/求和正确渲染为 MathML', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '傅里叶变换与卷积定理', subtitle: '信号与系统' },
      { heading: '傅里叶变换', formulas: ['\\int_{-\\infty}^{\\infty} f(t)e^{-i\\omega t}\\,dt'] },
      { heading: '卷积定理', formulas: ['\\mathcal{F}\\{f * g\\}=\\mathcal{F}\\{f\\}\\cdot\\mathcal{F}\\{g\\}'] },
    ]));
    const res = await svc.createDeckFromTopic('傅里叶', '傅里叶变换与卷积定理', '', { allowFormulas: true });
    const md = mdOf(res);
    expect(md).toContain('<math');
    expect(md).toMatch(/<msubsup|<msup|<msub/); // integral limits / exponents survive as structured math
  });

  it('S5 · 医学 文字详实：忠于 guidance 的数据判为有出处、杜撰数字被标记', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: 'GLP-1 类药物', subtitle: '药理与临床证据' },
      { heading: '临床证据', bullets: ['OASIS-4 减重 16.6%~17%', '每周一次给药'] },
    ]));
    const grounded = await svc.createDeckFromTopic('GLP-1', 'GLP-1 类药物药理与临床证据', '', {
      guidance: 'OASIS-4 试验：口服 GLP-1 减重 16.6%~17%；每周一次。',
    });
    expect(grounded.grounding.checked).toBeGreaterThan(0);
    expect(grounded.grounding.flagged.length).toBe(0); // every number traces to guidance

    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: 'GLP-1', subtitle: '证据' },
      { heading: '证据', bullets: ['减重 88.8%（无出处）'] },
    ]));
    const hallucinated = await svc.createDeckFromTopic('GLP-1b', 'GLP-1', '', { guidance: 'OASIS-4 减重 16.6%~17%。' });
    expect(hallucinated.grounding.flagged.length).toBeGreaterThan(0);
    expect(hallucinated.grounding.flagged[0]!.numbers.join()).toContain('88.8');
  });

  it('S6 · 医学 药代模型：一室药代 / 半衰期公式渲染为 MathML（含分式）', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '一室药代动力学模型', subtitle: '血药浓度' },
      { heading: '血药浓度', bullets: ['D 剂量、V 分布容积、k_e 消除速率常数'], formulas: ['C(t)=\\frac{D}{V}e^{-k_e t}', 't_{1/2}=\\frac{\\ln 2}{k_e}'] },
    ]));
    const res = await svc.createDeckFromTopic('药代', '一室药代动力学模型', '', { allowFormulas: true });
    const md = mdOf(res);
    expect(count(md, /data-ao-type="formula"/g)).toBeGreaterThanOrEqual(2);
    expect(md).toContain('<math');
    expect(md).toMatch(/<mfrac/); // fractions rendered
  });

  it('S3b · 行内公式：正文/要点里的 $…$ 也渲染为 MathML（不显示裸 LaTeX）', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '药代', subtitle: '模型' },
      { heading: '半衰期', bullets: ['半衰期 $t_{1/2}=\\frac{\\ln 2}{k_e}$ 与消除速率相关'], paragraph: '清除率 $CL=k_e V$ 决定暴露量。' },
    ]));
    const res = await svc.createDeckFromTopic('药代', '一室药代', '', { allowFormulas: true });
    const md = mdOf(res);
    expect(md).toContain('<math'); // inline $…$ became MathML inside the bullet/paragraph
    expect(md).toMatch(/data-ao-type="bullet"[\s\S]*?<math/); // math is inside a bullet, not a formula div
    expect(md).not.toContain('$t_{1/2}'); // no raw LaTeX leaked to the page
  });

  it('S7 · 动画：animate → deck 级 transition + 内容页逐步揭示（封面不揭示、仍可分页）', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '产品发布', subtitle: '逐步揭示演示' },
      { heading: '亮点', bullets: ['更快', '更省', '更稳'] },
      { heading: '路线图', paragraph: '本季度分三步推进。' },
    ]));
    const res = await svc.createDeckFromTopic('发布', '产品发布逐步揭示', '', { animate: true });
    const md = mdOf(res);
    expect(md).toMatch(/^transition:\s*slide-left/m); // deck-level transition in headmatter
    expect(count(md, /<li[^>]*\bv-click\b/g)).toBeGreaterThanOrEqual(3); // bullets step-reveal
    expect(md).toMatch(/data-ao-type="paragraph"[^>]*\bv-click\b/); // paragraph body reveals too
    expect(md).not.toMatch(/data-ao-id="slide-1-sub"[^>]*v-click/); // cover subtitle stays (clean opening)
    expect(splitSlidevPages(md).length).toBe(3); // headmatter + v-click do not break paging
    // animated deck is detected → export auto-enables --with-clicks (per-step pages)
    expect(deckHasClicks(res.revision.source)).toBe(true);
  });

  it('S7b · 非动画 deck 不触发 with-clicks（导出行为不变）', async () => {
    mockChat.mockResolvedValue(deckJson([
      { layout: 'title', heading: '静态', subtitle: '无动画' },
      { heading: '要点', bullets: ['一', '二'] },
    ]));
    const res = await svc.createDeckFromTopic('静态', '静态主题', '', {});
    expect(deckHasClicks(res.revision.source)).toBe(false);
  });
});

describe('inline math: renderInlineText (unit)', () => {
  it('renders $…$ segments as inline MathML and escapes the rest', () => {
    const html = renderInlineText('半衰期 $t_{1/2}=\\frac{\\ln 2}{k_e}$ 相关');
    expect(html).toContain('<math');
    expect(html).toContain('半衰期');
    expect(html).not.toContain('$t_{1/2}');
  });
  it('leaves plain text (no $) exactly escaped — unchanged behaviour', () => {
    expect(renderInlineText('a<b & "c"')).toBe('a&lt;b &amp; &quot;c&quot;');
  });
});

describe('data-rigor: extractSpecificNumbers + verifyDeckGrounding (unit)', () => {
  it('extracts specific numbers and skips bare single digits', () => {
    expect(extractSpecificNumbers('减重 16.6% 每周 1 次，共 300 例')).toEqual(['16.6%', '300']);
    expect(extractSpecificNumbers('3 条要点')).toEqual([]);
    expect(extractSpecificNumbers('红移 z=14.44')).toEqual(['14.44']);
  });

  it('grounds numbers found in sources, flags the rest, exempts formulas', () => {
    const spec: DeckSpec = {
      title: 't',
      slides: [
        { title: 't', layout: 'title', elements: [{ id: 'title', type: 'heading', text: 'GLP-1' }] },
        {
          title: 'c',
          layout: 'content',
          elements: [
            { id: 'b0', type: 'bullet', text: '减重 16.6%' }, // grounded
            { id: 'b1', type: 'bullet', text: '样本 99999 例' }, // hallucinated
            { id: 'f0', type: 'formula', text: 'E=mc^2' }, // exempt: notation, not a claim
          ],
        },
      ],
    };
    const rep = verifyDeckGrounding(spec, 'OASIS-4 减重 16.6%~17%');
    expect(rep.checked).toBe(2);
    expect(rep.grounded).toBe(1);
    expect(rep.flagged.length).toBe(1);
    expect(rep.flagged[0]!.numbers).toContain('99999');
  });
});
