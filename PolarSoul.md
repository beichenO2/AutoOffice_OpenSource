# AutoOffice 灵魂

> 多格式自动化报告生成平台。Agent 修改本项目前，必须阅读并遵守以下核心特质。

---

## 核心特质

| 特质 | 与社区同类项目的差异 |
|------|----------------------|
| **多格式统一** | 同一 JSON 数据可生成 PPT/PDF/Word/LaTeX/HTML 五种格式，无 Python 依赖 |
| **去 AI 化处理** | 规则化去除生成文本中的 AI 腔调，使输出更自然 |
| **VLM 视觉质量评估** | 使用本地 VLM（Ollama qwen3-vl）评估文档排版质量，5 维度评分 |
| **模板画廊** | 支持用户自定义模板，持久化到 ~/.autooffice/templates/ |

---

## 运行时权威

- PolarProcess 服务 `autooffice` 是 API 唯一进程生命周期权威。
- PolarPort 是 `3900` 的唯一端口分配与归属权威。
- `Start/start.sh` 是由 PolarProcess 执行的前台命令；禁止后台 `&`、`nohup`、
  PID 文件、直接信号或第二个进程管理器。
- `autooffice-auto-evolve` 与 `autooffice-sota-radar` 是独立 cron，API 生命周期
  操作不得修改或触发它们。

## 外部合作

### 依赖

- [PolarPrivate](../PolarPrivate/PolarSoul.md)：AI PPT 生成代理
- [KnowLever](../KnowLever/PolarSoul.md)：RAG 增强

### 被依赖

- [PolarClaw](../PolarClaw/PolarSoul.md)：报告生成技能
- [KnowLever](../KnowLever/PolarSoul.md)：PDF 导出

### 接口契约

- `/api/generate`：多格式生成
- `/api/summarize`：摘要
- `/api/enrich`：RAG 增强
- `/api/quality`：质量分析
- `/api/visual-qa`：视觉质量评估

---

## 设计决策

### 为什么用纯 Node.js 而不是 Python？

**问题**：Python 有成熟的文档生成库，但增加了依赖复杂度。

**决策**：使用 PptxGenJS（PPT）、docx（Word）、Playwright（PDF）等 Node.js 库，无 Python 依赖。

**不可妥协**：生成管线必须纯 Node.js，不得引入 Python 依赖。

### 为什么需要去 AI 化？

**问题**：LLM 生成的文本有明显的"AI 腔调"（如"首先...其次...最后..."）。

**决策**：规则化去除 AI 腔调，使输出更自然。

**不可妥协**：生成文本必须经过去 AI 化处理。

---

## 详情入口

- [SSoT](polaris.json)
- [使用指南](README.md)
