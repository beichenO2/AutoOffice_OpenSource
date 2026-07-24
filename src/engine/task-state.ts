import type { AgentTask, TaskStatus, TaskStep } from './types.js';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ['interpreting', 'failed', 'paused'],
  interpreting: ['proposing', 'generating', 'failed', 'paused'],
  proposing: ['awaiting_user_choice', 'generating', 'failed', 'paused'],
  awaiting_user_choice: ['generating', 'editing', 'failed', 'paused'],
  generating: ['rendering', 'verifying', 'failed', 'paused'],
  editing: ['rendering', 'verifying', 'failed', 'paused'],
  rendering: ['verifying', 'failed', 'completed', 'paused'],
  verifying: ['completed', 'failed', 'paused'],
  completed: [],
  failed: ['queued'],
  paused: ['queued'],
};

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionTask(
  task: AgentTask,
  to: TaskStatus,
  step?: Partial<TaskStep>,
  clock: Clock = systemClock,
): AgentTask {
  if (!canTransition(task.status, to)) {
    throw new InvalidTransitionError(task.status, to);
  }
  const steps = [...task.steps];
  if (step?.name) {
    steps.push({
      name: step.name,
      status: step.status ?? 'active',
      detail: step.detail,
      at: step.at ?? clock(),
    });
  }
  return {
    ...task,
    status: to,
    currentStep: step?.name ?? task.currentStep,
    steps,
    updatedAt: clock(),
  };
}

export function newTask(
  partial: Pick<AgentTask, 'id' | 'projectId' | 'goal'> & Partial<AgentTask>,
  clock: Clock = systemClock,
): AgentTask {
  const now = clock();
  return {
    status: 'queued',
    inputs: {},
    assumptions: [],
    steps: [],
    toolRunIds: [],
    revisionIds: [],
    verificationRunIds: [],
    proposalIds: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
