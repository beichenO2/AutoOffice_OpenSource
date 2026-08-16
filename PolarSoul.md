# AutoOffice 灵魂

> AI 文档 IDE（aoide 引擎）+ 多格式自动化报告生成平台。Agent 修改本项目前，必须阅读并遵守以下核心特质。

---

## 核心特质

| 特质 | 与社区同类项目的差异 |
|------|----------------------|
| **框选定点 AI 编辑（aoide IDE）** | 在 `/aoide/` 框住任意元素说一句大白话，改动落到文本源的那一个节点；演示文稿预览的每个元素带稳定 `data-ao-id` 与源码位置，LaTeX 项目以 `\aoNode` 标记 + SyncTeX 映射寻址；编辑是外科手术式补丁而非整篇重生成 |
| **导出即产品（矢量 WYSIWYG·演示文稿线）** | deck 导出 PDF = 用 Chromium 打印预览用的那份 HTML，文字可选、体积小、与屏幕所见一致；`?clicks=1` 得分步动画版；PPTX 默认满幅位图，`AUTOOFFICE_PPTX_EDITABLE=1` 可走原生文本框可编辑导出（双轨，不另写预览渲染）；LaTeX 项目直接导出 xelatex 编译的 PDF（预览=产物） |
| **文字密度：换行+分主题分页** | 密文先换行、再按主题/行预算 `paginateDeckSpec` 拆页（续页标题 `（2/N）`）；禁止用省略号截断顶替排版。作者侧仍有 6/80/280 CJK 预算（内容页要点数 / 单条要点 / 段落） |
| **作用域感知编辑（懂文档）** | 同一句指令按语义分流：配色/风格词 → 整册；单句改写 → 仅选中处；「把全部 A 统一改成 B」→ 整册确定性术语替换（含图片 alt）；整册语气 → 多节点语义统一；居中/加粗/字号 → 白名单样式属性 |
| **整册风格包 + 按风格换版式** | tech / gov / business / academic / minimal 五包，换的是版式而不只是配色：gov 借鉴 GB/T 9704-2012 公文视觉签名（红色反线、居中小标宋、一二三层次序数；16:9 幻灯版式，非完整国标版心），academic 用编号徽章，minimal 超大标题主导，tech 大图出血，business 页眉栏 + 左侧识别条；中文别名（科技风/党政风/国标/顶会/基金…）可直接在框选指令里说。五包均以 CSS 覆写实现，DOM/框选契约不变 |
| **数据严谨（grounding）** | 生成稿里的百分比/小数/多位数回查 research/guidance 是否有出处，查无出处的明确报出而不是蒙混过关（个位数、公式与图片豁免；为字符串包含性核查） |
| **多格式统一** | 同一 JSON 数据可生成 PPT/PDF/Word/LaTeX/HTML 五种格式（PPT/Word/PDF/HTML 纯 Node；LaTeX 线依赖系统 xelatex 与既存 Python 模板助手） |
| **去 AI 化处理** | 规则化去除生成文本中的 AI 腔调，使输出更自然 |
| **VLM 视觉质量评估** | 使用本地 VLM 评估文档排版质量，5 维度评分 |
| **模板画廊** | 支持用户自定义模板，持久化到 ~/.autooffice/templates/ |
| **科研图轨（并列 `.drawio`）** | 文稿 SoT 仍是 Slidev `slides.md`；科研图 SoT 是独立 draw.io 原生对象（mxGraph）。草图只进 PolarPrivate **V0000** 理解，禁止整张贴上画布（`whole-sketch-raster` hard fail），禁止 DALL·E / Flux / Midjourney / AutoFigure 生图 |

---

## 运行时权威

- PolarProcess 服务 `autooffice` 是 API 唯一进程生命周期权威；辅助服务
  `autooffice-agent-preview`（Agent 研究预览，独立 engine home）同样只能由
  PolarProcess 启停。
- PolarPort 是 `3900`（生产）与 `3905`（预览）的唯一端口分配与归属权威。
- `Start/start.sh` 与 `Start/agent-preview.sh` 是由 PolarProcess 执行的前台命令；禁止
  后台 `&`、`nohup`、PID 文件、直接信号或第二个进程管理器。
- `Start/start.sh` 默认 `AUTOOFFICE_LLM_EDIT=1`：框选大白话 AI 编辑在生产服务上默认开启。
- 例外：Electron 桌面应用（`npm run app`）在本机随机端口自带 API 子进程，属打包便捷例外，
  不落 PolarManager 治理；持久服务仍只有上述两个。
- `autooffice-auto-evolve` 与 `autooffice-sota-radar` 是独立 cron，API 生命周期
  操作不得修改或触发它们。

## 外部合作

### 依赖

