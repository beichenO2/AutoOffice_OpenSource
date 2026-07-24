import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  interpretRequirement,
  interpretRequirementDeterministic,
} from '../../src/engine/brief.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';

const mockHealth = vi.fn();
const mockChat = vi.fn();

vi.mock('../../src/integrations/llm-proxy.js', () => ({
  checkLlmProxyHealth: (...args: unknown[]) => mockHealth(...args),
  chatCompletion: (...args: unknown[]) => mockChat(...args),
}));

describe('engine brief — deterministic interpreter', () => {
  beforeEach(() => {
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
  });

  it('surfaces tone proposal for ambiguous style requests', () => {
    const result = interpretRequirementDeterministic({
      projectId: 'p1',
      text: '做汇报，风格更正式一点',
      kind: 'presentation',
      idFactory: createDeterministicIdFactory('brief'),
      clock: fixedClock(1),
    });
    expect(result.proposal?.options.length).toBeGreaterThanOrEqual(2);
    expect(result.proposal?.recommendedOptionId).toBe('o-formal');
  });
});

describe('engine brief — LLM interpreter', () => {
  beforeEach(() => {
    mockHealth.mockReset();
    mockChat.mockReset();
    delete process.env.AUTOOFFICE_ENGINE_INTERPRETER;
  });

  it('falls back to deterministic when proxy is unavailable in auto mode', async () => {
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'auto';
    mockHealth.mockResolvedValue({ available: false, error: 'down' });

    const result = await interpretRequirement({
      projectId: 'p1',
      text: '季度汇报',
      kind: 'presentation',
      idFactory: createDeterministicIdFactory('brief'),
      clock: fixedClock(1),
    });
    expect(result.brief.contentGoals.length).toBeGreaterThan(0);
    expect(result.proposal).toBeUndefined();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('parses structured LLM JSON when proxy is available', async () => {
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'auto';
    mockHealth.mockResolvedValue({ available: true });
    mockChat.mockResolvedValue(
      JSON.stringify({
        brief: {
          docType: 'presentation',
          audience: 'executive',
          scenario: 'board-review',
          contentGoals: ['include-metrics', 'compare'],
          materials: [],
          deliveryFormats: ['html', 'pdf'],
          standards: ['demo-business'],
          preferences: [],
          prohibitions: [],
          uncertainties: [],
          assumptions: ['LLM parsed requirement'],
        },
        proposal: null,
      }),
    );

    const result = await interpretRequirement({
      projectId: 'p1',
      text: '给董事会做季度汇报，突出 KPI 对比',
      kind: 'presentation',
      idFactory: createDeterministicIdFactory('brief'),
      clock: fixedClock(1),
    });
    expect(mockChat).toHaveBeenCalledOnce();
    expect(result.brief.scenario).toBe('board-review');
    expect(result.brief.assumptions).toContain('LLM parsed requirement');
  });
});
