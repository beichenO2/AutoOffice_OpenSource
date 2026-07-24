/**
 * Requirement Interpreter — LLM Proxy with deterministic offline fallback.
 *
 * Provider boundary: structured Brief + optional Proposal must pass schema
 * validation before orchestrator proceeds. Tests set
 * `AUTOOFFICE_ENGINE_INTERPRETER=deterministic` for stable E2E.
 */
import type { Brief, DocumentKind, Proposal, ProposalOption } from './types.js';
import { randomIdFactory, type IdFactory } from './ids.js';
import { systemClock, type Clock } from './clock.js';
import { assertValid, briefSchema, validate } from './schema.js';
import { chatCompletion, checkLlmProxyHealth } from '../integrations/llm-proxy.js';

export interface InterpretInput {
  projectId: string;
  text: string;
  kind: DocumentKind;
  idFactory?: IdFactory;
  clock?: Clock;
}

export interface InterpretResult {
  brief: Brief;
  proposal?: {
    question: string;
    options: ProposalOption[];
    recommendedOptionId: string;
  };
}

const FORMAL_WORDS = /更正式|正式一点|严肃|商务|professional|formal/i;
const VIVID_WORDS = /醒目|突出|显眼|bold|emphasis/i;
const LENGTH_WORDS = /(\d+)\s*页/;

const proposalOptionSchema = {
  kind: 'object' as const,
  additional: false,
  fields: {
    id: { schema: { kind: 'string' as const, minLength: 1 } },
    label: { schema: { kind: 'string' as const, minLength: 1 } },
    plainImpact: { schema: { kind: 'string' as const, minLength: 1 } },
    scope: { schema: { kind: 'string' as const, enum: ['local', 'multi'] as const } },
    reversible: { schema: { kind: 'boolean' as const } },
    previewRef: { schema: { kind: 'string' as const }, optional: true },
  },
};

