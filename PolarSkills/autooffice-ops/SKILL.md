# AutoOffice — 使用指南

> 多格式自动化报告生成平台（PPT、PDF、Word、LaTeX、HTML），含去AI化处理

## 核心信息

| 维度 | 值 |
|---|---|
| 健康端点 | 端口 3900（/health） |
| 启动命令 | `node dist/cli.js serve --port 3900` |
| 安装命令 | `npm ci` |
| 技术栈 | Node.js, TypeScript, PptxGenJS, docx, Playwright (PDF), Handlebars |

## 快速启动

```bash
cd ~/Polarisor/AutoOffice
npm ci
node dist/cli.js serve --port 3900
```

## 健康检查

```bash
curl -s http://127.0.0.1:3900/health
```

## 依赖服务

- Playwright (PDF 渲染)
- Ollama (去AI化 VLM 可选)
