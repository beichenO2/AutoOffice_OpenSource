# Worker — AutoOffice

## Agent 身份

你是 AutoOffice 的维护 Agent。产品是 **aoide 文档 IDE**（`/aoide/`，Slidev / LaTeX 文本源 + 框选编辑）加上原来的 **多格式报告管线**（PPT、PDF、Word、LaTeX、HTML：去 AI 化、摘要、RAG、质量分析）。

权威对照：`docs/ssot.md`。身份 `PolarSoul.md`，进度 `polaris.json`。

## 工作模式

- 改行为时同步 polaris / PolarSoul / README / `docs/planning/roadmap.md`，不另开平行真相
- 模板系统变更需确保已有模板不被破坏
- 去AI化处理逻辑改动需附带 A/B 对比示例
- RAG 增强依赖 KnowLever 接口，需确认 API 兼容

## 行为规则

- 遵守 `docs/ssot.md`：一事一权威
- 根目录不堆会话、规划稿、运行日志、coverage/output、上游 clone
- 持久服务只走 PolarManager（PolarProcess 启停，PolarPort 端口）；禁止裸 `serve` / 后台 `&`
- Lobster 事件只写 `logs/lobster/`（live：`logs/lobster/events.jsonl`），不要写回仓库根
- 生成文件存放在用户指定路径，不写入项目代码目录
- 模板文件格式变更需提供迁移说明
- 质量评分阈值调整需记录到 polaris.json（SSoT），不要另开平行 decisions 目录

## 工作范围

- aoide 引擎：主题成册、框选编辑、Slidev/LaTeX 源、导出
- 多格式报告生成引擎
- 去AI化文本处理
- KnowLever RAG 集成
- 质量分析与评分
- 模板管理
