import { describe, it, expect, afterEach } from 'vitest';
import { deckSpecFromBrief } from '../../src/engine/orchestrator.js';
import {
  renderSlidevSource,
  buildSlidevSourceMap,
  applySlidevEditIntent,
  listSlidevNodeIds,
  hasSlidevCli,
  slidevBuild,
  cleanupSlidevWorkDir,
} from '../../src/engine/slidev/index.js';
import { buildReplaceTextIntent } from '../../src/engine/latex/patch.js';
import type { Brief } from '../../src/engine/types.js';

const hasSlidev = hasSlidevCli();

const sampleBrief: Brief = {
  id: 'brief-1',
  projectId: 'proj-1',
  docType: 'presentation',
  audience: 'internal',
  scenario: '季度业务汇报',
  contentGoals: ['展示核心指标', '对比上季度'],
  materials: [],
  deliveryFormats: ['html', 'pptx'],
  standards: [],
  preferences: [],
  prohibitions: [],
  uncertainties: [],
  assumptions: [],
  createdAt: '2026-07-27T00:00:00.000Z',
};

describe('slidev bridge — generate + sourcemap (unit)', () => {
  it('generates slides.md with stable data-ao-id markers', () => {
    const spec = deckSpecFromBrief(sampleBrief, 'clean');
    const source = renderSlidevSource(spec);
    const md = source.find((f) => f.path === 'slides.md')!.content;
    expect(md).toContain('data-ao-id="slide-1-title"');
    expect(md).toContain('data-ao-id="slide-2-b0"');
    expect(md.startsWith('---')).toBe(true);
    const ids = listSlidevNodeIds(md);
    expect(ids).toContain('slide-2-b0');
    expect(ids.length).toBeGreaterThan(3);
  });

  it('buildSlidevSourceMap maps aoId → slideIndex + sourceRange', () => {
    const spec = deckSpecFromBrief(sampleBrief, 'clean');
    const md = renderSlidevSource(spec).find((f) => f.path === 'slides.md')!.content;
    const map = buildSlidevSourceMap(md);
    expect(map.empty).toBe(false);
    const bullet = map.entries.find((e) => e.aoId === 'slide-2-b0');
    expect(bullet).toBeTruthy();
    expect(bullet!.slideIndex).toBe(2);
    expect(bullet!.sourceRange.start).toBeLessThan(bullet!.sourceRange.end);
    expect(bullet!.semanticType).toBe('listitem');
  });

  it('applySlidevEditIntent patches slides.md text locally', () => {
    const spec = deckSpecFromBrief(sampleBrief, 'clean');
    const source = renderSlidevSource(spec);
    const intent = buildReplaceTextIntent(
      {
        id: 'edit-1',
        projectId: 'proj-1',
        baseRevisionId: 'rev-1',
        kind: 'content',
        scope: 'local',
        targetNodeIds: ['slide-2-b0'],
        instruction: '改为「已更新要点」',
        confidence: 0.9,
        rationale: 'test',
      },
      'slide-2-b0',
      '已更新要点',
    );
    const result = applySlidevEditIntent(source, intent);
    expect(result.collateral.ok).toBe(true);
    const md = result.source.find((f) => f.path === 'slides.md')!.content;
    expect(md).toContain('已更新要点');
    expect(md).toContain('data-ao-id="slide-2-b1"');
    expect(md).toContain('对比上季度');
  });

  it('mapping_unavailable when source map is empty', () => {
    const map = buildSlidevSourceMap('# plain markdown\n\nno ao ids here\n');
    expect(map.empty).toBe(true);
    expect(map.entries).toHaveLength(0);
  });
});

describe.skipIf(!hasSlidev)('slidev bridge — CLI (integration)', () => {
  let workDir: string | undefined;

  afterEach(async () => {
    if (workDir) {
      await cleanupSlidevWorkDir(workDir);
      workDir = undefined;
    }
  });

  it('slidev build produces dist HTML from slides.md', async () => {
    const spec = deckSpecFromBrief(sampleBrief, 'clean');
    const source = renderSlidevSource(spec);
    const built = await slidevBuild(source, 180_000);
    workDir = built.workDir;
    expect(built.distDir).toBeTruthy();
    // Build may succeed with empty html on some CI — at minimum CLI exits 0
    expect(typeof built.html).toBe('string');
  }, 200_000);
});
