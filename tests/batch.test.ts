import { describe, it, expect } from 'vitest';
import { processBatch, generateMultiFormat } from '../src/batch/processor.js';
import type { BatchJob } from '../src/batch/processor.js';

describe('batch — processor', () => {
  const sampleData = {
    sections: [
      { title: 'Executive Summary', content: 'This is a comprehensive overview.' },
      { title: 'Key Findings', content: 'We found several important results.' },
    ],
  };

  it('processes a single HTML job', async () => {
    const jobs: BatchJob[] = [
      { id: 'test-1', format: 'html', data: sampleData },
    ];
    const results = await processBatch(jobs);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('test-1');
    expect(results[0].format).toBe('html');
    expect(results[0].artifact.body).toContain('Executive Summary');
    expect(results[0].durationMs).toBeGreaterThan(0);
    expect(results[0].error).toBeUndefined();
  });

  it('processes multiple jobs in parallel', async () => {
    const jobs: BatchJob[] = [
      { id: 'html-1', format: 'html', data: sampleData },
      { id: 'html-2', format: 'html', data: { sections: [{ title: 'Test', content: 'Content' }] } },
    ];
    const results = await processBatch(jobs, { concurrency: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(['html-1', 'html-2']);
  });

  it('applies deAI processing by default', async () => {
    const aiData = {
      sections: [{ title: 'Summary', content: '综上所述，this is 值得注意的是 important.' }],
    };
    const results = await processBatch([{ id: 'deai-test', format: 'html', data: aiData }]);
    expect(results[0].artifact.body).not.toContain('综上所述');
    expect(results[0].artifact.body).not.toContain('值得注意的是');
  });

  it('skips deAI when disabled', async () => {
    const aiData = {
      sections: [{ title: 'Summary', content: '综上所述，important findings.' }],
    };
    const results = await processBatch([{ id: 'no-deai', format: 'html', data: aiData }], { deai: false });
    expect(results[0].artifact.body).toContain('综上所述');
  });

  it('handles empty data gracefully', async () => {
    const results = await processBatch([
      { id: 'empty', format: 'html', data: { sections: [] } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBeUndefined();
    expect(results[0].artifact.body).toBeDefined();
  });

  it('generateMultiFormat creates reports in all requested formats', async () => {
    const map = await generateMultiFormat(sampleData, ['html']);
    expect(map.size).toBe(1);
    expect(map.get('html')?.artifact.body).toContain('Executive Summary');
  });

  it('respects concurrency limit', async () => {
    const jobs: BatchJob[] = Array.from({ length: 6 }, (_, i) => ({
      id: `conc-${i}`,
      format: 'html' as const,
      data: sampleData,
    }));
    const results = await processBatch(jobs, { concurrency: 2 });
    expect(results).toHaveLength(6);
  });
});
