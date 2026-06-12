import { describe, it, expect } from 'vitest';
import {
  getDocWorkflowConfig,
  createGenerateTask,
  createSummarizeTask,
  planBatchGeneration,
} from '../src/workflow/doc-workflow.js';

describe('workflow — doc-workflow', () => {
  it('getDocWorkflowConfig returns defaults', () => {
    const config = getDocWorkflowConfig();
    expect(config.taskTimeout).toBe(120);
    expect(config.deaiEnabled).toBe(true);
    expect(config.mermaidEnabled).toBe(true);
    expect(config.parallelFormats).toContain('pdf');
    expect(config.validationLevel).toBe('standard');
  });

  it('getDocWorkflowConfig merges overrides', () => {
    const config = getDocWorkflowConfig({ taskTimeout: 60, deaiEnabled: false });
    expect(config.taskTimeout).toBe(60);
    expect(config.deaiEnabled).toBe(false);
    expect(config.mermaidEnabled).toBe(true);
  });

  it('createGenerateTask creates a properly structured task', () => {
    const task = createGenerateTask('pdf', { title: 'Test' });
    expect(task.type).toBe('generate');
    expect(task.format).toBe('pdf');
    expect(task.status).toBe('pending');
    expect(task.id).toMatch(/^gen-pdf-/);
    expect(task.input).toEqual({ title: 'Test' });
  });

  it('createSummarizeTask creates summarize task', () => {
    const task = createSummarizeTask([{ kind: 'text', value: 'content' }]);
    expect(task.type).toBe('summarize');
    expect(task.status).toBe('pending');
    expect(task.id).toMatch(/^sum-/);
  });

  it('planBatchGeneration creates tasks for each format', () => {
    const data = { title: 'Report', sections: [] };
    const tasks = planBatchGeneration(data, ['pdf', 'docx', 'pptx']);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.format)).toEqual(['pdf', 'docx', 'pptx']);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });

  it('planBatchGeneration adds chart task when mermaid data present', () => {
    const data = { title: 'Report', mermaid: 'graph TD\n  A --> B' };
    const tasks = planBatchGeneration(data, ['pdf']);
    expect(tasks).toHaveLength(2);
    expect(tasks[1].type).toBe('render-chart');
  });

  it('planBatchGeneration skips chart when mermaid disabled', () => {
    const config = getDocWorkflowConfig({ mermaidEnabled: false });
    const data = { title: 'Report', mermaid: 'graph TD\n  A --> B' };
    const tasks = planBatchGeneration(data, ['pdf'], config);
    expect(tasks).toHaveLength(1);
  });
});
