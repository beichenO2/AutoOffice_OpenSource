import { describe, it, expect } from 'vitest';
import { checkLlmProxyHealth } from '../../src/integrations/llm-proxy.js';
import { llmUnifyDeckText } from '../../src/engine/llm-edit.js';

/**
 * Real-GLM integration test (no mock). Skips automatically when the PolarPrivate
 * LLM Proxy is unavailable (offline / CI), so the default suite stays green; runs
 * for real when the proxy is up. Proves the forceful-retry actually gets GLM to
 * propose deck-wide consistent rewrites even for a vague instruction.
 */
describe('deck semantic unify (real GLM, skips if proxy down)', () => {
  it('GLM proposes consistent rewrites for a vague whole-deck instruction', async (ctx) => {
    const health = await checkLlmProxyHealth();
    if (!health.available) return ctx.skip();

    const nodes = [
      { nodeId: 'n1', text: '大模型把理解和生成推到新高度' },
      { nodeId: 'n2', text: '要完成真实任务，模型必须从一次问答升级为持续行动的智能体' },
      { nodeId: 'n3', text: '工具调用把语言能力接入真实世界' },
      { nodeId: 'n4', text: '感知规划执行记忆的闭环替代单轮prompt' },
    ];
    const map = await llmUnifyDeckText(nodes, '把整册的语气和表述统一得更专业、更一致');

    expect(Object.keys(map).length).toBeGreaterThan(0); // forceful retry ensures edits
    const ids = new Set(nodes.map((n) => n.nodeId));
    for (const [id, text] of Object.entries(map)) {
      expect(ids.has(id)).toBe(true); // only known nodes
      expect(text).not.toBe(nodes.find((n) => n.nodeId === id)!.text); // real change, not a no-op
      expect(text.length).toBeGreaterThan(0);
    }
  }, 120000);
});
