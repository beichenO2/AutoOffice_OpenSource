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
npm run build
bash scripts/register-runtime.sh finalize
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/start
```

PolarProcess 是唯一生命周期权威，PolarPort 是唯一端口权威。部署脚本不得直接
启动、后台化或发送信号，也不得修改两个 AutoOffice cron。

## 端口分配

| 端口 | 用途 |
|---|---|
| 3900 | 主服务 |

## 健康检查确认

```bash
curl -s http://127.0.0.1:3900/health
```

## 回滚后重建与精确重启

```bash
cd ~/Polarisor/AutoOffice
git log --oneline -5
npm ci
npm run build
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/restart
```

代码版本回滚须通过正常 Git 审核流程完成；本 Skill 只负责回滚后的权威重启。
