# AutoOffice SOTA 雷达 — 2026-07-20

> 数据源：digist 采集库（近 14 天）· 指纹词 12 + 视野词 6 · 去重命中 51 条
> 结晶分 = 直指在用组件(3/1) + 需求覆盖(≤2) + 可落地性(≤2) + 新颖度(±1)，逐条给出理由。
> 本报告只做情报聚合，不自动改动任何代码或依赖；升级需人工评审后执行。

## 关键技术结晶（Top 5）

1. **[Show HN: DOM-docx – HTML to native, editable Word docs (MIT)](https://news.ycombinator.com/item?id=48891267)** · hackernews · 2026-07-13
   - 结晶分 **7** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

2. **[All2md: PDF, Docx, PPTX, HTML, Email and 40 More to Markdown – Python+CLI+MCP](https://news.ycombinator.com/item?id=48920847)** · hackernews · 2026-07-15
   - 结晶分 **7** — 直指核心组件 docx/pptxgenjs；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

3. **[Show HN: UniFi OS Server in Docker](https://news.ycombinator.com/item?id=48894665)** · hackernews · 2026-07-13
   - 结晶分 **6** — 直指外围组件 docker；关联需求 R5；可落地（发布/工具/版本）
   - 影响需求：R5

4. **[Unified CLI for running AI coding agents in isolated Docker or Podman containers](https://news.ycombinator.com/item?id=48894261)** · hackernews · 2026-07-13
   - 结晶分 **6** — 直指外围组件 docker；关联需求 R5；可落地（发布/工具/版本）
   - 影响需求：R5

5. **[Show HN: GGUFun, play snake and a simple maze on Ollama using hand crafted GGUFs](https://news.ycombinator.com/item?id=48889775)** · hackernews · 2026-07-13
   - 结晶分 **6** — 直指外围组件 ollama；关联需求 R6；可落地（发布/工具/版本）
   - 影响需求：R6

## 评审（基于当前实现事实）

**1. DOM-docx**
【继续观察】可增强 docx@^9.7.1（R1）的 HTML→Word 生成路径，提供原生可编辑 .docx 输出能力。风险：新项目 API 稳定性未经验证，复杂 Word 特性（样式/表格/分页）兼容性未知。

**2. All2md**
【忽略】转换方向相反（格式→Markdown），与 AutoOffice 输出格式生成（pptx/docx/pdf…）需求背离，且为 Python 生态，与当前 Node.js 栈不兼容。风险：引入 Python 依赖链破坏现有架构，对 R1 无增强价值。

**3. UniFi OS Server in Docker**
【忽略】UniFi OS 是网络/设备管理系统，与 AutoOffice 文档生成及 AI 服务无关，仅共用 docker@28.x 运行时。风险：零业务关联，引入徒增运维负担。

**4. Unified CLI for AI coding agents in Docker**
【忽略】专为 AI 编程代理设计隔离容器，与 R5 的文档处理/presenton/llama.cpp 服务部署场景不匹配，docker@28.x 已满足当前容器化需求。风险：抽象层错位，增加不必要的编排复杂度。

**5. GGUFun**
【忽略】纯娱乐演示（贪吃蛇/迷宫），无法增强 ollama@服务端映射（R6）的模型服务能力，与 OLLAMA_MODEL_L101 等 env 映射机制无关。风险：无生产价值，手工 GGUF 定制方式不适配服务端模型管理。

---

本期不存在值得立项评估的关键技术，唯一继续观察项 DOM-docx 需待其 API 稳定性与复杂文档兼容性验证后再议。

## 全部命中（按结晶分）

- [7] [Show HN: DOM-docx – HTML to native, editable Word docs (MIT)](https://news.ycombinator.com/item?id=48891267) · hackernews · 2026-07-13 · 来源词: docx
- [7] [All2md: PDF, Docx, PPTX, HTML, Email and 40 More to Markdown – Python+CLI+MCP](https://news.ycombinator.com/item?id=48920847) · hackernews · 2026-07-15 · 来源词: docx, pptx
- [6] [Show HN: UniFi OS Server in Docker](https://news.ycombinator.com/item?id=48894665) · hackernews · 2026-07-13 · 来源词: docker
- [6] [Unified CLI for running AI coding agents in isolated Docker or Podman containers](https://news.ycombinator.com/item?id=48894261) · hackernews · 2026-07-13 · 来源词: docker
- [6] [Show HN: GGUFun, play snake and a simple maze on Ollama using hand crafted GGUFs](https://news.ycombinator.com/item?id=48889775) · hackernews · 2026-07-13 · 来源词: ollama
- [5] [Show HN: Docx-CLI: agents read/edit Word docs using 1/2 the time and tokens](https://news.ycombinator.com/item?id=48821500) · hackernews · 2026-07-07 · 来源词: docx
- [5] [Show HN: My word game inspired by Wordle, Sudoku and crosswords](https://news.ycombinator.com/item?id=48968975) · hackernews · 2026-07-19 · 来源词: word document
- [5] [Show HN: Libretto PR agents – Automatically fix failing playwright scripts](https://news.ycombinator.com/item?id=48939710) · hackernews · 2026-07-16 · 来源词: playwright pdf
- [4] [Qwen 3.6 35B A3B Q8_0 &quot;Create an SVG of a Darth Vader.&quot; at various expert counts.](https://www.reddit.com/r/LocalLLaMA/comments/1uxyjw3/qwen_36_35b_a3b_q8_0_create_an_svg_of_a_darth/) · reddit · 2026-07-16 · 来源词: svg render
- [4] [MonkeyOCRv2: A Visual-Text Foundation Model for Document AI](http://arxiv.org/abs/2607.11562v1) · arxiv · 2026-07-13 · 来源词: word document, document generation, AI text detection
- [4] [Show HN: Free Mermaid Diagram Editor](https://news.ycombinator.com/item?id=48825430) · hackernews · 2026-07-07 · 来源词: mermaid diagram
- [4] [After 7 months of work, this is the architecture diagram for our market-regime engine. What would you remove?](https://www.reddit.com/r/algotrading/comments/1uxhwru/after_7_months_of_work_this_is_the_architecture/) · reddit · 2026-07-15 · 来源词: mermaid diagram
- [4] [Ternary Bonsai 1.58-bit models - ggml: add Q2_0 quantization support (CPU) by khosravipasha · Pull Request #24448 · ggml-org/llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1uqur7o/ternary_bonsai_158bit_models_ggml_add_q2_0/) · reddit · 2026-07-08 · 来源词: llama.cpp
- [4] [OpenLumara + Ollama: Local Agent Trying to Beat OpenClaw and Hermes](https://www.youtube.com/watch?v=gVKkyNznmxw) · youtube · 2026-07-14 · 来源词: ollama
- [4] [Show HN: Typst-WASM – Compile Typst in browsers, Node, and serverless runtimes](https://news.ycombinator.com/item?id=48947016) · hackernews · 2026-07-17 · 来源词: typst
- [4] [Show HN: LectureToBook – Turn Videos into a PDF/ePub](https://news.ycombinator.com/item?id=48965178) · hackernews · 2026-07-19 · 来源词: presentation AI
- [3] [Edit Markdown like editing a Word document](https://news.ycombinator.com/item?id=48802055) · hackernews · 2026-07-06 · 来源词: word document
- [3] [How Word Count Is Important for Social Media Posts](https://news.ycombinator.com/item?id=48964645) · hackernews · 2026-07-19 · 来源词: word document
- [3] [Is "jobs" a four-letter word?](https://news.ycombinator.com/item?id=48952465) · hackernews · 2026-07-17 · 来源词: word document
- [3] [The Word "Hide" Is Now a Legal Question](https://news.ycombinator.com/item?id=48948849) · hackernews · 2026-07-17 · 来源词: word document
- [3] [The Word "Emoji" Is Older Than You May Think](https://news.ycombinator.com/item?id=48944498) · hackernews · 2026-07-17 · 来源词: word document
- [3] [A Philosopher's One-Word Theory to Explain Why the World Feels So Weird](https://news.ycombinator.com/item?id=48907290) · hackernews · 2026-07-14 · 来源词: word document
- [3] [Rustwright – a Rust Rewrite of Playwright](https://news.ycombinator.com/item?id=48932230) · hackernews · 2026-07-16 · 来源词: playwright pdf
- [3] [Rustwright: Playwright rewritten in Rust that uses 70% less memory](https://news.ycombinator.com/item?id=48923788) · hackernews · 2026-07-15 · 来源词: playwright pdf
- [3] [Thermal Design for Spaceflight (NASA, 2022) [pdf]](https://news.ycombinator.com/item?id=48970576) · hackernews · 2026-07-19 · 来源词: pptx
- [3] [Hallo4D: Multi-Modal Hallucination Mitigation for Consistent Spatio-Temporal Generation](http://arxiv.org/abs/2607.12752v1) · arxiv · 2026-07-14 · 来源词: slide generation
- [3] [GEIS: A Generation-Evaluation-Improvement Loop of Agent Skills for Long-Form Article Generation](http://arxiv.org/abs/2607.11503v1) · arxiv · 2026-07-13 · 来源词: slide generation
- [3] [ALICE: Learning a General-Purpose Pathology Foundation Model from Vision, Vision-Language, and Slide-Level Experts](http://arxiv.org/abs/2607.09526v1) · arxiv · 2026-07-10 · 来源词: slide generation
- [3] [Conversational Tactile Data Interfaces: Co-Designing Accessible Data Experiences with Blind Users Using Refreshable Tactile Displays and Conversational AI](http://arxiv.org/abs/2607.14588v1) · arxiv · 2026-07-16 · 来源词: presentation AI
- [2] [We rewrote our custom visualisation renderers from SVG to be in Canvas](https://news.ycombinator.com/item?id=48940641) · hackernews · 2026-07-16 · 来源词: svg render
- [2] [Render.com Is Down](https://news.ycombinator.com/item?id=48914842) · hackernews · 2026-07-15 · 来源词: svg render
- [2] [A proper Docker image for WebCalendar: SQLite-backed and self-contained](https://news.ycombinator.com/item?id=48879586) · hackernews · 2026-07-12 · 来源词: docker
- [2] [**Your $80 Tesla P100 has been doing silently noisy math in llama.cpp for years. Three lines fix it, for free.**](https://www.reddit.com/r/LocalLLaMA/comments/1uu6p9o/your_80_tesla_p100_has_been_doing_silently_noisy/) · reddit · 2026-07-12 · 来源词: llama.cpp
- [2] [Interactive Jacobian-Lens visualizer and live steerer for GGUF models on llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1uu32z6/interactive_jacobianlens_visualizer_and_live/) · reddit · 2026-07-12 · 来源词: llama.cpp
- [2] [Llama.cpp update: ggml-hip: enable -funsafe-math-optimizations](https://www.reddit.com/r/LocalLLaMA/comments/1urrqp1/llamacpp_update_ggmlhip_enable/) · reddit · 2026-07-09 · 来源词: llama.cpp
- [2] [Ollama vs. Llama.cpp – Quick Benchmark](https://news.ycombinator.com/item?id=48880594) · hackernews · 2026-07-12 · 来源词: ollama
- [2] [Local Agent Toolkit – delegate small coding tasks to local Ollama models](https://news.ycombinator.com/item?id=48873864) · hackernews · 2026-07-11 · 来源词: ollama
- [2] [Dave Eggers told OpenAI staff that ChatGPT was 'silencing a generation'](https://news.ycombinator.com/item?id=48965505) · hackernews · 2026-07-19 · 来源词: slide generation
- [2] [Our idea-generation pipeline learned to stop lying to itself](https://news.ycombinator.com/item?id=48933758) · hackernews · 2026-07-16 · 来源词: slide generation
- [2] [Show HN: BlockSlides –> ProseMirror-WYSIWYG slide editor built like Tiptap](https://news.ycombinator.com/item?id=48852661) · hackernews · 2026-07-09 · 来源词: slide generation
- [2] [Show HN: Copresent – Turn your phone into a Google Slides remote](https://news.ycombinator.com/item?id=48841598) · hackernews · 2026-07-09 · 来源词: slide generation
- [2] [A Unified Detection Framework for AI-Related Content and Artifacts](http://arxiv.org/abs/2607.07527v1) · arxiv · 2026-07-08 · 来源词: AI text detection
- [2] [A little experiment in evading AI detection](https://news.ycombinator.com/item?id=48955484) · hackernews · 2026-07-18 · 来源词: AI text detection
- [2] [Why Shadow AI Detection Can Not Wait](https://news.ycombinator.com/item?id=48908735) · hackernews · 2026-07-14 · 来源词: AI text detection
- [2] [Show HN: AI Photo Editor – Professional-Grade Image Editing with Text Prompts](https://news.ycombinator.com/item?id=48882121) · hackernews · 2026-07-12 · 来源词: AI text detection
- [1] [Word Count Benchmarks for Websites and Email](https://news.ycombinator.com/item?id=48879152) · hackernews · 2026-07-12 · 来源词: word document
- [1] [5Gi: India's own 5G technology [pdf]](https://news.ycombinator.com/item?id=48880676) · hackernews · 2026-07-12 · 来源词: playwright pdf
- [1] [I built barebrowse: give a local-model agent a browser without Playwright — pruned ARIA snapshots instead of raw HTML (far fewer tokens)](https://www.reddit.com/r/LocalLLaMA/comments/1usg4cq/i_built_barebrowse_give_a_localmodel_agent_a/) · reddit · 2026-07-10 · 来源词: playwright pdf
- [1] [Reinforcing the Generation Order of Multimodal Masked Diffusion Models](http://arxiv.org/abs/2607.08056v1) · arxiv · 2026-07-09 · 来源词: slide generation
- [1] [Enhancing Large Multimodal Models in Key Information Extraction via Scene-Aware Document Synthesis](http://arxiv.org/abs/2607.04636v1) · arxiv · 2026-07-06 · 来源词: document generation
- [0] [SVG Filter Effects: Creating Texture with <FeTurbulence>](https://news.ycombinator.com/item?id=48876857) · hackernews · 2026-07-11 · 来源词: svg render

## 检索统计

- resvg: 0 条
- svg render: 4 条
- docx: 3 条
- word document: 9 条
- mermaid diagram: 2 条
- playwright pdf: 5 条
- pptx: 2 条
- presenton: 0 条
- docker: 3 条
- llama.cpp: 4 条
- polarprivate: 0 条
- ollama: 4 条
- typst: 1 条
- slide generation: 8 条
- presentation AI: 2 条
- document generation: 2 条
- AI text detection: 5 条
- pandoc: 0 条
