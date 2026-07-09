# AutoOffice — 部署指南

> 多格式自动化报告生成平台（PPT、PDF、Word、LaTeX、HTML），含去AI化处理

## 环境要求

- 技术栈：Node.js, TypeScript, PptxGenJS, docx, Playwright (PDF), Handlebars
- 安装：`npm ci`

## 安装步骤

```bash
cd ~/Polarisor/AutoOffice
npm ci
```

## 启动方式

```bash
cd ~/Polarisor/AutoOffice
node dist/cli.js serve --port 3900
```

## 端口分配

| 端口 | 用途 |
|---|---|
| 3900 | 主服务 |

## 健康检查确认

```bash
curl -s http://127.0.0.1:3900/health
```

## 回滚方式

```bash
cd ~/Polarisor/AutoOffice
git log --oneline -5
git checkout <previous-commit>
npm ci
node dist/cli.js serve --port 3900
```
