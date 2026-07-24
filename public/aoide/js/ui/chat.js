/**
 * AOIDE · right-pane chat controller.
 * Renders the conversation + contextual cards (status / proposal / change /
 * error) and drives the composer (auto-grow, ⌘/Ctrl+Enter, generating lock).
 */
import { $, clear } from './dom.js';
import { STATUS_LABEL, message, statusCard, proposalCard, changeSummary, errorRecovery, emptyChat } from './components.js';

const BUSY_STATES = new Set(['interpreting', 'proposing', 'generating', 'editing', 'rendering', 'verifying']);

export function initChat(handlers = {}) {
  const stream = $('#chat-stream');
  const input = $('#chat-input');
  const send = $('#chat-send');
  const pill = $('#agent-state-pill');

  // composer: auto-grow
  const autogrow = () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; };
  input?.addEventListener('input', autogrow);

  function submit() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = ''; autogrow();
    handlers.onSend?.(text);
  }
  send?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  function setBusy(busy, statusText) {
    send.disabled = busy;
    input.setAttribute('aria-busy', String(busy));
    pill.textContent = statusText || (busy ? '处理中…' : '待命');
    pill.style.color = busy ? 'var(--ao-accent)' : '';
  }

  function renderStream(data = {}) {
    const { messages = [], task = null, proposal = null, diff = null, error = null } = data;
    clear(stream);

    if (!messages.length && !task && !proposal && !diff && !error) {
      stream.append(emptyChat());
      setBusy(false);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'ao-chat';
    messages.forEach((m) => wrap.append(message(m)));
    if (task && BUSY_STATES.has(task.status)) wrap.append(statusCard(task));
    if (proposal && !proposal.chosenOptionId) {
      wrap.append(proposalCard(proposal, {
        onChoose: (oid) => handlers.onChooseOption?.(proposal.id, oid),
        onConfirm: (oid) => handlers.onConfirmProposal?.(proposal.id, oid),
      }));
    }
    if (diff) wrap.append(changeSummary(diff, { onUndo: () => handlers.onUndo?.() }));
    if (error) wrap.append(errorRecovery(error, { onRetry: () => handlers.onRetry?.() }));
    stream.append(wrap);

    const busy = task ? BUSY_STATES.has(task.status) : false;
    setBusy(busy, task ? STATUS_LABEL[task.status] : undefined);
    stream.scrollTop = stream.scrollHeight;
  }

  return { renderStream, setBusy, focus: () => input?.focus() };
}
