# AutoOffice docs

权威对照见 [ssot.md](ssot.md)。根目录只留身份/进度/入口；规划、会话、参考材料进本目录。

| Path | What |
|------|------|
| [ssot.md](ssot.md) | SSoT 地图：一事一权威 |
| [planning/roadmap.md](planning/roadmap.md) | 产品进度摘要（事实源 polaris.json） |
| [planning/MASTER-PLAN.md](planning/MASTER-PLAN.md) | 历史多项目总计划（不改写） |
| [planning/BROADCAST-PROMPT.md](planning/BROADCAST-PROMPT.md) | 历史 GSD broadcast prompts |
| [agent/worker.md](agent/worker.md) | 维护 Agent 工作备忘 |
| [sessions/](sessions/) | 会话交接日志（历史） |
| [testing/methodology.md](testing/methodology.md) | 测试方法论 |
| [reference/](reference/) | 外部参考材料（KnowLever） |
| [ai-ide/STATE.md](ai-ide/STATE.md) | IDE 引擎状态笔记 |
| [demos/](demos/) | Demo decks 与 gate 场景 |
| [superpowers/](superpowers/) | Superpowers specs / plans |

## 仓库其它入口（不在 docs/ 下）

| Path | What |
|------|------|
| [../AGENTS.md](../AGENTS.md) | 本仓 build / test / Start |
| [../PolarSoul.md](../PolarSoul.md) | 身份与不可妥协特质 |
| [../polaris.json](../polaris.json) | 进度与 feature 真源 |
| [../README.md](../README.md) | 产品叙事 |
| [../deploy/](../deploy/) | Presenton 可选 sidecar（不入库上游） |
| [../integrations/](../integrations/) | 第三方 wrap（如 scientific-illustrator MCP） |
| [../vendor/scientific-illustrator](../vendor/scientific-illustrator) | scientific-illustrator pin（submodule） |
| [../_design/](../_design/) | 布局/交互决策（composer-superpower） |
| [../_report/](../_report/) | 交付证据（PDF 等） |
| [../Start/](../Start/) | PolarProcess 前台启动 |

## 根目录约定

保留：`src/` `tests/` `public/` `electron/` `contracts/` `tools/` `scripts/` `PolarSkills/` `Start/` `deploy/` `integrations/` `vendor/` `docs/` `_design/` `_report/` `reports/` 与根配置。

不要往根上堆：规划/会话 md、运行日志、coverage/output、Presenton 上游 clone。Lobster 事件只写 `logs/lobster/`（gitignore）。
