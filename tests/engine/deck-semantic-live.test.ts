import { describe, it, expect } from 'vitest';
import { checkLlmChatAvailable } from '../../src/integrations/llm-proxy.js';
import { llmUnifyDeckText } from '../../src/engine/llm-edit.js';

/**
 * Real-GLM integration test (no mock). Skips automatically when the PolarPrivate
 * LLM Proxy is unavailable OR its text binding is broken (offline / CI / QCSA
 * routing drift — /health can be ok while completions 503 BINDING_NOT_FOUND),
 * so the default suite stays green; runs for real when the LLM path works.
 * Proves the forceful-retry actually gets GLM to propose deck-wide consistent
 * rewrites even for a vague instruction.
 */
describe('deck semantic unify (real GLM, skips if proxy down)', () => {
  it('GLM proposes consistent rewrites for a vague whole-deck instruction', async (ctx) => {
    const probe = await checkLlmChatAvailable();
    if (!probe.available) return ctx.skip();

    const nodes = [
      { nodeId: 'n1', text: '大模型把理解和生成推到新高度' },
      { nodeId: 'n2', text: '要完成真实任务，模型必须从一次问答升级为持续行动的智能体' },
      { nodeId: 'n3', text: '工具调用把语言能力接入真实世界' },
      { nodeId: 'n4', text: '感知规划执行记忆的闭环替代单轮prompt' },
    ];
    let map: Record<string, string>;
    try {
      map = await llmUnifyDeckText(nodes, '把整册的语气和表述统一得更专业、更一致');
    } catch (err) {
      // BINDING_NOT_FOUND surviving client retries = PolarPrivate routing pool
      // still resolving to an unconfigured upstream binding. That is proxy-side
      // config drift, definitionally not an AutoOffice regression — skip
      // honestly. Anything else is a real failure and must stay loud.
      if (String(err).includes('BINDING_NOT_FOUND')) return ctx.skip();
      throw err;
    }

    expect(Object.keys(map).length).toBeGreaterThan(0); // forceful retry ensures edits
    const ids = new Set(nodes.map((n) => n.nodeId));
    for (const [id, text] of Object.entries(map)) {
      expect(ids.has(id)).toBe(true); // only known nodes
      expect(text).not.toBe(nodes.find((n) => n.nodeId === id)!.text); // real change, not a no-op
      expect(text.length).toBeGreaterThan(0);
    }
  }, 120000);
});
