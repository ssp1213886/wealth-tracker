# Wealth Tracker · 个人投资仪表盘

VGT + SMH + BTC 轮动期权策略，Cloudflare Worker + D1 云端同步的 PWA 投资追踪工具。

**线上地址**：<https://wealth-tracker.ssp2180481336.workers.dev>

---

## 页面结构

| 页面 | 功能 |
|------|------|
| 仪表盘 | 总资产指标、定投进度、目标进度条、回撤、持仓分布饼图、期权持仓摘要 |
| 操作台 | 股票买卖录入（VGT/SMH/BTC/SGOV）、年度再平衡（换仓/注资） |
| 期权 | VIX 监测、期权记录（CALL/PUT）、盈亏汇总（本月+累计）、策略 OTM 矩阵、持仓清单（含张数） |
| 数据 | 现金管理（入金/出金/修正）、持仓明细、交易历史（筛选+排序）、资金流水 |
| 规划 | 收入渐进加码、退出策略、提款模拟 |

## 侧边栏

- 总资产 + 现金/持仓分解
- 期权持仓摘要（标的/类型/行权价/张数/到期日）
- 实时价格
- 云端同步（D1 数据库，支持推/拉）
- 投资参数（月定投金额、路线图起始+年龄、财务目标）
- 5 种配色方案

## 主要特性

- 轮动期权 OTM 矩阵：根据 VIX + 回撤自动计算 CALL/PUT 建议行权价
- 期权盈亏汇总：本月权利金按写入日统计，累计权利金
- PUT 冻结现金：期权页显示可用现金 vs 冻结担保金
- 持仓清单含张数列
- 现金修正：手动校准现金余额，自动记录流水
- 暗色/亮色模式 + 5 种配色
- PWA 安装（Service Worker network-first）
- Cloudflare D1 云端同步
- Yahoo Finance 实时行情 + 腾讯 API 备选
- Schwab CSV 拖拽导入
- JSON 导入/导出


## 投资策略：永久核心仓 + Covered Call

核心思想：永远持有 VGT/SMH/BTC 作为财富发动机，用部分仓位卖 Call 获取额外现金流，权利金继续买入核心资产，让期权成为复利加速器，而不是替代投资。

- **核心仓（永不动）**：VGT 50% / SMH 30% / BTC 20% 按月定投
- **Covered Call**：持有正股，卖虚值 CALL，收取权利金
- **权利金复投**：收取的权利金按核心仓比例继续买入 VGT/SMH/BTC
- **PUT 为打折买入**：仅在回撤 5-12% 时卖 PUT，VIX≥30 减半

## 技术栈

- 前端：原生 HTML/CSS/JS，单文件 SPA，Inter 字体
- 后端：Cloudflare Worker + D1 Database
- 行情：Yahoo Finance（主）/ 腾讯 qt.gtimg.cn（备）
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
| `public/index.html` | 主程序，5 页仪表盘 |
| `public/guide.html` | 使用文档 |
| `public/sw.js` | Service Worker |
| `public/manifest.json` | PWA 配置 |
| `public/icon.png` | 应用图标 |
| `src/worker.js` | Worker 后端（价格代理 + D1 数据同步） |
| `schema.sql` | D1 建表语句 |
| `wrangler.toml` | Cloudflare 部署配置 |
| `maintenance.md` | 维护指南 + 代码结构速查 |