const llmPayloadSchema = {
  kind: 'object' as const,
  additional: false,
  fields: {
    brief: {
      schema: {
        kind: 'object' as const,
        additional: false,
        fields: {
          docType: { schema: { kind: 'string' as const, minLength: 1 } },
          audience: { schema: { kind: 'string' as const } },
          scenario: { schema: { kind: 'string' as const } },
          contentGoals: { schema: { kind: 'array' as const, items: { kind: 'string' as const }, minItems: 1 } },
          materials: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          lengthPages: { schema: { kind: 'number' as const, min: 1, int: true }, optional: true },
          deliveryFormats: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          standards: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          preferences: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          prohibitions: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          uncertainties: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          assumptions: { schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
        },
      },
    },
    proposal: {
      schema: {
        kind: 'object' as const,
        additional: false,
        optional: true,
        fields: {
          question: { schema: { kind: 'string' as const, minLength: 1 } },
          options: { schema: { kind: 'array' as const, items: proposalOptionSchema, minItems: 2, maxItems: 4 } },
          recommendedOptionId: { schema: { kind: 'string' as const, minLength: 1 } },
        },
      },
    },
  },
};

function interpreterMode(): 'deterministic' | 'llm' | 'auto' {
  const raw = (process.env.AUTOOFFICE_ENGINE_INTERPRETER ?? 'auto').trim().toLowerCase();
  if (raw === 'deterministic' || raw === 'llm' || raw === 'auto') return raw;
  return 'auto';
}

/** Deterministic Requirement Interpreter (offline / tests). */
export function interpretRequirementDeterministic(input: InterpretInput): InterpretResult {
  const idFactory = input.idFactory ?? randomIdFactory;
  const clock = input.clock ?? systemClock;
  const text = input.text.trim();
  const assumptions: string[] = [];
  const uncertainties: string[] = [];

  const lengthMatch = LENGTH_WORDS.exec(text);
  const lengthPages = lengthMatch ? Number.parseInt(lengthMatch[1]!, 10) : undefined;

  let docType = input.kind === 'presentation' ? 'presentation' : 'report';
  if (/论文|thesis|学位/.test(text)) docType = 'thesis';

  const brief: Brief = {
    id: idFactory('brief'),
    projectId: input.projectId,
    docType,
    audience: /领导|高管|executive/.test(text) ? 'executive' : 'general',
    scenario: /汇报|review|季度|annual/.test(text) ? 'business-review' : 'general',
    contentGoals: extractGoals(text),
    materials: [],
    lengthPages,
    deliveryFormats: input.kind === 'presentation' ? ['html', 'pdf', 'pptx'] : ['pdf', 'latex'],
    standards: docType === 'thesis' ? ['demo-thesis'] : ['demo-business'],
    preferences: [],
    prohibitions: [],
    uncertainties,
    assumptions,
    createdAt: clock(),
  };

  if (FORMAL_WORDS.test(text) || VIVID_WORDS.test(text)) {
    assumptions.push('用户希望调整视觉气质而非改内容结构');
    return {
      brief,
      proposal: buildToneProposal(idFactory, clock, text),
    };
  }

  if (/不满意|怪|奇怪|不太对/.test(text)) {
    uncertainties.push('用户反馈较主观，需结合框选区域或示例预览澄清');
  }

  return { brief };
}

export async function interpretRequirement(input: InterpretInput): Promise<InterpretResult> {
  const mode = interpreterMode();
  if (mode === 'deterministic') {
    return interpretRequirementDeterministic(input);
  }

  try {
    const health = await checkLlmProxyHealth();
    if (!health.available) {
      if (mode === 'llm') throw new Error(health.error ?? 'LLM Proxy unavailable');
      return interpretRequirementDeterministic(input);
    }
    return await interpretRequirementViaLlm(input);
  } catch (err) {
    if (mode === 'llm') throw err;
    return interpretRequirementDeterministic(input);
  }
}

async function interpretRequirementViaLlm(input: InterpretInput): Promise<InterpretResult> {
  const idFactory = input.idFactory ?? randomIdFactory;
  const clock = input.clock ?? systemClock;
  const kindLabel = input.kind === 'presentation' ? 'presentation (HTML slides)' : 'pdf (LaTeX report)';

  const system = [
    'You are AutoOffice Requirement Interpreter.',
    'Return ONLY valid JSON (no markdown prose) matching this shape:',
    '{"brief":{docType,audience,scenario,contentGoals[],materials[],lengthPages?,deliveryFormats[],standards[],preferences[],prohibitions[],uncertainties[],assumptions[]},',
    '"proposal":null | {question,options:[{id,label,plainImpact,scope:"local"|"multi",reversible,previewRef?}],recommendedOptionId}}',
    'Use demo-* standards only. If tone/style is ambiguous, include proposal with 2-3 reversible options.',
    'contentGoals must be short English snake-case tokens like include-metrics, compare, summarize.',
  ].join(' ');

  const raw = await chatCompletion(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Document kind: ${kindLabel}\nUser requirement (zh/en):\n${input.text.trim()}`,
      },
    ],
    { capability: '1001', temperature: 0.2, maxTokens: 2048 },
  );

  const parsed = parseLlmJson(raw);
  const checked = validate(parsed, llmPayloadSchema);
  if (!checked.ok) {
    throw new Error(`LLM brief invalid: ${checked.errors.join('; ')}`);
  }

  const payload = parsed as {
    brief: Omit<Brief, 'id' | 'projectId' | 'createdAt'>;
    proposal?: InterpretResult['proposal'];
  };

  const brief: Brief = {
    id: idFactory('brief'),
    projectId: input.projectId,
    createdAt: clock(),
    ...payload.brief,
    deliveryFormats:
      payload.brief.deliveryFormats?.length > 0
        ? payload.brief.deliveryFormats
        : input.kind === 'presentation'
          ? ['html', 'pdf', 'pptx']
          : ['pdf', 'latex'],
  };
  assertValid(brief, briefSchema, 'Brief');

  if (payload.proposal) {
    const ids = new Set(payload.proposal.options.map((o) => o.id));
    if (!ids.has(payload.proposal.recommendedOptionId)) {
      throw new Error('LLM proposal recommendedOptionId not in options');
    }
  }

  return { brief, proposal: payload.proposal };
}

function parseLlmJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM response contained no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

function extractGoals(text: string): string[] {
  const goals: string[] = [];
  if (/总结|概述|overview/.test(text)) goals.push('summarize');
  if (/数据|指标|KPI/.test(text)) goals.push('include-metrics');
  if (/对比|比较/.test(text)) goals.push('compare');
  if (goals.length === 0) goals.push('deliver-clear-narrative');
  return goals;
}

function buildToneProposal(
  idFactory: IdFactory,
  clock: Clock,
  text: string,
): InterpretResult['proposal'] {
  const options: ProposalOption[] = [
    {
      id: 'o-formal',
      label: '更正式可信',
      plainImpact: '字号略小、行距更稳、配色偏深灰蓝，适合汇报给领导。',
      scope: 'multi',
      reversible: true,
      previewRef: 'preview-formal',
    },
    {
      id: 'o-clean',
      label: '清爽易读',
      plainImpact: '留白更多、标题更轻，适合快速浏览与内部分享。',
      scope: 'multi',
      reversible: true,
      previewRef: 'preview-clean',
    },
    {
      id: 'o-bold',
      label: '重点醒目',
      plainImpact: '标题更大更粗、关键数字高亮，适合路演或对外展示。',
      scope: 'local',
      reversible: true,
      previewRef: 'preview-bold',
    },
  ];
  const recommendedOptionId = VIVID_WORDS.test(text) ? 'o-bold' : 'o-formal';
  return {
    question: '你希望读者先感到哪种气质？',
    options,
    recommendedOptionId,
  };
}

export function briefToProposal(
  projectId: string,
  interpret: InterpretResult,
  idFactory: IdFactory = randomIdFactory,
  clock: Clock = systemClock,
): Proposal | null {
  if (!interpret.proposal) return null;
  return {
    id: idFactory('prop'),
    projectId,
    question: interpret.proposal.question,
    options: interpret.proposal.options,
    recommendedOptionId: interpret.proposal.recommendedOptionId,
    createdAt: clock(),
  };
}
