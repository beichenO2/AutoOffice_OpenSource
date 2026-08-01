/**
 * AOIDE · API client
 * Thin wrappers over the AutoOffice engine HTTP contract (same-origin).
 * Every failure rejects with an ApiError carrying { code, message } so the UI
 * can drive real error / empty states instead of guessing.
 *
 * NOTE: the backend is implemented by the engine owner. Until it is live these
 * calls will reject (network/404) and the UI must fall back to empty/error
 * states — we never fabricate documents into the main flow.
 */

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code || 'request failed');
    this.name = 'ApiError';
    this.code = code || 'unknown';
    this.status = status ?? 0;
  }
}

const BASE = '/api/engine';

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError('network', networkErr?.message || '无法连接到服务', 0);
  }

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || '请求失败';
    if (ct.includes('application/json')) {
      const data = await res.json().catch(() => null);
      if (data?.error) { code = data.error.code || code; message = data.error.message || message; }
    }
    throw new ApiError(code, message, res.status);
  }
  if (ct.includes('application/json')) return res.json();
  return res; // binary (render / export) — caller handles blob
}

export const api = {
  // ---- projects ----
  listProjects: () => request('/projects'),
  createProject: (name, kind) => request('/projects', { method: 'POST', body: { name, kind } }),
  // one-click "topic → full editable deck" (optionally grounded by outline /
  // guidance / chosen images; may allow LaTeX formulas)
  generateDeck: (payload) => request('/decks', { method: 'POST', body: payload }),
  getOverview: (projectId) => request(`/projects/${encodeURIComponent(projectId)}/overview`),

  // ---- requirements / tasks ----
  postRequirement: (projectId, text) =>
    request(`/projects/${encodeURIComponent(projectId)}/requirements`, { method: 'POST', body: { text } }),
  getTask: (taskId, signal) => request(`/tasks/${encodeURIComponent(taskId)}`, { signal }),
  cancelTask: (taskId) => request(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' }),

  // ---- events (lightweight polling) ----
  getEvents: (projectId, sinceIso) =>
    request(`/projects/${encodeURIComponent(projectId)}/events?since=${encodeURIComponent(sinceIso || '')}`),

  // ---- annotations ----
  postAnnotation: (projectId, payload) =>
    request(`/projects/${encodeURIComponent(projectId)}/annotations`, { method: 'POST', body: payload }),

  // ---- insert / reference image ----
  addImage: (projectId, payload) =>
    request(`/projects/${encodeURIComponent(projectId)}/images`, { method: 'POST', body: payload }),

  // ---- proposals ----
  chooseProposal: (proposalId, optionId) =>
    request(`/proposals/${encodeURIComponent(proposalId)}/choose`, { method: 'POST', body: { optionId } }),

  // ---- undo / redo ----
  undo: (projectId) => request(`/projects/${encodeURIComponent(projectId)}/undo`, { method: 'POST' }),
  redo: (projectId) => request(`/projects/${encodeURIComponent(projectId)}/redo`, { method: 'POST' }),

  // ---- revision render / boxes / diff (binary render handled by caller) ----
  renderUrl: (revisionId) => `${BASE}/revisions/${encodeURIComponent(revisionId)}/render`,
  fetchRender: (revisionId) => request(`/revisions/${encodeURIComponent(revisionId)}/render`),
  getBoxes: (revisionId, page) => request(`/revisions/${encodeURIComponent(revisionId)}/boxes?page=${page}`),
  getDiff: (revisionId) => request(`/revisions/${encodeURIComponent(revisionId)}/diff`),

  // ---- export ----
  exportUrl: (projectId, format, clicks = false) =>
    `${BASE}/projects/${encodeURIComponent(projectId)}/export?format=${encodeURIComponent(format)}${clicks ? '&clicks=1' : ''}`,

  // ---- standards ----
  getStandards: () => request('/standards/profiles'),
  setStandardProfile: (projectId, profileId) =>
    request(`/projects/${encodeURIComponent(projectId)}/standard-profile`, { method: 'PUT', body: { profileId } }),
};
