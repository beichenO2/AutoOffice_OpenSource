# AutoOffice 测试方法论

## 测试架构

三层测试矩阵，适用于任何产物型项目：

### 1. 功能测试（Functionality）

- **全格式全主题覆盖**：每种格式 × 每个主题组合都必须通过验证器和管线
- **管线端到端**：从 JSON 输入到最终产物（HTML/PPTX buffer/DOCX buffer 等）
- **自动 payload 转换**：通用格式到专用格式的 autoConvertPayload 覆盖
- **文本质量管线**：de-AI + monotony + diversity 三个分析器独立 + 联合

关键经验：
- theme 白名单必须有 contract test 保障 schema ↔ code 一致性
- 格式别名（ppt→pptx, tex→latex）需要单独测试
- HTML 模板渲染是 PDF 生成的前置步骤，必须独立测试 `buildPdfHtml`

### 2. 压力测试（Stress）

- **大 payload**：50 章节 × 2000 字/章，验证不崩溃且 HTML 输出完整
- **高并发**：100 并发验证，确保无竞态
- **边界值**：恰好在限制值上（120 字标题）和超过限制值（121 字、7 条 bullets）
- **大表格**：20 列 × 100 行的 DOCX 表格
- **大参考文献**：50 条 bibliography 的 LaTeX

关键经验：
- 验证器本身是纯函数，并发安全
- HTML builder 是内存密集操作，50 章节 PDF 生成 >10KB HTML
- 边界值测试必须覆盖"恰好合法"和"刚好违规"两个方向

### 3. 攻击测试（Security）

- **XSS**：6 种常见向量（script 标签、img onerror、svg onload、javascript: URL、Handlebars 模板注入）
- **LaTeX 注入**：`\input`、`\include`、`\write18`、`\openout` 等危险命令
- **畸形输入**：null/undefined/number 类型的字段、空字符串 theme、超长 body
- **Unicode 边界**：emoji、CJK+RTL 混排、零宽字符
- **原型污染**：`__proto__` 注入

关键经验：
- `esc()` 函数只转义 `<>&"` 四种字符，对于 PDF 场景足够（内容最终由 Playwright 渲染为 PDF，不直接暴露给浏览器）
- 但如果 HTML 直接输出给用户浏览器，需要用 DOMPurify 做更完整的清洗
- LaTeX 验证器的危险命令检测覆盖了主要攻击向量
- 类型安全 bug 容易被忽视：`title?.trim()` 对 number 类型会抛 TypeError

### 4. 契约测试（Contract）

- **Schema 校验**：每种格式的 example payload 必须通过 JSON Schema 验证
- **运行时验证器校验**：example payload 必须通过 TypeScript 验证器
- **Theme 一致性**：schema enum 与代码常量必须精确匹配
- **目录完整性**：所有 schema 文件、example 文件和 README 必须存在

## 发现的 Bug 类型

| 类型 | 示例 | 修复方式 |
|------|------|----------|
| 类型安全缺口 | `title?.trim()` 对非字符串崩溃 | 先 typeof 检查再调用方法 |
| XSS 误报 | 转义后的文本包含事件处理器字符串 | 区分"HTML 属性"和"文本内容" |
| Theme 漂移 | schema 和代码常量不同步 | contract test 自动检查一致性 |

## 测试运行命令

```bash
# 完整测试
npx vitest run

# 只跑契约测试
npx vitest run tests/contracts/

# 只跑大测试（功能+压力+攻击）
npx vitest run tests/big-test.test.ts

# 带覆盖率
npx vitest run --coverage
```
