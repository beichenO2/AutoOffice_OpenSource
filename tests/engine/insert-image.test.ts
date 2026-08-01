import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { SLIDES_MD } from '../../src/engine/slidev/index.js';

let dir: string;
let svc: EngineService;

beforeEach(async () => {
  process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
  process.env.AUTOOFFICE_PPT_SOT = 'slidev';
  process.env.AUTOOFFICE_BOXMAP = 'estimate';
  dir = await mkdtemp(join(tmpdir(), 'aoide-img-'));
  svc = new EngineService({
    root: dir,
    idFactory: createDeterministicIdFactory('img'),
    clock: fixedClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedDeck() {
  const { project } = await svc.createProject('插图测试', 'presentation');
  await svc.postRequirement(project.id, '做一份季度业务汇报，包含数据和对比分析');
  const ov = await svc.getOverview(project.id);
  return { project, head: ov.revisions.at(-1)! };
}

describe('insert image element (Slidev)', () => {
  it('appends an editable, box-selectable image; slides.md keeps a real <img>; undo is non-destructive', async () => {
    const { project, head } = await seedDeck();
    expect(head.source.some((f) => f.path === SLIDES_MD)).toBe(true);

    const res = await svc.addImageElement(project.id, {
      page: 1,
      colorCard: { hex: '#ff7a59', label: '示意图' },
      alt: '示意图',
    });
    expect(res.nodeId).toMatch(/^slide-1-img-/);
    expect(res.revision).toBeTruthy();

    // The new image is a real element in the Slidev source (frontmatter intact).
    const md = res.revision.source.find((f) => f.path === SLIDES_MD)!.content;
    expect(md).toContain(`data-ao-id="${res.nodeId}"`);
    expect(md).toContain('data-ao-type="image"');
    expect(md.startsWith('---')).toBe(true); // Slidev frontmatter untouched

    // …and it is box-selectable (present in the persisted box map).
    const { boxes } = await svc.getBoxes(res.revision.id, 1);
    expect(boxes.some((b) => b.nodeId === res.nodeId)).toBe(true);

    // Non-destructive: undo drops below the insert revision.
    const undone = await svc.undo(project.id);
    expect(undone?.project.headRevisionId).not.toBe(res.revision.id);
  });

  it('places the image right after an anchor node when afterNodeId is given', async () => {
    const { project, head } = await seedDeck();
    const beforeMd = head.source.find((f) => f.path === SLIDES_MD)!.content;
    const anchor = /data-ao-id="(slide-1-[a-z0-9-]+)"/i.exec(beforeMd)?.[1];
    expect(anchor).toBeTruthy();

    const res = await svc.addImageElement(project.id, {
      page: 1,
      afterNodeId: anchor!,
      colorCard: { hex: '#3a63e8' },
    });
    const md = res.revision.source.find((f) => f.path === SLIDES_MD)!.content;
    const anchorIdx = md.indexOf(`data-ao-id="${anchor}"`);
    const imgIdx = md.indexOf(`data-ao-id="${res.nodeId}"`);
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    expect(imgIdx).toBeGreaterThan(anchorIdx);
  });

  it('rejects unsafe / non-image src', async () => {
    const { project } = await seedDeck();
    await expect(
      svc.addImageElement(project.id, { page: 1, src: 'javascript:alert(1)' }),
    ).rejects.toThrow(/data:image|http/);
  });

  it('is presentation-only (rejects PDF projects)', async () => {
    const { project } = await svc.createProject('PDF 文档', 'pdf');
    await expect(
      svc.addImageElement(project.id, { page: 1, colorCard: { hex: '#123456' } }),
    ).rejects.toThrow(/演示文稿|presentation/);
  });
});
