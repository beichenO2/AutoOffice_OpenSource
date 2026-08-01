# AutoOffice — 生成质量门禁：测试情景与测试要求

按「方向 × 侧重」组织。每个情景**只强调一类要求**（不是同一份 PPT 同时满足全部）。输入分三档：`topic`（主题）、`outline`（大纲，结构须遵循）、`guidance`（权威资料/数据，须严谨忠实、不得杜撰）、`images`（选好的插图，定点插入）。

生成入口（应用）：`AUTOOFFICE_LLM_EDIT=1 autooffice generate-deck --topic … [--outline f] [--guidance f] [--image N:src] [--formulas] --out dir [--export pptx]`。

## 通用验收（每个情景都要过）
- G1 数据严谨：所有具体数字/时间/比例/结论都能在 `guidance/research` 中找到出处；无出处不编造具体数字。
- G2 结构完整：封面 + 内容页；页数与 `outline`（若给）一致；标题层级正确、无空页。
- G3 可编辑：每个文本/公式/插图节点带稳定 `data-ao-id`，可在 /aoide/ 框选修改；boxmap 有盒。
- G4 渲染：预览与导出（PDF/PPTX）无缺字、无溢出裁切；`npm run build` + 全量 vitest 全绿。

## 门禁情景矩阵

| # | 方向 | 侧重 | 主题 | 关键测试要求（除通用外） |
|---|---|---|---|---|
| S1 | AI | 图文/排版 | Transformer 架构综述 | 图文混排：每内容页含 1 张示意插图（`--image`）+ 要点；标题+插图+要点三层次清晰、插图不压字 |
| S2 | AI | 文字多 | 2026 大模型安全与对齐进展 | 高信息密度：≥6 页、每页 4~6 条要点，长要点不溢出、分点可读；术语统一 |
| S3 | 数学 | 公式多 | 梯度下降与反向传播 | 每内容页 ≥1 个 LaTeX 公式，渲染为 MathML（如 `w_{t+1}=w_t-\eta\nabla L`、链式法则）；公式与符号定义一致 |
| S4 | 数学 | 复杂公式 | 傅里叶变换与卷积定理 | 复杂公式正确渲染（积分/求和/上下标：`\int_{-\infty}^{\infty} f(t)e^{-i\omega t}dt`）；不溢出 |
| S5 | 医学 | 文字详实 | GLP-1 类药物药理与临床证据 | 详细准确介绍（机制/适应证/证据）；关键试验数据（如 OASIS-4 减重 16.6~17%）忠于 guidance；含少量公式（如 BMI、剂量换算） |
| S6 | 医学 | 公式/模型 | 一室药代动力学模型 | 药代公式渲染：`C(t)=\frac{D}{V}e^{-k_e t}`、半衰期 `t_{1/2}=\frac{\ln 2}{k_e}`；符号定义齐全 |
| S7 | 通用 | 动画多 | 产品发布逐步揭示 | 分步揭示/过渡要求（Slidev fragments/transition）；见下「动画」说明 |

## 各情景验收细则（要点）
- **S1 图文/排版**：`--image 2:<url> --image 3:<url>`；验收：插图落到指定页、`data-ao-type=image` 可框选换图；文字不被图遮挡。
- **S2 文字多**：`--outline`（6~7 页）；验收：每页 4~6 要点、无一句话空页；长句自动换行不裁切（截图核对）。
- **S3 / S4 公式多**：`--formulas`；验收：`slides.md` 含 `data-ao-type="formula"` + `<math>`；Chromium 截图中公式为排版数学（分式/积分/上下标正确），非纯文本；公式节点可框选。
- **S5 医学文字**：`--guidance`（含试验数据）；验收：数字与 guidance 完全一致（逐条核对）；介绍准确详细、无夸大/杜撰。
- **S6 医学公式**：`--formulas --guidance`；验收：药代公式正确、符号（D/V/k_e/t_{1/2}）在页面有定义。
- **S7 动画**：当前预览为自包含静态 HTML（沙箱 iframe 禁脚本），**逐步揭示/过渡动画为已知缺口**；验收标准（待实现）：Slidev `v-click`/`transition` 语义 + 导出保留分步；**本轮标注为 NEXT，不阻断其余门禁**。

## 本轮已执行门禁
- S3（数学·公式）、S5（医学·文字+公式）、S1/S2（AI）经 `--formulas`/`--guidance`/`--image` 真机真 GLM 生成并逐页截图亲看，公式渲染为 MathML、数据忠于 guidance、插图定点落位；见 `docs/demos/gate-scenarios/`。
- S7 动画：标注为下一步（需给自包含预览加 fragment/transition 支持 + 导出适配）。
