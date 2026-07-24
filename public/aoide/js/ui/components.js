/**
 * AOIDE · stateless component factories.
 * Each returns a DOM node built from tokens/classes. No data fetching here.
 * Copy is plain-language for non-expert users (no design jargon).
 */
import { el, icon, timeAgo } from './dom.js';

/** Task lifecycle labels — must cover every TaskStatus. */
export const STATUS_LABEL = {
  queued: '等待',
  interpreting: '理解需求',
  proposing: '拟方案',
  awaiting_user_choice: '等你选择',
  generating: '生成中',
  editing: '编辑中',
  rendering: '渲染中',
  verifying: '验证中',
  completed: '完成',
  failed: '失败',
  paused: '暂停',
};

const ORIGIN_LABEL = {
  generation: '生成', edit: '编辑', undo: '撤销', redo: '重做', migration: '迁移', import: '导入',
};

export function statusChip(status) {
  const label = STATUS_LABEL[status] || status || '未知';
  return el('span', { class: `ao-chip is-${status}`, title: label }, [
    el('span', { class: 'ao-chip__dot' }), label,
  ]);
}

export function taskItem(task, { selected = false, onClick } = {}) {
  const kindIcon = task.kind === 'presentation' ? 'file-ppt' : 'file-pdf';
  return el('button', {
    class: `ao-item${selected ? ' is-selected' : ''}`, role: 'listitem',
    'data-testid': 'task-item', 'data-id': task.id,
    onclick: () => onClick?.(task),
  }, [
    el('span', { class: 'ao-item__icon' }, [icon(kindIcon, 'ao-icon ao-icon--sm')]),
    el('span', { class: 'ao-item__main' }, [
      el('span', { class: 'ao-item__title' }, task.title || task.goal || '未命名任务'),
      el('span', { class: 'ao-item__meta' }, timeAgo(task.updatedAt || task.createdAt)),
    ]),
    el('span', { class: 'ao-item__aside' }, [statusChip(task.status)]),
  ]);
}

export function historyItem(rev, { isHead = false, onRestore } = {}) {
  return el('button', {
    class: `ao-history__item${isHead ? ' is-head' : ''}`, role: 'listitem',
    'data-testid': 'history-item', 'data-id': rev.id,
    onclick: () => onRestore?.(rev),
  }, [
    el('span', { class: 'ao-history__rail' }, [el('span', { class: 'ao-history__node' })]),
    el('span', {}, [
      el('div', { class: 'ao-history__label' }, rev.label || '未命名版本'),
      el('div', { class: 'ao-history__meta' }, `${ORIGIN_LABEL[rev.origin] || rev.origin} · ${timeAgo(rev.createdAt)}`),
    ]),
    el('span', { class: 'ao-history__restore ao-btn ao-btn--ghost', title: '恢复到此版本' }, [
      icon('undo', 'ao-icon ao-icon--sm'), '恢复',
    ]),
  ]);
}

export function message(msg) {
  const role = msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'agent';
  const avatar = role === 'user' ? '你' : role === 'system' ? '' : 'AI';
  const children = [];
  if (role !== 'system') children.push(el('span', { class: 'ao-msg__avatar' }, avatar));
  children.push(el('div', { class: 'ao-bubble' }, msg.content || ''));
  return el('div', { class: `ao-msg ao-msg--${role}`, 'data-kind': msg.kind || 'text' }, children);
}

export function stepTimeline(steps = []) {
  return el('div', { class: 'ao-steps' }, steps.map((s) =>
    el('div', { class: `ao-step is-${s.status}` }, [
      el('span', { class: 'ao-step__rail' }, [el('span', { class: 'ao-step__dot' })]),
      el('span', {}, [
        el('div', { class: 'ao-step__name' }, s.name),
        s.detail ? el('div', { class: 'ao-step__detail' }, s.detail) : null,
      ]),
      el('span', { class: 'ao-step__time' }, s.at ? timeAgo(s.at) : ''),
    ])
  ));
}

/** Agent status card: chip + optional step timeline. */
export function statusCard(task) {
  return el('div', { class: 'ao-card', 'data-testid': 'status-card' }, [
    el('div', { class: 'ao-card__head' }, [statusChip(task.status), el('span', { class: 'ao-card__title' }, task.goal || '正在处理')]),
    task.steps?.length ? stepTimeline(task.steps) : null,
  ]);
}

