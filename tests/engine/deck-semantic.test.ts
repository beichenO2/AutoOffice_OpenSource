import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the LLM proxy so the whole deck-semantic-unify path is deterministic.
vi.mock('../../src/integrations/llm-proxy.js', () => ({
  chatCompletion: vi.fn(),
  checkLlmProxyHealth: vi.fn(async () => ({ available: true })),
}));

import { chatCompletion } from '../../src/integrations/llm-proxy.js';
import { llmUnifyDeckText } from '../../src/engine/llm-edit.js';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { SLIDES_MD } from '../../src/engine/slidev/index.js';

const mockChat = vi.mocked(chatCompletion);

/** Default fake GLM: rewrite the first two nodes listed in the prompt. */
function dynamicUnify(messages: unknown): string {
  const user = String((messages as { content?: string }[])?.[1]?.content ?? '');
  const ids = [...user.matchAll(/^- (\S+):/gm)].map((m) => m[1]);
  return JSON.stringify({ edits: ids.slice(0, 2).map((id) => ({ id, text: `【统一】${id}` })) });
}

beforeEach(() => {
  mockChat.mockReset();
  mockChat.mockImplementation(async (messages: unknown) => dynamicUnify(messages));
});

describe('llmUnifyDeckText (mocked GLM)', () => {
  it('keeps real rewrites and drops a rewrite equal to the original (no-op)', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue(JSON.stringify({ edits: [{ id: 'n1', text: '原文' }, { id: 'n2', text: '改后' }] }));
    const map = await llmUnifyDeckText([{ nodeId: 'n1', text: '原文' }, { nodeId: 'n2', text: '旧文' }], '统一一下');
    expect(map).toEqual({ n2: '改后' }); // n1 == original → dropped; unknown ids also dropped
  });

  it('forcefully retries once when the first pass returns no edits', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValueOnce(JSON.stringify({ edits: [] }));
    mockChat.mockResolvedValueOnce(JSON.stringify({ edits: [{ id: 'n1', text: '改后' }] }));
    const map = await llmUnifyDeckText([{ nodeId: 'n1', text: '原文' }], '统一');
    expect(map).toEqual({ n1: '改后' });
    expect(mockChat).toHaveBeenCalledTimes(2); // first empty → one forceful retry
  });

  it('tolerates malformed JSON (graceful empty)', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue('sorry, no json here');
    const map = await llmUnifyDeckText([{ nodeId: 'n1', text: '原文' }], '统一');
    expect(map).toEqual({});
  });
});

describe('deck semantic unify — route (mocked GLM)', () => {
  let dir: string;
  let svc: EngineService;

  beforeEach(async () => {
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
    process.env.AUTOOFFICE_PPT_SOT = 'slidev';
    process.env.AUTOOFFICE_BOXMAP = 'estimate';
    process.env.AUTOOFFICE_LLM_EDIT = '1';
    dir = await mkdtemp(join(tmpdir(), 'aoide-sem-'));
    svc = new EngineService({ root: dir, idFactory: createDeterministicIdFactory('sem'), clock: fixedClock(1_700_000_000_000) });
  });
  afterEach(async () => {
    delete process.env.AUTOOFFICE_PPT_SOT;
    delete process.env.AUTOOFFICE_LLM_EDIT;
    await rm(dir, { recursive: true, force: true });
  });

  it('a vague whole-deck instruction routes to deckSemanticUnify and applies the rewrites (undoable)', async () => {
    const { project } = await svc.createProject('语义统一', 'presentation');
    await svc.postRequirement(project.id, '做一份季度业务汇报，包含数据和对比分析');
    const head = (await svc.getOverview(project.id)).revisions.at(-1)!;
    const { boxes } = await svc.getBoxes(head.id, 2);
    const t = boxes.find((b) => b.nodeId === 'slide-2-b0') ?? boxes[0]!;

    const res = await svc.createAnnotation(project.id, {
      page: 2,
      rectNorm: { x: Math.max(0, t.x), y: Math.max(0, t.y), w: Math.max(0.02, t.w), h: Math.max(0.02, t.h) },
      viewport: { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 1280, pageHeightPx: 720 },
      instruction: '把整册的语气和表述统一得更专业、更一致', // global, no A→B → semantic
      directNodeId: t.nodeId,
      revisionId: head.id,
    });

    expect(res.revision).toBeTruthy();
    expect(res.revision!.patchSummary).toMatch(/^deckSemanticUnify\(nodes=\d+\)/);
    expect(res.revision!.source.find((f) => f.path === SLIDES_MD)!.content).toContain('【统一】');

    const undone = await svc.undo(project.id);
    expect(undone?.project.headRevisionId).toBe(head.id);
  });

  it('commits nothing when GLM proposes no usable edits (stays located-but-unresolved)', async () => {
    mockChat.mockReset();
    mockChat.mockResolvedValue(JSON.stringify({ edits: [] })); // both pass + retry empty
    const { project } = await svc.createProject('无改动', 'presentation');
    await svc.postRequirement(project.id, '做一份季度业务汇报，包含数据和对比分析');
    const head = (await svc.getOverview(project.id)).revisions.at(-1)!;
    const { boxes } = await svc.getBoxes(head.id, 2);
    const t = boxes.find((b) => b.nodeId === 'slide-2-b0') ?? boxes[0]!;

    const res = await svc.createAnnotation(project.id, {
      page: 2,
      rectNorm: { x: Math.max(0, t.x), y: Math.max(0, t.y), w: Math.max(0.02, t.w), h: Math.max(0.02, t.h) },
      viewport: { zoom: 1, rotation: 0, dpr: 1, pageWidthPx: 1280, pageHeightPx: 720 },
      instruction: '整体统一一下',
      directNodeId: t.nodeId,
      revisionId: head.id,
    });
    expect(res.revision).toBeUndefined();
    expect((await svc.getOverview(project.id)).project.headRevisionId).toBe(head.id); // no empty commit
  });
});
