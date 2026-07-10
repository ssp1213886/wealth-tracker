# Wealth Tracker · 个人投资仪表盘

VGT + SMH + BTC 轮动期权策略，云端同步的 PWA 投资追踪工具。

**线上地址**：<https://wealth-tracker.ssp2180481336.workers.dev>

---

## 页面结构

| 页面 | 功能 |
|------|------|
| 仪表盘 | 总资产、定投目标、目标进度、回撤、持仓分布、期权持仓摘要 |
| 控制台 | 买卖交易录入、年度再平衡 |
| 期权 | VIX 信号、期权记录、盈亏汇总、策略 OTM 矩阵、持仓清单 |
| 数据 | 现金管理、持仓明细、交易历史、资金流水 |
| 日志 | 操作日志、纪律打卡热力图 |
| 规划 | 收入加码、退出策略、提款模拟 |

## 侧边栏

- 总资产 + 现金/持仓分解
- 期权持仓摘要
- 实时价格
- 云端同步（D1 数据库）
- 投资参数（DCA 金额、目标、配色）

## 特性

- 轮动期权策略 OTM 矩阵（根据 VIX + 回撤自动计算）
- PUT 冻结现金显示（可用/冻结）
- 期权持仓张数列
- 到期结算机制
- 现金修正功能
- PWA 支持（Service Worker network-first）
- 暗色/亮色模式 + 5 种配色
- Cloudflare D1 云端同步
- Yahoo Finance 实时行情
- Schwab CSV 导入
- JSON 导入/导出

## 技术栈

- 前端：原生 HTML/CSS/JS，单文件 SPA
- 后端：Cloudflare Worker + D1 Database
- 行情：Yahoo Finance（主）/ 腾讯 API（备）
- 部署：Cloudflare Workers

## 本地开发

```bash
cd wealth-server
npx wrangler dev
```

## 部署

```bash
npm install
npx wrangler deploy
```

## 文件结构

| 文件 | 作用 |
|------|------|
| `public/index.html` | 主程序，6 页仪表盘 |
| `public/guide.html` | 使用文档 |
| `public/sw.js` | Service Worker |
| `public/manifest.json` | PWA 配置 |
| `public/icon.png` | 图标 |
| `src/worker.js` | Worker 后端（价格代理 + 数据同步） |
| `schema.sql` | D1 建表语句 |
| `wrangler.toml` | 部署配置 |
| `maintenance.md` | 维护指南 |