/** Proposal card: 2–3 mutually exclusive options, plain-language impact. */
export function proposalCard(proposal, { selectedId, onChoose, onConfirm } = {}) {
  let chosen = selectedId || proposal.recommendedOptionId;
  const optionNodes = new Map();

  const confirmBtn = el('button', {
    class: 'ao-btn ao-btn--primary', 'data-testid': 'proposal-confirm',
    onclick: () => onConfirm?.(chosen),
  }, [icon('check', 'ao-icon ao-icon--sm'), '就用这个方案']);

  function select(id) {
    chosen = id;
    optionNodes.forEach((node, oid) => node.classList.toggle('is-selected', oid === id));
    onChoose?.(id);
  }

  const options = (proposal.options || []).map((opt) => {
    const node = el('button', {
      class: `ao-option${opt.id === chosen ? ' is-selected' : ''}${opt.id === proposal.recommendedOptionId ? ' is-recommended' : ''}`,
      'data-testid': 'proposal-option', 'data-id': opt.id,
      onclick: () => select(opt.id),
    }, [
      el('span', { class: 'ao-option__preview' }, opt.previewRef ? el('img', { src: opt.previewRef, alt: '', style: 'width:100%;height:100%;object-fit:cover;border-radius:6px' }) : icon('layers', 'ao-icon')),
      el('span', {}, [
        el('div', { class: 'ao-option__label' }, opt.label),
        el('div', { class: 'ao-option__impact' }, opt.plainImpact || ''),
        el('div', { class: 'ao-option__facts' }, [
          el('span', { class: 'ao-pill' }, opt.scope === 'multi' ? '影响多处' : '仅改此处'),
          el('span', { class: 'ao-pill' }, opt.reversible ? '可随时撤销' : '不易撤销'),
        ]),
      ]),
      el('span', { class: 'ao-check' }, [icon('check', 'ao-icon ao-icon--sm')]),
    ]);
    optionNodes.set(opt.id, node);
    return node;
  });

  return el('div', { class: 'ao-card', 'data-testid': 'proposal-card' }, [
    el('div', { class: 'ao-card__head' }, [icon('wand', 'ao-icon ao-icon--sm'), el('span', { class: 'ao-card__title' }, '有几种做法，你挑一个')]),
    el('div', { class: 'ao-card__q' }, proposal.question || ''),
    el('div', { class: 'ao-options' }, options),
    confirmBtn,
  ]);
}

export function changeSummary(diff, { onUndo } = {}) {
  const ids = diff.changedNodeIds || [];
  const changes = ids.slice(0, 6).map((id) =>
    el('div', { class: 'ao-change' }, [
      el('span', { class: 'ao-change__badge is-mod' }, '改'),
      el('span', { class: 'ao-truncate' }, id),
    ])
  );
  return el('div', { class: 'ao-card', 'data-testid': 'change-summary' }, [
    el('div', { class: 'ao-card__head' }, [icon('check', 'ao-icon ao-icon--sm'), el('span', { class: 'ao-card__title' }, '已应用改动')]),
    el('div', { class: 'ao-option__impact', style: 'margin-bottom:10px' }, diff.patchSummary || `更新了 ${ids.length} 处内容`),
    el('div', { class: 'ao-changes' }, changes),
    el('button', { class: 'ao-btn', 'data-testid': 'undo-button', onclick: () => onUndo?.() }, [icon('undo', 'ao-icon ao-icon--sm'), '撤销这次改动']),
  ]);
}

export function errorRecovery(err, { onRetry } = {}) {
  return el('div', { class: 'ao-card', 'data-testid': 'error-recovery', style: 'border-color:var(--ao-danger-soft)' }, [
    el('div', { class: 'ao-card__head', style: 'color:var(--ao-danger)' }, [icon('alert', 'ao-icon ao-icon--sm'), el('span', { class: 'ao-card__title' }, '这一步没成功')]),
    el('div', { class: 'ao-option__impact', style: 'margin-bottom:10px' }, err?.message || '出了点问题，你的文档没有受影响，可以重试。'),
    el('button', { class: 'ao-btn ao-btn--primary', onclick: () => onRetry?.() }, [icon('retry', 'ao-icon ao-icon--sm'), '重试']),
  ]);
}

export function emptyChat() {
  return el('div', { class: 'ao-empty', 'data-testid': 'chat-empty' }, [
    el('div', { class: 'ao-empty__art' }, [icon('wand', 'ao-icon')]),
    el('div', { class: 'ao-empty__title' }, '在下面说说你的想法'),
    el('p', { class: 'ao-empty__text' }, '比如“把封面换成蓝色主题”“给第2页加一张对比表”。我会先给你几个方案，再动手。'),
  ]);
}

let toastTimer;
export function toast(msg, type = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const name = type === 'error' ? 'alert' : type === 'success' ? 'check' : 'wand';
  const node = el('div', { class: 'ao-toast ao-glass--strong', role: 'status' }, [icon(name, 'ao-icon ao-icon--sm'), msg]);
  host.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3600);
}
