/**
 * AOIDE · left-pane controller.
 * Project switcher, searchable task/session list, and version history.
 */
import { $, el, icon, clear } from './dom.js';
import { taskItem, historyItem } from './components.js';

export function initLeft(handlers = {}) {
  const switcher = $('#project-switcher');
  const search = $('#task-search');
  const taskList = $('#task-list');
  const historyList = $('#history-list');
  const newBtn = $('#new-project');

  let tasks = [];
  let activeTaskId = null;

  switcher?.addEventListener('change', () => handlers.onSelectProject?.(switcher.value));
  newBtn?.addEventListener('click', () => handlers.onNewProject?.());
  search?.addEventListener('input', () => renderTasks(tasks, activeTaskId));

  function renderProjects(projects = [], activeId) {
    clear(switcher);
    if (!projects.length) {
      switcher.append(el('option', { value: '' }, '暂无项目 · 点“新建”开始'));
      switcher.disabled = true;
      return;
    }
    switcher.disabled = false;
    projects.forEach((p) => {
      const opt = el('option', { value: p.id }, `${p.name}（${p.kind === 'presentation' ? '幻灯片' : 'PDF'}）`);
      if (p.id === activeId) opt.selected = true;
      switcher.append(opt);
    });
  }

  function emptyNote(text) {
    return el('div', { class: 'ao-empty', style: 'padding:var(--ao-space-6) var(--ao-space-3)' }, [
      el('div', { class: 'ao-empty__art', style: 'width:40px;height:40px' }, [icon('doc', 'ao-icon ao-icon--sm')]),
      el('p', { class: 'ao-empty__text', style: 'font-size:var(--ao-fs-xs)' }, text),
    ]);
  }

  function renderTasks(list = [], activeId = null) {
    tasks = list; activeTaskId = activeId;
    clear(taskList);
    const q = (search?.value || '').trim().toLowerCase();
    const filtered = q ? list.filter((t) => (t.title || t.goal || '').toLowerCase().includes(q)) : list;
    if (!filtered.length) {
      taskList.append(emptyNote(q ? '没有匹配的任务' : '还没有任务，描述一个需求就会出现在这里'));
      return;
    }
    filtered.forEach((t) => taskList.append(taskItem(t, { selected: t.id === activeId, onClick: (task) => handlers.onSelectTask?.(task) })));
  }

  function renderHistory(revisions = [], headId = null) {
    clear(historyList);
    if (!revisions.length) {
      historyList.append(emptyNote('生成或修改后，版本会记录在这里，可随时恢复'));
      return;
    }
    revisions.forEach((r) => historyList.append(historyItem(r, { isHead: r.id === headId, onRestore: (rev) => handlers.onRestore?.(rev) })));
  }

  return { renderProjects, renderTasks, renderHistory };
}
