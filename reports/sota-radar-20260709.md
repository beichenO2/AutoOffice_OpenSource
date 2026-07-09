# AutoOffice SOTA 雷达 — 2026-07-09

> 数据源：digist 采集库（近 14 天）· 指纹词 12 + 视野词 6 · 去重命中 52 条
> 结晶分 = 直指在用组件(3/1) + 需求覆盖(≤2) + 可落地性(≤2) + 新颖度(±1)，逐条给出理由。
> 本报告只做情报聚合，不自动改动任何代码或依赖；升级需人工评审后执行。

## 关键技术结晶（Top 5）

1. **[Show HN: Docx-CLI: agents read/edit Word docs using 1/2 the time and tokens](https://news.ycombinator.com/item?id=48821500)** · hackernews · 2026-07-07
   - 结晶分 **7** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

2. **[The open source DOCX editor submitted to HN a few weeks ago has been deleted](https://news.ycombinator.com/item?id=48692474)** · hackernews · 2026-06-26
   - 结晶分 **7** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

3. **[SuperDoc – Modern Docx Editor and Agent SDK](https://news.ycombinator.com/item?id=48755343)** · hackernews · 2026-07-02
   - 结晶分 **7** — 直指核心组件 docx；关联需求 R1；可落地（发布/工具/版本）
   - 影响需求：R1

4. **[Show HN: Free Mermaid Diagram Editor](https://news.ycombinator.com/item?id=48825430)** · hackernews · 2026-07-07
   - 结晶分 **6** — 直指核心组件 mermaid；可落地（发布/工具/版本）

5. **[Apple Container 1.0 Released as a Native Docker Alternative for macOS](https://news.ycombinator.com/item?id=48790058)** · hackernews · 2026-07-04
   - 结晶分 **6** — 直指外围组件 docker；关联需求 R5；可落地（发布/工具/版本）
   - 影响需求：R5

## 评审（基于当前实现事实）

1. 【继续观察】Docx-CLI 声称减少 token 消耗，但 AutoOffice 已使用 docx@^9.6.1 实现 R1，且 de-AI 文本处理要求禁止 AI 生成，token 优化无意义；风险：可能引入非 de-AI 处理逻辑。
2. 【忽略】已删除的项目无可用性，无法评估替换 docx@^9.6.1 或影响 R1；风险：无实际代码或文档可验证。
3. 【继续观察】SuperDoc 作为现代编辑器可能增强 docx 处理，但 AutoOffice 的 R1 依赖 docx@^9.6.1 库而非编辑器，且 de-AI 要求限制智能编辑；风险：编辑器功能可能引入 AI 依赖。
4. 【继续观察】免费 Mermaid 编辑器可能辅助 mermaid@^11.14.0 的图表生成，但 AutoOffice 仅需渲染而非编辑；风险：编辑器功能冗余，增加维护成本。
5. 【忽略】Apple Container 仅限 macOS，而 AutoOffice 的 R5 依赖 docker@28.x 跨平台部署；风险：平台限制不兼容现有 Docker 需求。

本期是否存在值得立项评估的关键技术？否。

## 全部命中（按结晶分）

- [7] [Show HN: Docx-CLI: agents read/edit Word docs using 1/2 the time and tokens](https://news.ycombinator.com/item?id=48821500) · hackernews · 2026-07-07 · 来源词: docx
- [7] [The open source DOCX editor submitted to HN a few weeks ago has been deleted](https://news.ycombinator.com/item?id=48692474) · hackernews · 2026-06-26 · 来源词: docx
- [7] [SuperDoc – Modern Docx Editor and Agent SDK](https://news.ycombinator.com/item?id=48755343) · hackernews · 2026-07-02 · 来源词: docx
- [6] [Show HN: Free Mermaid Diagram Editor](https://news.ycombinator.com/item?id=48825430) · hackernews · 2026-07-07 · 来源词: mermaid diagram
- [6] [Apple Container 1.0 Released as a Native Docker Alternative for macOS](https://news.ycombinator.com/item?id=48790058) · hackernews · 2026-07-04 · 来源词: docker
- [6] [Show HN: Run multiple Docker Compose instances for your agents](https://news.ycombinator.com/item?id=48767816) · hackernews · 2026-07-02 · 来源词: docker
- [6] [Show HN: Pglayers – PostgreSQL extensions as stackable Docker layers](https://news.ycombinator.com/item?id=48749752) · hackernews · 2026-07-01 · 来源词: docker
- [6] [Show HN: Claude-CLI – Run Claude Code in a throwaway Docker container](https://news.ycombinator.com/item?id=48702113) · hackernews · 2026-06-27 · 来源词: docker
- [6] [Ternary Bonsai 1.58-bit models - ggml: add Q2_0 quantization support (CPU) by khosravipasha · Pull Request #24448 · ggml-org/llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1uqur7o/ternary_bonsai_158bit_models_ggml_add_q2_0/) · reddit · 2026-07-08 · 来源词: llama.cpp
- [6] [We built a calibration-aware Q4_K_M quant of Qwen3.5 0.8B that recovers 96.5% of the BF16 gap vs pure llama.cpp Q4_K_M (SpectralQuant)](https://www.reddit.com/r/LocalLLaMA/comments/1uh0clv/we_built_a_calibrationaware_q4_k_m_quant_of/) · reddit · 2026-06-27 · 来源词: llama.cpp
- [6] [Tensor Split Fix for intel GPU's llama.cpp release b9788](https://www.reddit.com/r/LocalLLaMA/comments/1ufctc8/tensor_split_fix_for_intel_gpus_llamacpp_release/) · reddit · 2026-06-25 · 来源词: llama.cpp
- [6] [Show HN: Otaku – one terminal client for Ollama, LM Studio, and MLX](https://news.ycombinator.com/item?id=48805043) · hackernews · 2026-07-06 · 来源词: ollama
- [5] [Edit Markdown like editing a Word document](https://news.ycombinator.com/item?id=48802055) · hackernews · 2026-07-06 · 来源词: word document
- [5] [Show HN: PDF.chat](https://news.ycombinator.com/item?id=48716249) · hackernews · 2026-06-29 · 来源词: playwright pdf
- [4] [Show HN: I built a declarative layout engine for SVG, Canvas, WebGL](https://news.ycombinator.com/item?id=48770501) · hackernews · 2026-07-03 · 来源词: svg render
- [4] [Show HN: Use any SVG as QR code On Dots](https://news.ycombinator.com/item?id=48699068) · hackernews · 2026-06-27 · 来源词: svg render
- [4] [CMDR: Contextual Multimodal Document Retrieval](http://arxiv.org/abs/2607.05927v1) · arxiv · 2026-07-07 · 来源词: word document
- [4] [Multimodal Graph RAG for Long-range Visually Rich Document Understanding](http://arxiv.org/abs/2606.28780v1) · arxiv · 2026-06-27 · 来源词: word document, document generation
- [4] [Dory: Docker and Linux containers, native to your Mac](https://news.ycombinator.com/item?id=48782524) · hackernews · 2026-07-04 · 来源词: docker
- [4] [Agent Zero – A full Docker Linux system for your AI agent](https://news.ycombinator.com/item?id=48682217) · hackernews · 2026-06-26 · 来源词: docker
- [4] [实测 MTP 最优值！3080 20G +9070 16G CUDA-ROCm llama.cpp 推理 Qwen3.6 27B](https://www.bilibili.com/video/BV1Yg7W6vEVX/) · bilibili · 2026-06-27 · 来源词: llama.cpp
- [4] [When can we expect merged DeepSeek V4 Flash / MiniMax M3 llama.cpp support?](https://www.reddit.com/r/LocalLLaMA/comments/1ugsnej/when_can_we_expect_merged_deepseek_v4_flash/) · reddit · 2026-06-27 · 来源词: llama.cpp
- [4] [vulkan: make TP viable by pwilkin · Pull Request #25051 · ggml-org/llama.cpp](https://www.reddit.com/r/LocalLLaMA/comments/1ugitcr/vulkan_make_tp_viable_by_pwilkin_pull_request/) · reddit · 2026-06-26 · 来源词: llama.cpp
- [4] [Help optimizing llama.cpp + Qwen 27B on RTX PRO 6000 Blackwell for coding agents](https://www.reddit.com/r/LocalLLaMA/comments/1ug1j3i/help_optimizing_llamacpp_qwen_27b_on_rtx_pro_6000/) · reddit · 2026-06-26 · 来源词: llama.cpp
- [4] [Show HN: Rheo 0.4.0](https://news.ycombinator.com/item?id=48730169) · hackernews · 2026-06-30 · 来源词: typst
- [4] [Show HN: Copresent – Turn your phone into a Google Slides remote](https://news.ycombinator.com/item?id=48841598) · hackernews · 2026-07-09 · 来源词: slide generation
- [4] [Grounded Optimization: A Layered Engineering Framework for Reducing LLM Hallucination in Automated Personal Document Rewriting](http://arxiv.org/abs/2607.01457v1) · arxiv · 2026-07-01 · 来源词: document generation
- [4] [A Unified Detection Framework for AI-Related Content and Artifacts](http://arxiv.org/abs/2607.07527v1) · arxiv · 2026-07-08 · 来源词: AI text detection
- [3] [MentalThink: Shaping Thoughts in Mental SVG World](http://arxiv.org/abs/2607.03530v1) · arxiv · 2026-07-03 · 来源词: svg render
- [3] [Writing Blogs or News Articles? Free and Fast Word Counter -Accurate and Private](https://news.ycombinator.com/item?id=48791081) · hackernews · 2026-07-05 · 来源词: word document
- [3] [Colophons, and why I'd never heard the word](https://news.ycombinator.com/item?id=48775571) · hackernews · 2026-07-03 · 来源词: word document
- [3] [WordStar: A Writer's Word Processor (1996)](https://news.ycombinator.com/item?id=48694853) · hackernews · 2026-06-27 · 来源词: word document
- [3] [The General Court dismisses Apple's actions over its designation as a gatekeeper [pdf]](https://news.ycombinator.com/item?id=48829753) · hackernews · 2026-07-08 · 来源词: playwright pdf
- [3] [The Shift to Agentic AI: Evidence from Codex [pdf]](https://news.ycombinator.com/item?id=48686845) · hackernews · 2026-06-26 · 来源词: playwright pdf
- [3] [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) · github · 2026-06-27 · 来源词: pptx
- [3] [Personalization as Inverse Planning: Learning Latent Design Intents for Agentic Slide Generation via Structural Denoising](http://arxiv.org/abs/2607.00407v1) · arxiv · 2026-07-01 · 来源词: slide generation
- [3] [SCOPE: Leveraging Subgoal Critiques for Code Generation](http://arxiv.org/abs/2607.05810v1) · arxiv · 2026-07-07 · 来源词: slide generation
- [3] [Unison: Benchmarking Unified Multimodal Models via Synergistic Understanding and Generation](http://arxiv.org/abs/2606.26984v1) · arxiv · 2026-06-25 · 来源词: slide generation
- [3] [Comparative Study of Domain-adapted VLMs for General Document Visual Question Answering](http://arxiv.org/abs/2607.07179v1) · arxiv · 2026-07-08 · 来源词: presentation AI
- [3] [Enhancing Large Multimodal Models in Key Information Extraction via Scene-Aware Document Synthesis](http://arxiv.org/abs/2607.04636v1) · arxiv · 2026-07-06 · 来源词: document generation
- [3] [MultAttnAttrib: Training-Free Multimodal Attribution in Long Document Question Answering](http://arxiv.org/abs/2607.01420v1) · arxiv · 2026-07-01 · 来源词: document generation
- [3] [Beyond Document Grounding: Span-Level Hallucination Detection over Code, Tool Output, and Documents](http://arxiv.org/abs/2607.00895v1) · arxiv · 2026-07-01 · 来源词: document generation
- [3] [Pseudo-Text-Conditioned 3D Grounding DINO for Organ Localization in Abdominal CT](http://arxiv.org/abs/2606.27084v1) · arxiv · 2026-06-25 · 来源词: AI text detection
- [2] [Neural Render Proxies for Interactive and Differentiable Lighting](https://news.ycombinator.com/item?id=48753160) · hackernews · 2026-07-01 · 来源词: svg render
- [2] [SVG Recolor Tool – Change Color of SVG Online – Free Color Tool](https://news.ycombinator.com/item?id=48715654) · hackernews · 2026-06-29 · 来源词: svg render
- [2] [SVG-Margin: Better Gutters for Emacs](https://news.ycombinator.com/item?id=48695605) · hackernews · 2026-06-27 · 来源词: svg render
- [2] [Typst: Designing for Incrementality (Laurenz Mädje at RustWeek) [video]](https://news.ycombinator.com/item?id=48757315) · hackernews · 2026-07-02 · 来源词: typst
- [2] [SoftBank's investor presentation is one of the greatest things ever made](https://news.ycombinator.com/item?id=48672657) · hackernews · 2026-06-25 · 来源词: presentation AI
- [2] [Mark Zuckerberg's biggest legal nightmare yet could cost Meta $1.4T](https://news.ycombinator.com/item?id=48817191) · hackernews · 2026-07-07 · 来源词: presentation AI
- [2] [Ask HN: What is the latest research on AI detection?](https://news.ycombinator.com/item?id=48759712) · hackernews · 2026-07-02 · 来源词: AI text detection
- [2] [Text AI watermarks will always be trivial to remove](https://news.ycombinator.com/item?id=48757466) · hackernews · 2026-07-02 · 来源词: AI text detection
- [2] [Pandoc Lua Filters](https://news.ycombinator.com/item?id=48773079) · hackernews · 2026-07-03 · 来源词: pandoc

## 检索统计

- resvg: 0 条
- svg render: 6 条
- docx: 3 条
- word document: 6 条
- mermaid diagram: 1 条
- playwright pdf: 3 条
- pptx: 1 条
- presenton: 0 条
- docker: 6 条
- llama.cpp: 7 条
- polarprivate: 0 条
- ollama: 1 条
- typst: 2 条
- slide generation: 4 条
- presentation AI: 3 条
- document generation: 5 条
- AI text detection: 4 条
- pandoc: 1 条
