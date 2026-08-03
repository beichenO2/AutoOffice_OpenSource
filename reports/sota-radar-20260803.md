# AutoOffice SOTA 雷达 — 2026-08-03

> 数据源：digist 采集库（近 14 天）· 指纹词 15 + 视野词 6 · 去重命中 47 条
> 结晶分 = 直指在用组件(3/1) + 需求覆盖(≤2) + 可落地性(≤2) + 新颖度(±1)，逐条给出理由。
> 本报告只做情报聚合，不自动改动任何代码或依赖；升级需人工评审后执行。

## 关键技术结晶（Top 5）

1. **[Show HN: Collaborative Docx Editor with MS Word Parity](https://news.ycombinator.com/item?id=49128186)** · hackernews · 2026-07-31
   - 结晶分 **7** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

2. **[Show HN: DocSlicer – Structure-aware PDF/DOCX/PPTX parser, 31 pages/sec on CPU](https://news.ycombinator.com/item?id=49086175)** · hackernews · 2026-07-28
   - 结晶分 **7** — 直指核心组件 docx/pptxgenjs；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

3. **[Show HN: Word in Web – Near MS Word Parity Docx Editor in Web](https://news.ycombinator.com/item?id=48995304)** · hackernews · 2026-07-21
   - 结晶分 **5** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）；往期已收录
   - 影响需求：R1

4. **[Xberg 1.0 released: document extraction for a world of tooling](https://news.ycombinator.com/item?id=49101494)** · hackernews · 2026-07-29
   - 结晶分 **5** — 关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

5. **[Show HN: A search engine for one-word .com domains](https://news.ycombinator.com/item?id=49085975)** · hackernews · 2026-07-28
   - 结晶分 **5** — 关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

## 评审（基于当前实现事实）

1. **采纳评估** — 直接替换/增强核心组件 `docx@^9.7.1`，满足服务需求 R1 的协作编辑能力；风险：需验证其 MS Word 兼容性是否与现有 `docx` 库输出一致，可能引入额外依赖冲突。

2. **采纳评估** — 增强核心组件 `docx@^9.7.1` 和 `pptxgenjs@^4.0.1` 的解析能力，满足服务需求 R1 的结构化解析需求；风险：31 pages/sec 性能在 CPU 上可能受限于 AutoOffice 的 Docker 环境资源。

3. **继续观察** — 往期已收录且结晶分 5，与条目 1 功能重叠但成熟度较低；风险：重复评估可能浪费资源，需等待条目 1 评估结果。

4. **继续观察** — 关联需求 R1 但未明确替换/增强 `docx` 或 `pptxgenjs`，且结晶分 5 低于前两条；风险：功能边界模糊，可能无法直接集成到现有 `docx@^9.7.1` 工作流。

5. **忽略** — 域名搜索引擎，与 AutoOffice 的 `docx`/`pptxgenjs`/`mermaid` 等核心组件及所有服务需求（R1-R6）无直接关联；风险：完全偏离技术栈，无集成价值。

**本期是否存在值得立项评估的关键技术？** 是，条目 1 和 2 分别针对协作编辑与结构解析，直接增强 `docx@^9.7.1` 和 `pptxgenjs@^4.0.1`，满足需求 R1，值得立项评估。

## 全部命中（按结晶分）

- [7] [Show HN: Collaborative Docx Editor with MS Word Parity](https://news.ycombinator.com/item?id=49128186) · hackernews · 2026-07-31 · 来源词: docx, word document
- [7] [Show HN: DocSlicer – Structure-aware PDF/DOCX/PPTX parser, 31 pages/sec on CPU](https://news.ycombinator.com/item?id=49086175) · hackernews · 2026-07-28 · 来源词: docx, pptx
- [5] [Show HN: Word in Web – Near MS Word Parity Docx Editor in Web](https://news.ycombinator.com/item?id=48995304) · hackernews · 2026-07-21 · 来源词: docx
- [5] [Xberg 1.0 released: document extraction for a world of tooling](https://news.ycombinator.com/item?id=49101494) · hackernews · 2026-07-29 · 来源词: word document
- [5] [Show HN: A search engine for one-word .com domains](https://news.ycombinator.com/item?id=49085975) · hackernews · 2026-07-28 · 来源词: word document
- [5] [Show HN: Slaide, open-source Markdown slides AI writes and PowerPoint opens](https://news.ycombinator.com/item?id=49120039) · hackernews · 2026-07-31 · 来源词: pptx
- [4] [Robust Interpretation of Historical Documents in Knowledge Graphs Through Query Inference and Execution](http://arxiv.org/abs/2607.24475v1) · arxiv · 2026-07-27 · 来源词: word document
- [4] [Get-md now preserves Mermaid diagrams through document-to-Markdown conversion](https://news.ycombinator.com/item?id=49123035) · hackernews · 2026-07-31 · 来源词: mermaid diagram
- [4] [What Does It Take to Detect an AI Agent? Minimal Feature Sets for Behavioral Detection under Browser Automation](http://arxiv.org/abs/2607.26935v1) · arxiv · 2026-07-29 · 来源词: playwright pdf
- [4] [The physics of Docker build caching](https://news.ycombinator.com/item?id=49123372) · hackernews · 2026-07-31 · 来源词: docker
- [4] [I built a Docker image factory in Go – 300 lines, no daemon, full OCI compliance](https://news.ycombinator.com/item?id=49106026) · hackernews · 2026-07-30 · 来源词: docker
- [4] [PSA: llama.cpp now loads MTP tensors by default for any draft-mtp arch, even with MTP disabled](https://www.reddit.com/r/LocalLLaMA/comments/1va54em/psa_llamacpp_now_loads_mtp_tensors_by_default_for/) · reddit · 2026-07-29 · 来源词: llama.cpp
- [4] [Update your chat template for dsv4 if you're using llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1v8oalz/update_your_chat_template_for_dsv4_if_youre_using/) · reddit · 2026-07-28 · 来源词: llama.cpp
- [4] [Kimi K3 text-only for llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1v87v71/kimi_k3_textonly_for_llamacpp/) · reddit · 2026-07-27 · 来源词: llama.cpp
- [4] [GVR-Coder: A Visual-Feedback Framework for Structured SVG Generation in Complex Document and Meeting Scenarios](http://arxiv.org/abs/2607.28073v1) · arxiv · 2026-07-30 · 来源词: document generation
- [4] [Show HN: We built an MCP server for document generation](https://news.ycombinator.com/item?id=49066700) · hackernews · 2026-07-27 · 来源词: document generation
- [4] [GraphQAG: A Knowledge-Graph-Guided Visual Analytics Framework for Question-Answer Pairs Generation](http://arxiv.org/abs/2607.27182v1) · arxiv · 2026-07-29 · 来源词: document generation
- [3] [Document-borne AI worms can self-propagate through Copilot for Word](https://news.ycombinator.com/item?id=49096188) · hackernews · 2026-07-29 · 来源词: word document
- [3] [Leaked Document Names Mainstream Journalists Taking Pay-for-Play Trips to China](https://news.ycombinator.com/item?id=49135496) · hackernews · 2026-08-01 · 来源词: word document
- [3] [Word worm crawls into Copilot, spreads chaos](https://news.ycombinator.com/item?id=49103078) · hackernews · 2026-07-29 · 来源词: word document
- [3] [Mathend – Microsoft Word but less annoying](https://news.ycombinator.com/item?id=49080307) · hackernews · 2026-07-28 · 来源词: word document
- [3] [ERUnderstand: Evaluating Vision-Language Models on Structured ER Diagrams](http://arxiv.org/abs/2607.24707v1) · arxiv · 2026-07-27 · 来源词: mermaid diagram
- [3] [Pdf-inspector: Rust lib for PDF inspection, classification, and text extraction](https://news.ycombinator.com/item?id=49143467) · hackernews · 2026-08-02 · 来源词: playwright pdf
- [3] [A slide deck you can edit with a local model or in Chrome — the whole deck is a JSON block in one HTML file (~640KB with editor and viewer included)](https://www.reddit.com/r/LocalLLaMA/comments/1v9vewv/a_slide_deck_you_can_edit_with_a_local_model_or/) · reddit · 2026-07-29 · 来源词: pptx, slide generation
- [3] [Show HN: Rudoc – a 4.5MB Rust document converter](https://news.ycombinator.com/item?id=49052181) · hackernews · 2026-07-25 · 来源词: pptx, typst, pandoc
- [3] [Show HN: Bento - An entire PowerPoint in one HTML file (edit+view+data+collab)](https://news.ycombinator.com/item?id=49008211) · hackernews · 2026-07-22 · 来源词: pptx
- [3] [PathSelect: Sequential Token Selection for Whole Slide Pathology](http://arxiv.org/abs/2607.23631v1) · arxiv · 2026-07-26 · 来源词: slide generation
- [3] [Foundation Models for Face Presentation Attack Detection: A Unified Linear-Probing Benchmark](http://arxiv.org/abs/2607.26993v1) · arxiv · 2026-07-29 · 来源词: presentation AI
- [3] [Addressable Recall Compaction for Long Context-Window Control in AI Agents](http://arxiv.org/abs/2607.25066v1) · arxiv · 2026-07-27 · 来源词: presentation AI
- [3] [DeCoRAG: Cognitive Decoupling and Semantic-Aware Cropping for Complex Document Understanding](http://arxiv.org/abs/2607.24554v1) · arxiv · 2026-07-27 · 来源词: document generation
- [2] [Show HN: A browser-based video editor that renders videos directly with FFmpeg](https://news.ycombinator.com/item?id=49058396) · hackernews · 2026-07-26 · 来源词: svg render
- [2] [PNG to SVG](https://news.ycombinator.com/item?id=49124840) · hackernews · 2026-07-31 · 来源词: svg render
- [2] [lij768423-svg/grok-register-panel](https://github.com/lij768423-svg/grok-register-panel) · github · 2026-07-30 · 来源词: svg render
- [2] [SVG Sketch Source](https://news.ycombinator.com/item?id=49075614) · hackernews · 2026-07-27 · 来源词: svg render
- [2] [Show HN: Convert GLB, OBJ, and STL Models to SVG In-Browser](https://news.ycombinator.com/item?id=49023682) · hackernews · 2026-07-23 · 来源词: svg render
- [2] [Agentic Mermaid](https://news.ycombinator.com/item?id=49147449) · hackernews · 2026-08-02 · 来源词: mermaid diagram
- [2] [Show HN: DataParade – generate dataflow diagrams from code for risk assessments](https://news.ycombinator.com/item?id=49007529) · hackernews · 2026-07-22 · 来源词: mermaid diagram
- [2] [Typistify: A cross-platform, offline-first Typst editor](https://news.ycombinator.com/item?id=49127765) · hackernews · 2026-07-31 · 来源词: typst
- [2] [What is distributed Key Generation (DKG)?](https://news.ycombinator.com/item?id=49134756) · hackernews · 2026-08-01 · 来源词: slide generation
- [2] [The next generation of speculative decoding: DFlash and Spec V2](https://news.ycombinator.com/item?id=49116159) · hackernews · 2026-07-30 · 来源词: slide generation
- [2] [The new rules of context engineering for Claude 5 generation models](https://news.ycombinator.com/item?id=49051361) · hackernews · 2026-07-25 · 来源词: slide generation
- [2] [Codex Slides: open-source AI slide studio powered by Codex. Prompt, repo to deck](https://news.ycombinator.com/item?id=49031776) · hackernews · 2026-07-24 · 来源词: slide generation
- [2] [Substackers Say New AI Detection Tool Is a 'Witch Hunt'](https://news.ycombinator.com/item?id=49098357) · hackernews · 2026-07-29 · 来源词: AI text detection
- [1] [Pathologist Attention-Aligned Report Generation for Prostate Histopathology](http://arxiv.org/abs/2607.19624v1) · arxiv · 2026-07-21 · 来源词: slide generation
- [1] [Beyond Relevance-Centric Retrieval: Rubric-Oriented Document Set Selection and Ranking](http://arxiv.org/abs/2607.19747v2) · arxiv · 2026-07-22 · 来源词: document generation
- [1] [Beyond Relevance-Centric Retrieval: Rubric-Oriented Document Set Selection and Ranking](http://arxiv.org/abs/2607.19747v1) · arxiv · 2026-07-22 · 来源词: document generation
- [0] [Tesla misses on earnings, as free cash flow turns negative and margins slide](https://www.cnbc.com/2026/07/22/tesla-tsla-q2-2026-earnings-report.html) · bloomberg · 2026-07-22 · 来源词: slide generation

## 检索统计

- resvg: 0 条
- svg render: 5 条
- @slidev/cli: 0 条
- @slidev/theme-default: 0 条
- docx: 3 条
- word document: 8 条
- mermaid diagram: 4 条
- playwright pdf: 2 条
- playwright-chromium: 0 条
- pptx: 5 条
- presenton: 0 条
- docker: 2 条
- llama.cpp: 3 条
- polarprivate: 0 条
- ollama: 0 条
- typst: 2 条
- slide generation: 8 条
- presentation AI: 2 条
- document generation: 6 条
- AI text detection: 1 条
- pandoc: 1 条
