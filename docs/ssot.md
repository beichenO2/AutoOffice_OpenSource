# AutoOffice SSoT 地图

一事一权威。行为变了就一起改 `polaris.json` / `PolarSoul.md` / `README.md` / `docs/planning/roadmap.md`，不要另开平行真相。

| Concern | Authority | Path |
|---------|-----------|------|
| Identity | PolarSoul.md | 仓库根 |
| Progress / features | polaris.json | 仓库根 |
| Agent commands | AGENTS.md | 仓库根 |
| Product narrative | README.md | 仓库根 |
| Roadmap summary | docs/planning/roadmap.md | 事实来自 polaris |
| Master plan (historical) | docs/planning/MASTER-PLAN.md | 历史，不改写 |
| Layout decisions | `_design/<topic>/` | composer-superpower |
| Delivery evidence | `_report/` | |
| Runtime | `Start/` + polaris.json `service_management` | PolarManager |
| Lobster events | `logs/lobster/events.jsonl` | gitignored（`/logs/`） |
| Presenton opt-in | `deploy/` + `PRESENTON_URL` | 不入库；需时按 `deploy/README.md` clone |

## 写法

- 进度数字与 feature 状态只认 `polaris.json`；roadmap 只做摘要。
- 根目录不堆会话、规划稿、运行日志、上游 clone。规划进 `docs/`，证据进 `_report/`，交互进 `_design/`。
- Slidev 密文：换行 + `paginateDeckSpec` 分主题/行预算分页，不用省略号截断顶替排版。
