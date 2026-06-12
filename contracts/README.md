# AutoOffice 产物契约

本目录定义 AutoOffice 所有输出格式的结构化 payload 契约，供上下游项目对接使用。

## 目录结构

```
contracts/
├── pdf.schema.json          # PDF 报告 payload JSON Schema
├── pptx.schema.json         # PPT 演示文稿 payload JSON Schema
├── docx.schema.json         # Word 文档 payload JSON Schema
├── latex.schema.json        # LaTeX 文档 payload JSON Schema
├── html.schema.json         # HTML 报告 payload JSON Schema（通用型）
├── examples/                # 示例 payload
│   ├── pdf.example.json
│   ├── pdf-study-review.example.json
│   ├── pptx.example.json
│   ├── docx.example.json
│   ├── latex.example.json
│   └── html.example.json
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

## 变更历史

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-05-01 | 初始契约建立：5 格式 schema + 6 examples + study-review 支持 | solo-web-b78236eb |
