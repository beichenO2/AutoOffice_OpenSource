/**
 * Phase 10: Document processing workflow configuration for gsd-2.
 * Optimizes the multi-agent workflow for AutoOffice's specific use case:
 * - Shorter task cycle (document tasks are typically fast)
 * - Format-specific validation at each step
 * - Parallel generation of multiple output formats
 */

export interface DocWorkflowConfig {
  /** Maximum task duration before timeout (seconds) */
  taskTimeout: number;
  /** Formats to generate in parallel */
  parallelFormats: string[];
  /** Whether to run deAI processing */
  deaiEnabled: boolean;
  /** Whether to generate Mermaid diagrams */
  mermaidEnabled: boolean;
  /** Content routing thresholds (word counts) */
  routingThresholds: {
    inline: number;
    llmwiki: number;
  };
  /** Validation strictness: loose, standard, strict */
  validationLevel: 'loose' | 'standard' | 'strict';
}

const DEFAULT_CONFIG: DocWorkflowConfig = {
  taskTimeout: 120,
  parallelFormats: ['pdf', 'docx'],
  deaiEnabled: true,
  mermaidEnabled: true,
  routingThresholds: {
    inline: 3000,
    llmwiki: 30000,
  },
  validationLevel: 'standard',
};

export function getDocWorkflowConfig(overrides?: Partial<DocWorkflowConfig>): DocWorkflowConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export interface DocTask {
  id: string;
  type: 'generate' | 'summarize' | 'validate' | 'render-chart';
  input: Record<string, unknown>;
  format?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export function createGenerateTask(format: string, data: Record<string, unknown>): DocTask {
  return {
    id: `gen-${format}-${Date.now()}`,
    type: 'generate',
    input: data,
    format,
    status: 'pending',
  };
}

export function createSummarizeTask(inputs: Array<{ kind: string; value: string }>): DocTask {
  return {
    id: `sum-${Date.now()}`,
    type: 'summarize',
    input: { inputs },
    status: 'pending',
  };
}

/**
 * Plan a batch of parallel format generation tasks.
 * Returns tasks in dependency order: summarize first if needed, then parallel generates.
 */
export function planBatchGeneration(
  data: Record<string, unknown>,
  formats: string[],
  config: DocWorkflowConfig = DEFAULT_CONFIG,
): DocTask[] {
  const tasks: DocTask[] = [];

  for (const format of formats) {
    tasks.push(createGenerateTask(format, data));
  }

  if (config.mermaidEnabled && data['mermaid']) {
    tasks.push({
      id: `chart-${Date.now()}`,
      type: 'render-chart',
      input: { code: data['mermaid'] },
      status: 'pending',
    });
  }

  return tasks;
}
