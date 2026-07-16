# AutoOffice — 故障排查

> 多格式自动化报告生成平台（PPT、PDF、Word、LaTeX、HTML），含去AI化处理

## 健康检查

```bash
# PolarProcess 权威状态
curl -fsS http://127.0.0.1:11055/api/services/autooffice | jq '{status,pid,port,command}'

# PolarPort 权威归属
curl -fsS http://127.0.0.1:11050/api/list | jq '.[] | select(.service_name == "autooffice")'

# HTTP 端点
curl -s http://127.0.0.1:3900/health
```

## 关键端口

| 端口 | 说明 |
|---|---|
| 3900 | AutoOffice 主服务 |

## 常见故障

### 1. PDF 生成失败

**修复**：`确认 Playwright 浏览器已安装: npx playwright install chromium`

### 2. 模板渲染错误

**修复**：`检查 Handlebars 模板语法`

### 3. 字体缺失

**修复**：`安装所需字体到系统或 fonts/ 目录`

## 依赖服务

- Playwright (PDF 渲染)
- Ollama (去AI化 VLM 可选)

## 紧急恢复

```bash
cd ~/Polarisor/AutoOffice
npm run build
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/restart
curl -s http://127.0.0.1:3900/health && echo 'OK' || echo 'BROKEN'
```

PolarProcess 与 PolarPort 是唯一权威；不得直接启动、后台化、使用 PID 文件或
向监听进程发送信号。不要在 API 排障中触发 `autooffice-auto-evolve` 或
`autooffice-sota-radar`。
