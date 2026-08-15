/**
 * Playwright producer for U11 overflow facts: per [data-ao-id]
 * scrollWidth/Height vs client, and/or text Range bbox vs cell.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { closeRenderBrowser, measureDeckBoxes } from '../../src/engine/render/deck.js';
import { auditTextLayout } from '../../src/engine/standards/index.js';
import type { DocumentElementFact } from '../../src/engine/standards/types.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');

const CLIP_TEXT = '这是一段故意写得很长很长很长很长很长很长很长很长很长很长用来撑破窄单元格的中文';

function decorativeTitleFixture(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el{
  font-size:3.5vw;line-height:1.15;font-weight:750;margin:0 0 3.2vw;padding-bottom:1.5vw;
  position:relative;border-bottom:.16vw solid #dce1ec;
}
.ao-slide:not([data-ao-layout="title"]) > h1.ao-el::after{
  content:"";position:absolute;left:0;bottom:-.16vw;width:6.5vw;height:.32vw;background:#4a6cf7;
}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-layout="content">
  <h1 data-ao-id="title" data-ao-type="heading" class="ao-el">短标题</h1>
</div>
</body></html>`;
}

function coverTitleFixture(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{
  position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box;
  padding:6.6vw 8vw;display:flex;flex-direction:column;justify-content:center;
}
.ao-slide[data-ao-layout="title"] h1.ao-el{
  font-size:6.2vw;line-height:1.05;font-weight:800;margin:0;max-width:92%;
}
.ao-slide[data-ao-layout="title"] h1.ao-el::before{content:"";display:block;
  width:7.5vw;height:.6vw;margin-bottom:2.8vw;background:#6f93f7;}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide" data-ao-layout="title">
  <h1 data-ao-id="slide-1-title" data-ao-type="heading" class="ao-el">扩散模型加速采样</h1>
</div>
</body></html>`;
}

function listNestFixture(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
ul{margin:40px;padding:0;list-style:none}
li{margin:0 0 12px;font:20px/1.4 sans-serif}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-type="slide">
  <ul data-ao-id="bullets" data-ao-type="list">
    <li data-ao-id="b0" data-ao-type="listitem">要点一</li>
    <li data-ao-id="b1" data-ao-type="listitem">要点二</li>
  </ul>
</div>
</body></html>`;
}

function measureFixture(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
</style></head>
<body>
<div class="ao-slide">
  <div data-ao-id="clip" data-ao-type="text" style="position:absolute;left:80px;top:80px;width:160px;height:36px;overflow:hidden;font:24px/1.3 sans-serif;white-space:nowrap">${CLIP_TEXT}</div>
  <div data-ao-id="ok" data-ao-type="text" style="position:absolute;left:80px;top:200px;width:400px;height:48px;overflow:hidden;font:16px/1.3 sans-serif">短句</div>
</div>
</body></html>`;
}

afterAll(async () => {
  await closeRenderBrowser();
});

describe('measureDeckBoxes — overflow facts', () => {
  it('sets scrollOverflow or a contentBoxNorm that exceeds the cell on a clipped [data-ao-id]', async () => {
    const boxes = await measureDeckBoxes(measureFixture());
    const clip = boxes.find((b) => b.nodeId === 'clip');
    const ok = boxes.find((b) => b.nodeId === 'ok');
    expect(clip).toBeDefined();
    expect(ok).toBeDefined();

    const clipOverflows =
      clip!.scrollOverflow === true ||
      (clip!.contentBoxNorm !== undefined &&
        (clip!.contentBoxNorm.w > clip!.w + 0.001 || clip!.contentBoxNorm.h > clip!.h + 0.001));
    expect(clipOverflows).toBe(true);
    expect(ok!.scrollOverflow ?? false).toBe(false);
  }, 30_000);

  it('feeds measured overflow onto DocumentElementFact so auditTextLayout can hard-fail', async () => {
    const boxes = await measureDeckBoxes(measureFixture());
    const elements: DocumentElementFact[] = boxes.map((b) => ({
      nodeId: b.nodeId,
      type: 'text',
      page: b.page,
      boxNorm: { x: b.x, y: b.y, w: b.w, h: b.h },
      ...(b.contentBoxNorm !== undefined ? { contentBoxNorm: b.contentBoxNorm } : {}),
      ...(b.scrollOverflow !== undefined ? { scrollOverflow: b.scrollOverflow } : {}),
    }));
    const result = auditTextLayout({ kind: 'presentation', elements });
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.category === 'text-overflow' && f.nodeIds.includes('clip'))).toBe(true);
  }, 30_000);

  it('does not set scrollOverflow for a decorative h1::after tick below the padding box', async () => {
    const boxes = await measureDeckBoxes(decorativeTitleFixture());
    const title = boxes.find((b) => b.nodeId === 'title');
    expect(title).toBeDefined();
    expect(title!.scrollOverflow ?? false).toBe(false);
    const elements: DocumentElementFact[] = boxes.map((b) => ({
      nodeId: b.nodeId,
      type: 'heading',
      page: b.page,
      boxNorm: { x: b.x, y: b.y, w: b.w, h: b.h },
      ...(b.contentBoxNorm !== undefined ? { contentBoxNorm: b.contentBoxNorm } : {}),
      ...(b.scrollOverflow !== undefined ? { scrollOverflow: b.scrollOverflow } : {}),
    }));
    const result = auditTextLayout({ kind: 'presentation', elements });
    expect(result.findings.filter((f) => f.category === 'text-overflow')).toEqual([]);
  }, 30_000);

  it('does not set scrollOverflow on a cover h1 whose tight line-height only spills glyph ink', async () => {
    const boxes = await measureDeckBoxes(coverTitleFixture());
    const title = boxes.find((b) => b.nodeId === 'slide-1-title');
    expect(title).toBeDefined();
    expect(title!.scrollOverflow ?? false).toBe(false);
    const elements: DocumentElementFact[] = boxes.map((b) => ({
      nodeId: b.nodeId,
      type: 'heading',
      page: b.page,
      boxNorm: { x: b.x, y: b.y, w: b.w, h: b.h },
      ...(b.contentBoxNorm !== undefined ? { contentBoxNorm: b.contentBoxNorm } : {}),
      ...(b.scrollOverflow !== undefined ? { scrollOverflow: b.scrollOverflow } : {}),
    }));
    const result = auditTextLayout({ kind: 'presentation', elements });
    expect(result.findings.filter((f) => f.category === 'text-overflow')).toEqual([]);
  }, 30_000);

  it('records parentId for ul/li and does not audit them as overlapping', async () => {
    const boxes = await measureDeckBoxes(listNestFixture());
    const ul = boxes.find((b) => b.nodeId === 'bullets');
    const b0 = boxes.find((b) => b.nodeId === 'b0');
    const b1 = boxes.find((b) => b.nodeId === 'b1');
    expect(ul?.parentId).toBe('slide-1');
    expect(b0?.parentId).toBe('bullets');
    expect(b1?.parentId).toBe('bullets');
    const elements: DocumentElementFact[] = boxes.map((b) => ({
      nodeId: b.nodeId,
      type: b.nodeId === 'bullets' ? 'list' : 'listitem',
      page: b.page,
      parentId: b.parentId,
      boxNorm: { x: b.x, y: b.y, w: b.w, h: b.h },
      ...(b.contentBoxNorm !== undefined ? { contentBoxNorm: b.contentBoxNorm } : {}),
      ...(b.scrollOverflow !== undefined ? { scrollOverflow: b.scrollOverflow } : {}),
    }));
    const result = auditTextLayout({ kind: 'presentation', elements });
    expect(result.findings.filter((f) => f.category === 'text-overlap')).toEqual([]);
  }, 30_000);
});
