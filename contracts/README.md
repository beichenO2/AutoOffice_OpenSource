# AutoOffice 产物契约

本目录定义 AutoOffice 所有输出格式的结构化 payload 契约，供上下游项目对接使用。科研图轨另见 `figure.schema.json`（文字 + 可选手绘草图 → 具名 draw.io 对象；禁止生图、禁止整张草图贴画布）。

## 目录结构

```
contracts/
├── pdf.schema.json          # PDF 报告 payload JSON Schema
├── pptx.schema.json         # PPT 演示文稿 payload JSON Schema
├── docx.schema.json         # Word 文档 payload JSON Schema
├── latex.schema.json        # LaTeX 文档 payload JSON Schema
├── html.schema.json         # HTML 报告 payload JSON Schema（通用型）
├── figure.schema.json       # 科研图轨 FigureRequest / DesignSpec（draw.io 1600×900）
├── examples/                # 示例 payload
│   ├── pdf.example.json
│   ├── pdf-study-review.example.json
│   ├── pptx.example.json
│   ├── docx.example.json
│   ├── latex.example.json
│   ├── html.example.json
│   └── figure.example.json
└── README.md
```

## 使用方式

调用方在构造 payload 前，用 JSON Schema 校验输入：

```typescript
import Ajv from 'ajv';
import pdfSchema from './contracts/pdf.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(pdfSchema);
if (!validate(payload)) {
  console.error(validate.errors);
}
```

## 主题列表

| 格式  | 主题 ID |
|-------|---------|
| PDF   | academic, business, minimal, elegant, technical-report, news-digest, study-notes, study-review |
| PPTX  | academic, business, minimal, nord, tech, warm, slate |
| DOCX  | academic, business, minimal |
| LaTeX | article, report, beamer, cvpr, uestc-thesis |
| HTML  | 无固定主题，通过 Handlebars 模板控制 |

## 契约规则

1. **Schema 是唯一真相**：运行时 theme 白名单从 schema enum 派生或与之一致性验证。
2. **新增主题**：同时更新 schema enum、代码常量和 contract test。
3. **Example 完整性**：每种格式至少一个标准示例；特殊主题有专属示例。
4. **向后兼容**：schema 变更遵循 JSON Schema 兼容性原则，新增字段用 optional。

## 跨项目契约

| 契约 | 位置 | 说明 |
|------|------|------|
| **Paper-Deepread Ingest** | [KnowLever `PAPER_DEEPREAD_INGEST.md`](../../KnowLever/templates/site-wiki/PAPER_DEEPREAD_INGEST.md) | **多源** raw → transcript → manifest；PDF implemented，audio/video reserved |
| manifest schema | [KnowLever `schemas/paper-deepread-manifest.schema.json`](../../KnowLever/templates/site-wiki/schemas/paper-deepread-manifest.schema.json) | 逐句 SSoT JSON Schema |
| ingest state schema | [KnowLever `schemas/paper-deepread-ingest.schema.json`](../../KnowLever/templates/site-wiki/schemas/paper-deepread-ingest.schema.json) | 流水线状态 |

AutoOffice 在本契约中的职责：`to-markdown`（PDF→Markdown，公式乱码时 VLM OCR）；下游 `summarize` / `enrich` / `generate` 为可选。

## 变更历史

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-08-16 | 增加科研图轨 figure 契约（文字+草图 → 具名 draw.io 对象，禁止整张草图贴画布） | spec-tester |
| 2026-08-06 | 增加 Paper-Deepread Ingest 跨项目引用 | cursor-agent |
| 2026-05-01 | 初始契约建立：5 格式 schema + 6 examples + study-review 支持 | solo-web-b78236eb |
