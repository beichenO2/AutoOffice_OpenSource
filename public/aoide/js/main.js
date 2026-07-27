/**
 * AOIDE · bootstrap / assembly.
 * Wires theme, panels and the three pane controllers together.
 *
 * Modes:
 *   (default)  real flow — calls the engine API; on failure falls back to
 *              honest empty/error states (no fabricated documents).
 *   ?demo=1    showcase — loads demo fixtures to exercise every component.
 *   ?state=X   force a center state for review: pdf|deck|loading|empty|error
 */
import { $, el, icon } from './ui/dom.js';
import { initTheme } from './ui/theme.js';
import { initPanels } from './ui/panels.js';
import { initCenter } from './ui/center.js';
import { initChat } from './ui/chat.js';
import { initLeft } from './ui/left.js';
import { initRender } from './ui/render.js';
import { initAnnotate } from './ui/annotate.js';
import { toast } from './ui/components.js';
import { api, ApiError } from './api.js';
import * as demo from './demo.js';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const FORCED = params.get('state');

// ---- chrome ----
initTheme();
initPanels();

const render = initRender();

const center = initCenter({
  onExport: (fmt) => onExport(fmt),
  onAnnotateToggle: (on) => {
    annotate.setEnabled(on);
    toast(on ? '框选批注已开启：在文档上圈出想改的地方' : '框选批注已关闭');
  },
  onRetry: () => retryRender(),
  onFit: () => {},
});

render.onStatusChange((st) => {
  if (st === 'loading') center.setRenderStatus('pending');
  else if (st === 'loaded') center.setRenderStatus('rendered');
  else if (st === 'failed') center.setRenderStatus('failed');
});

const annotate = initAnnotate({ render, onSubmit: (payload) => submitAnnotation(payload) });

const chat = initChat({
  onSend: (text) => onSend(text),
  onChooseOption: () => {},
  onConfirmProposal: (pid, oid) => onConfirmProposal(pid, oid),
  onUndo: () => onUndo(),
  onRetry: () => retryRender(),
});

const left = initLeft({
  onSelectProject: (id) => selectProject(id),
  onNewProject: () => onNewProject(),
  onSelectTask: (t) => toast(`打开任务：${t.title || t.goal}`),
  onRestore: (rev) => onRestore(rev),
});

// example chips in the center empty state prefill the composer
document.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-example]')?.dataset.example;
  if (ex) { $('#chat-input').value = ex; chat.focus(); }
});

// ---------------------------------------------------------------- app state
const state = { projectId: null, project: null, proposal: null, messages: [], diff: null, revisions: [], revisionId: null };

// ========================= DEMO =========================
function slideThumb(i, current) {
  return el('button', { class: `ao-thumb${i === current ? ' is-current' : ''}`, role: 'option', 'aria-selected': String(i === current), onclick: () => selectSlide(i) }, [
    el('span', { class: 'ao-thumb__idx' }, String(i + 1)),
  ]);
}
function selectSlide(i) {
  document.querySelectorAll('#slide-thumbs .ao-thumb').forEach((t, idx) => t.classList.toggle('is-current', idx === i));
  center.setDoc({ page: i + 1 });
}
function renderDeckThumbs(n, current = 0) {
  const host = $('#slide-thumbs');
  host.replaceChildren();
  for (let i = 0; i < n; i++) host.append(slideThumb(i, current));
}

function loadDemo() {
  left.renderProjects(demo.demoProjects, 'p-review');
  left.renderTasks(demo.demoTasks, 't-3');
  left.renderHistory(demo.demoRevisions, 'r3');
  state.projectId = 'p-review';
  state.messages = demo.demoMessages.slice();
  state.proposal = demo.demoProposal;
  center.setMode('pdf');
  center.setDoc({ name: '季度业务回顾', sub: 'PDF · LaTeX 源', page: 1, pages: 8 });
  center.setRenderStatus('rendered');
  chat.renderStream({ messages: state.messages, proposal: state.proposal });
}