- [PolarPrivate](../PolarPrivate/PolarSoul.md)：LLM 代理（127.0.0.1:12790），deck 生成与框选编辑；科研图 Designer 走视觉 QCSA **V0000**
- [KnowLever](../KnowLever/PolarSoul.md)：RAG 增强

### 被依赖

- [PolarClaw](../PolarClaw/PolarSoul.md)：报告生成技能
- [KnowLever](../KnowLever/PolarSoul.md)：PDF 导出

### 接口契约

- `/api/engine/decks`：主题一键生成整册
- `/api/engine/figures`：科研图（`POST /api/engine/figures`：prompt + 可选 sketch → 独立 `.drawio`）
- `/api/engine/projects/:id/annotations`：框选定点编辑
- `/api/engine/projects/:id/export`：矢量 PDF / PPTX / 源文件导出
- `/api/generate`：多格式生成
- `/api/summarize`：摘要
- `/api/enrich`：RAG 增强（legacy opt-in，默认 410）
- `/api/quality`：质量分析
- `/api/visual-qa`：视觉质量评估

---

## 设计决策

### 为什么源文件必须是纯文本（slides.md / LaTeX），而不是直接产 PPTX 二进制？

**问题**：产物是 PPTX/PDF 二进制时，「改一处」只能整篇重新生成，用户的其余改动会被冲掉。

**决策**：Source of Truth 永远是文本源——演示文稿是 Slidev `slides.md`，PDF 项目是带
`\aoNode` 标记的 LaTeX `main.tex`。LLM 能可靠操作的单位是文本 diff：可外科手术、可 diff、
可撤销、可测试；二进制不具备其中任何一条。

**不可妥协**：编辑必须表达为对文本源的定点补丁，不得以「整篇重生成」代替。

### 为什么预览与导出必须同源？

**问题**：预览一套实现、导出另一套实现，两者永远在漂移，"所见非所得"是必然结果。

**决策**：一致性靠单一实现，而不是靠对齐两套实现。演示文稿线的导出就是把预览那份 HTML 交给
Chromium 矢量打印（分步动画位图版与 PPTX 也捕自同一份 HTML）；LaTeX 项目的预览本身就是
xelatex 编译产物，预览=导出天然成立。

**不可妥协**：不得为导出另写一套渲染路径。

### 为什么用纯 Node.js 而不是 Python？

**问题**：Python 有成熟的文档生成库，但增加了依赖复杂度。

**决策**：主管线纯 Node——PptxGenJS（PPT）、docx（Word）、Playwright（PDF/HTML），aoide 引擎
以 TypeScript 直出 LaTeX / Slidev 源。诚实边界：报告线 `latex`/`latex-pdf` 的模板助手目前
仍是 Python 脚本（`tools/latexgen/build_latex.py`），编译依赖系统 xelatex，收敛到 TS 已列入
roadmap。

**不可妥协**：不得为新能力引入新的 Python 依赖；既存 Python 助手只减不增。

### 为什么需要去 AI 化？

**问题**：LLM 生成的文本有明显的"AI 腔调"（如"首先...其次...最后..."）。

**决策**：规则化去除 AI 腔调（本地确定性规则，不经 LLM），使输出更自然。

**不可妥协**：报告管线（generate/batch）输出必须经过去 AI 化处理；aoide 引擎线以 grounding
数据溯源 + 框选定点修正承担质量闭环，不强制走 deai 规则。

### 为什么科研图是并列 `.drawio` 轨，而不是替换 Slidev、也不是生图？

**问题**：科研插图需要可编辑的具名对象（面板、形状、连线），不是幻灯正文，也不是一张不可拆的位图。
若把图写进 `slides.md` 或另开文生图，要么冲掉文稿 SoT，要么交出不可审计、不可定点改的像素。

**决策**：文稿 SoT 仍是 Slidev `slides.md`；科研图 SoT 是并列的独立 `.drawio`（mxGraph 原生对象）。
入口 `POST /api/engine/figures`（`:3900`，PolarProcess `autooffice`）：Designer 用 PolarPrivate
**V0000** 理解文字与可选草图 → Drawer 写未压缩 mxfile（1600×900）→ Audit。草图只进 VLM，不整贴。
预览若有，只来自 draw.io Desktop CLI 导出，本切片不强制 `previewPath`。不做 PPT/WPS live，不新开 Python。

**不可妥协**：禁止 DALL·E / Flux / Midjourney / AutoFigure 生图；禁止把整张草图贴上画布
（`whole-sketch-raster` hard fail）。不得用科研图轨替换 Slidev 文稿 SoT。

---

## 详情入口

- [SSoT 地图](docs/ssot.md)
- [SSoT 进度](polaris.json)
- [使用指南](README.md)
- [进度视图](docs/planning/roadmap.md)
