/**
 * AOIDE · demo fixtures (SHOWCASE ONLY).
 * Opt-in via ?demo=1. These sample objects exist purely to exercise every
 * component/state visually + for screenshots. They are NEVER used by the real
 * data flow (see main.js bootReal()).
 */
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();

export const demoProjects = [
  { id: 'p-review', name: '季度业务回顾', kind: 'pdf', language: 'latex', headRevisionId: 'r3', lastGoodRevisionId: 'r3', createdAt: iso(2880), updatedAt: iso(6) },
  { id: 'p-launch', name: '产品发布会', kind: 'presentation', language: 'html', headRevisionId: 'rs2', lastGoodRevisionId: 'rs2', createdAt: iso(1440), updatedAt: iso(52) },
];

export const demoTasks = [
  { id: 't-1', title: '把封面标题放大', goal: '把封面标题放大', kind: 'pdf', status: 'completed', updatedAt: iso(6), createdAt: iso(9) },
  { id: 't-2', title: '第 2 页加一张对比表', goal: '第 2 页加一张对比表', kind: 'pdf', status: 'generating', updatedAt: iso(1), createdAt: iso(3),
    steps: [
      { name: '理解需求', status: 'done', detail: '在第 2 页插入对比表', at: iso(3) },
      { name: '定位插入点', status: 'done', at: iso(2) },
      { name: '生成表格源码', status: 'active', detail: '正在编写 LaTeX 表格', at: iso(1) },
      { name: '重新渲染', status: 'pending', at: iso(0) },
    ] },
  { id: 't-3', title: '统一配色为品牌蓝', goal: '统一配色为品牌蓝', kind: 'pdf', status: 'awaiting_user_choice', updatedAt: iso(12), createdAt: iso(14) },
  { id: 't-4', title: '导出前检查排版', goal: '导出前检查排版', kind: 'pdf', status: 'failed', updatedAt: iso(40), createdAt: iso(42) },
];

export const demoRevisions = [
  { id: 'r3', label: 'v3 · 放大封面标题', origin: 'edit', createdAt: iso(6), renderStatus: 'rendered', patchSummary: '放大并加粗封面主标题' },
  { id: 'r2', label: 'v2 · 初稿生成', origin: 'generation', createdAt: iso(120), renderStatus: 'rendered' },
  { id: 'r1', label: 'v1 · 新建空白项目', origin: 'import', createdAt: iso(2880), renderStatus: 'rendered' },
];

export const demoMessages = [
  { id: 'm1', role: 'user', kind: 'text', content: '帮我把封面标题弄得更醒目一点', createdAt: iso(13) },
  { id: 'm2', role: 'agent', kind: 'text', content: '好的～“更醒目”有几种做法，效果和影响范围不一样，你挑一个我就动手：', createdAt: iso(12) },
];

export const demoProposal = {
  id: 'pr-1', projectId: 'p-review', createdAt: iso(12), recommendedOptionId: 'o1',
  question: '“让封面标题更醒目”，你更想要哪种效果？',
  options: [
    { id: 'o1', label: '加大字号 + 加粗', plainImpact: '只动封面主标题，最稳妥、几乎不会影响其它排版。', scope: 'local', reversible: true },
    { id: 'o2', label: '换成品牌色横幅标题', plainImpact: '封面更有设计感，会调整封面的标题区域布局。', scope: 'local', reversible: true },
    { id: 'o3', label: '全文统一“强调标题”风格', plainImpact: '所有页面的标题一起变醒目，风格统一但改动较大。', scope: 'multi', reversible: true },
  ],
};

export const demoDiff = { baseRevisionId: 'r2', changedNodeIds: ['cover-title', 'cover-subtitle'], patchSummary: '把封面主标题字号从 24pt 提到 36pt 并加粗' };