// ======================= REAL FLOW ======================
function friendly(e) {
  if (e instanceof ApiError && e.code === 'network') return '无法连接到文档引擎服务，请确认后端已启动。';
  if (e instanceof ApiError) return `${e.message}（${e.code}）`;
  return e?.message || '发生未知错误';
}

async function bootReal() {
  center.setState('loading');
  center.setDoc({ name: '加载中…', sub: '' });
  chat.renderStream({});
  try {
    const { projects } = await api.listProjects();
    left.renderProjects(projects, projects[0]?.id);
    if (!projects.length) { center.setState('empty'); return; }
    await selectProject(projects[0].id);
  } catch (e) {
    center.setState('error');
    $('#error-msg').textContent = friendly(e);
    toast(friendly(e), 'error');
  }
}

async function selectProject(id) {
  if (DEMO) { toast('演示模式：切换项目'); return; }
  state.projectId = id;
  center.setState('loading');
  try {
    const ov = await api.getOverview(id);
    state.project = ov.project;
    center.setMode(ov.project.kind);
    center.setDoc({ name: ov.project.name, sub: ov.project.kind === 'presentation' ? '幻灯片 · HTML 源' : 'PDF · LaTeX 源' });
    left.renderTasks(ov.tasks || []);
    left.renderHistory(ov.revisions || [], ov.project.headRevisionId);
    state.messages = ov.messages || [];
    state.revisions = ov.revisions || [];
    chat.renderStream({ messages: state.messages });
    await showRevision(ov.project.headRevisionId, ov.project.kind);
  } catch (e) {
    center.setState('error');
    $('#error-msg').textContent = friendly(e);
    toast(friendly(e), 'error');
  }
}

/**
 * Mount a revision's *real* render and load its box map, so the centre pane
 * and the selection overlay always describe the same bytes.
 */
async function showRevision(revisionId, kind) {
  if (!revisionId) {
    center.setState('empty');
    center.setRenderStatus('pending');
    annotate.setBoxes([], 1);
    return;
  }
  const rev = state.revisions.find((r) => r.id === revisionId);
  if (rev?.renderStatus === 'failed') {
    center.setState('error');
    $('#error-msg').textContent = '编译源文件时出错，已为你保留上一版可用文档，内容不会丢失。';
    $('#error-diagnostics').textContent = rev.renderError || '（引擎未提供诊断信息）';
    center.setRenderStatus('failed');
    return;
  }
  center.setMode(kind);
  state.revisionId = revisionId;
  render.mount({ url: api.renderUrl(revisionId), kind, page: 1, revisionId });
  try {
    await render.whenLoaded(revisionId);
    const { boxes, pageCount } = await api.getBoxes(revisionId, 0);
    annotate.setBoxes(boxes || [], 1);
    center.setDoc({ page: 1, pages: pageCount || 1 });
  } catch (e) {
    annotate.setBoxes([], 1);
    if (render.status === 'failed') {
      toast('渲染加载失败，已保留上一版可用文档', 'error');
    } else {
      toast(`未能加载框选映射：${friendly(e)}`, 'error');
    }
  }
}

/** Box selection + instruction → engine. Nothing is applied client-side. */
async function submitAnnotation(payload) {
  if (!state.projectId) return toast('请先打开一个文档', 'error');
  try {
    chat.setBusy?.(true, '定位并修改');
    const res = await api.postAnnotation(state.projectId, {
      page: payload.page,
      rectNorm: payload.rectNorm,
      viewport: payload.viewport,
      instruction: payload.instruction,
      ...(state.revisionId ? { revisionId: state.revisionId } : {}),
      ...(payload.domNodeId ? { domNodeId: payload.domNodeId } : {}),
    });
    if (res.revision) toast('已按框选定点修改并重新渲染', 'success');
    else toast(res.annotation?.ambiguityReason || '已记录批注，但还不能安全地直接修改', 'error');
    await selectProject(state.projectId);
  } catch (e) {
    toast(friendly(e), 'error');
  } finally {
    chat.setBusy?.(false);
  }
}

const BUSY_STATUSES = ['queued', 'interpreting', 'proposing', 'generating', 'editing', 'rendering', 'verifying'];

