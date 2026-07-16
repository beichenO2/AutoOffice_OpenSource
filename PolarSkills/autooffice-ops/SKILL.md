# AutoOffice — 使用指南

> 多格式自动化报告生成平台（PPT、PDF、Word、LaTeX、HTML），含去AI化处理

## 核心信息

| 维度 | 值 |
|---|---|
| 健康端点 | 端口 3900（/health） |
| 生命周期权威 | PolarProcess 服务 `autooffice` |
| 端口权威 | PolarPort（3900） |
| 安装命令 | `npm ci` |
| 技术栈 | Node.js, TypeScript, PptxGenJS, docx, Playwright (PDF), Handlebars |

## 快速启动

```bash
cd ~/Polarisor/AutoOffice
npm ci
npm run build
bash scripts/register-runtime.sh finalize
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/start
```

禁止直接运行 `serve`、后台 `&`、`nohup`、PID 文件或直接信号。停止和重启也
只能调用 PolarProcess 的精确 `autooffice` 接口；端口只能由 PolarPort 分配。

## 健康检查

```bash
curl -s http://127.0.0.1:3900/health
```

## 依赖服务

- Playwright (PDF 渲染)
- Ollama (去AI化 VLM 可选)
