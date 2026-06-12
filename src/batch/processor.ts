import { runReportPipeline } from '../format/pipeline.js';
import { registerFormatAdapters } from '../format/format-adapters.js';
import { stripAiFlavorDeep } from '../text/deai.js';
import type { ReportFormat, RenderArtifact } from '../format/types.js';

export interface BatchJob {
  id: string;
  format: ReportFormat;
  data: Record<string, unknown>;
  templateSource?: string;
  locale?: 'zh-CN' | 'en-US';
}

export interface BatchResult {
  id: string;
  format: ReportFormat;
  artifact: RenderArtifact;
  durationMs: number;
  error?: string;
}

let adaptersRegistered = false;

function ensureAdapters(): void {
  if (!adaptersRegistered) {
    registerFormatAdapters();
    adaptersRegistered = true;
  }
}

/**
 * Process multiple report generation jobs in parallel.
 * Useful when Lobster needs multiple format outputs from the same data.
 */
export async function processBatch(
  jobs: BatchJob[],
  options: { deai?: boolean; concurrency?: number } = {},
): Promise<BatchResult[]> {
  ensureAdapters();
  const { deai = true, concurrency = 3 } = options;
  const results: BatchResult[] = [];

  const chunks: BatchJob[][] = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    chunks.push(jobs.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.allSettled(
      chunk.map(async (job) => {
        const start = Date.now();
        try {
          const data = deai ? (stripAiFlavorDeep(job.data) as Record<string, unknown>) : job.data;
          const artifact = await runReportPipeline({
            format: job.format,
            data,
            template: {
              kind: 'inline',
              source: job.templateSource || '<html><body>{{#each sections}}<h2>{{title}}</h2><p>{{content}}</p>{{/each}}</body></html>',
            },
            locale: job.locale,
          });
          return {
            id: job.id,
            format: job.format,
            artifact,
            durationMs: Date.now() - start,
          } as BatchResult;
        } catch (err: unknown) {
          return {
            id: job.id,
            format: job.format,
            artifact: { mime: 'text/plain', body: '', encoding: 'utf-8' as const },
            durationMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
          } as BatchResult;
        }
      }),
    );

    for (const r of chunkResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      }
    }
  }

  return results;
}

/**
 * Generate the same report in multiple formats simultaneously.
 * Convenience wrapper over processBatch.
 */
export async function generateMultiFormat(
  data: Record<string, unknown>,
  formats: ReportFormat[],
  options: { deai?: boolean; templateSource?: string; locale?: 'zh-CN' | 'en-US' } = {},
): Promise<Map<ReportFormat, BatchResult>> {
  const jobs: BatchJob[] = formats.map((format, i) => ({
    id: `multi-${format}-${i}`,
    format,
    data,
    templateSource: options.templateSource,
    locale: options.locale,
  }));

  const results = await processBatch(jobs, { deai: options.deai });
  const map = new Map<ReportFormat, BatchResult>();
  for (const r of results) {
    map.set(r.format, r);
  }
  return map;
}