/** Poll the overview until no task is mid-flight, then refresh every pane. */
async function pollProject(id, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const ov = await api.getOverview(id);
    if (!(ov.tasks || []).some((t) => BUSY_STATUSES.includes(t.status))) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  await selectProject(id);
}

async function onSend(text) {
  state.messages.push({ id: 'local-' + Date.now(), role: 'user', kind: 'text', content: text });
  chat.renderStream({ messages: state.messages, proposal: state.proposal });

  if (DEMO) {
    chat.setBusy(true, '理解需求');
    setTimeout(() => {
      state.messages.push({ id: 'a' + Date.now(), role: 'agent', kind: 'text', content: '收到，我给你几种做法参考：' });
      chat.renderStream({ messages: state.messages, proposal: demo.demoProposal });
    }, 700);
    return;
  }
  try {
    chat.setBusy(true, '理解需求');
    await api.postRequirement(state.projectId, text);
    await pollProject(state.projectId);
  } catch (e) {
    chat.renderStream({ messages: state.messages, error: { message: friendly(e) } });
  } finally {
    chat.setBusy?.(false);
  }
}

function onConfirmProposal(pid, oid) {
  state.proposal = null;
  state.messages.push({ id: 'a' + Date.now(), role: 'agent', kind: 'text', content: '好的，正在按这个方案修改…' });
  chat.renderStream({ messages: state.messages });
  chat.setBusy(true, '编辑中');
  if (DEMO) {
    setTimeout(() => {
      state.diff = demo.demoDiff;
      state.messages.push({ id: 'a' + Date.now(), role: 'agent', kind: 'text', content: '改好啦，你看看效果，不满意随时撤销。' });
      chat.renderStream({ messages: state.messages, diff: state.diff });
      center.showCompare(true);
      center.setRenderStatus('rendered');
      toast('已应用改动', 'success');
    }, 900);
    return;
  }
  api.chooseProposal(pid, oid).catch((e) => chat.renderStream({ messages: state.messages, error: { message: friendly(e) } }));
}

function onUndo() {
  state.diff = null;
  center.showCompare(false);
  chat.renderStream({ messages: state.messages });
  toast('已撤销上一次改动', 'success');
  if (!DEMO && state.projectId) api.undo(state.projectId).catch((e) => toast(friendly(e), 'error'));
}

async function onRestore(rev) {
  if (DEMO || !state.project) { toast(`演示模式：恢复到「${rev.label}」`); return; }
  await showRevision(rev.id, state.project.kind);
  toast(`已切换到「${rev.label}」的渲染结果`, 'success');
}

function retryRender() {
  center.setState('loading');
  toast('正在重试渲染…');
  if (DEMO) { setTimeout(() => { center.setMode('pdf'); center.setRenderStatus('rendered'); }, 800); return; }
  if (state.projectId) selectProject(state.projectId);
}

function onExport(fmt) {
  if (DEMO) { toast(`演示模式：导出 ${fmt.toUpperCase()}`); return; }
  if (!state.projectId) return toast('请先打开一个文档', 'error');
  window.open(api.exportUrl(state.projectId, fmt), '_blank');
}

function onNewProject() {
  if (DEMO) return toast('演示模式：新建文档');
  const name = prompt('给新文档起个名字：', '未命名文档');
  if (!name) return;
  api.createProject(name, 'pdf').then((r) => { toast('已新建文档', 'success'); bootReal(); if (r?.project) selectProject(r.project.id); })
    .catch((e) => toast(friendly(e), 'error'));
}

// ---- launch ----
if (DEMO) loadDemo();
else bootReal();

// review override: force a specific center state
if (FORCED) {
  if (FORCED === 'deck') { center.setMode('presentation'); renderDeckThumbs(6, 0); center.setDoc({ name: '产品发布会', sub: '幻灯片 · HTML 源', page: 1, pages: 6 }); }
  else center.setState(FORCED);
}
if (DEMO && $('#ao-app').dataset.mode === 'ppt') renderDeckThumbs(6, 0);
