# AutoOffice Roadmap

> 进度视图：当前阶段、完成情况、下一步。事实源是 `polaris.json`，本文件只做进度摘要。

## 当前状态

| 维度 | 状态 |
| --- | --- |
| 版本 | 1.0.0（`polaris.json` / `package.json` / `AUTOOFFICE_VERSION` 已同步） |
| 项目状态 | active |
| 项目重心 | AI 文档 IDE（aoide 引擎）；JSON→五格式报告管线作为稳定第二条线保留 |

## Requirement 完成情况

| ID | 名称 | 完成度 | 说明 |
| --- | --- | --- | --- |
| R1 | 多格式报告生成（JSON→PPT/PDF/Word/LaTeX/HTML） | 100% | 全部 done |
| R2 | 内容处理：摘要、RAG 增强、质量分析 | 100% | 全部 done |
| R3 | 图表渲染与文档嵌入 | 100% | 全部 done |
| R4 | HTTP API 服务与外部工具集成 | 100% | 全部 done |
| R5 | AI 驱动 PPT 生成（Presenton 集成） | 100% | 全部 done |
| R6 | VLM 视觉质量评估 | 100% | 全部 done |

## aoide 引擎（整线入库，尚未在 polaris.json 立 Requirement）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 主题一键生成整册 | 已入库 | `POST /api/engine/decks` + CLI `generate-deck`，走 PolarPrivate LLM 代理，无代理时确定性兜底 |
| 框选定点编辑 + 作用域路由 | 已入库 | `src/engine/skills.ts` 确定性分流；文本源补丁，版本历史非破坏可撤销 |
| 整册风格包（5 个） | 已入库 | tech / gov / business / academic / minimal，五个包都带版式级规则（CSS 覆写实现） |
| 矢量 WYSIWYG 导出 | 已入库 | 默认 PDF 为 Chromium 矢量打印预览 HTML；`?clicks=1` 位图分步；PPTX 位图满幅 |
| 数据严谨校验（grounding） | 已入库 | 百分比/小数/多位数回查 research/guidance（个位数/公式/图片豁免，字符串包含性核查） |
| Electron 桌面应用 | 已入库 | `npm run app` / `npm run app:dist`（产物在 `release/`） |

## 已知阻塞项

无。~~被 KnowLever R8 依赖：需实现 study-review PDF 模板渲染逻辑。~~ **已解除**：`study-review`
是 8 个已注册 PDF 主题之一（`src/pdf/types.ts` + `html-builder.ts` 学术绿·衬线主题），带契约
样例 `contracts/examples/pdf-study-review.example.json` + 3 项契约测试；2026-08-02 端到端渲染
实证通过（KnowLever 自动生成的「深度学习优化方法文献综述」→ 201KB 真 PDF、452 可选字符）。

## 下一步（1.0 后展望）

1. 为 aoide 引擎在 `polaris.json` 立正式 Requirement（能力已入库，SSoT 尚未建档）。
2. 风格包版式模板化：五个包的版式差异目前全部由 `DECK_STYLE_PACKS` 的 CSS 选择器覆写实现，
   gov / business 的覆写链最长最脆；考虑在生成器层引入真正的版式模板而非层层覆写。
3. 手动插图进入两栏布局的 renderer 硬化：插入位置与文字列的碰撞边界补测试。
4. `rasterAspect` 覆盖面：目前只能从 `data:` URI 的 PNG/GIF/JPEG 头读出长宽比，
   http(s) 引用图一律回落到均分栏；补远程图尺寸探测后两栏分档才算准。
5. 导出路径保持收敛在矢量 WYSIWYG 主线（PR #1 演进线），不再新增第二套渲染实现。
6. 清理三个 Python 桥死代码（`src/pdf/run-weasyprint.ts`、`src/docx/run-python-docx.ts`、
   `src/ppt/run-python-pptx.ts`——仅 `src/index.ts` 导出、无调用方）。注意 `tools/latexgen/
   build_latex.py` 仍被报告线 LaTeX 适配器活跃调用（`src/latex/run-xelatex.ts:101`），不在
   清理范围；后续应将其收敛为 TS 直出（aoide 引擎线已是 TS 直出 .tex）。

## 更新记录

| 日期 | 更新内容 |
| --- | --- |
| 2026-04-29 | 初始创建：从 polaris.json 提取进度信息 |
| 2026-08-02 | 校正陈旧项：study-review PDF 模板早已实现，端到端渲染实证通过，KnowLever R8 阻塞解除 |
| 2026-08-11 | 重心校准：aoide 引擎整线入库并列表化，版本推进到 1.0.0，下一步改为 1.0 后展望 |
