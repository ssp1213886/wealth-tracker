# 维护与部署指南

个人投资仪表盘（wealth-tracker）长期维护文档。

---

## 项目结构

```
wealth-server/
├── public/
│   ├── index.html           → 主程序，单文件 SPA 全部逻辑
│   ├── guide.html           → 使用文档网页版
│   ├── sw.js                → Service Worker，网络优先策略
│   ├── manifest.json        → PWA 配置
│   └── icon.png             → 应用图标
├── src/
│   └── worker.js            → Worker 后端（价格代理 + D1 数据同步）
├── .wrangler/
│   └── tmp/                 → Wrangler 本地开发临时文件（自动生成）
├── schema.sql               → D1 数据库建表语句
├── package.json             → 项目信息 + npm 脚本
├── readme.md                → 项目首页说明（GitHub）
└── maintenance.md           → 本文档
```

> **核心文件**：`public/index.html` —— 整个网站是单个 HTML 文件，所有 UI 和逻辑都在里面。约 165KB，包含 CSS + HTML + JavaScript。

---

## 修改后部署

```bash
cd wealth-server
npx wrangler deploy
```

---

## 代码修改指南

### 让 AI 帮你改

告诉 AI 你要改什么，AI 会直接编辑 `public/index.html` 然后自动部署。

- **改 UI**：「把卡片圆角调大一点」
- **修 bug**：「删除交易记录后现金没更新」
- **加功能**：「在期权页加一个到期结算卡片」

AI 会：改动 → 验证 JS 语法 → npx wrangler deploy → git commit + push

### 自己手动改

用文本编辑器打开 `public/index.html`，改完保存，然后运行部署命令。

---

## 当前功能速查

| 页面 | 关键功能 |
|------|---------|
| 仪表盘 | 总资产、定投进度、回撤、持仓分布、CC 收入卡片、期权持仓摘要 |
| 操作台 | 股票买卖录入、年度再平衡 |
| 期权 | 持仓指标、OTM 行权价参考、期权状态、记录 CALL、CC 收入、持仓清单、被动行权 T+1 策略 |
| 数据 | 现金管理（入金/出金/修正）、持仓明细、交易历史、资金流水（权利金蓝色独立标注） |
| 日志 | 操作日志 + 投资规划（收入加码/退出策略/提款模拟） |

### 侧边栏

- 总资产 + 期权持仓摘要
- 实时价格（VGT/SMH/BTC）
- 云端同步（D1 推/拉）
- 投资参数（DCA 金额、目标、路线图）
- 5 种配色
- 自动备份开关 + JSON/CSV 导入导出

---

## 当前版本

线上地址：<https://wealth-tracker.ssp2180481336.workers.dev>

分支：`main`

策略：永久核心仓（VGT 50% / SMH 30% / BTC 20%）+ Covered Call

最近更新：
- Toast 提示美化：毛玻璃效果 + 弹入动画
- 表格表头 sticky 固定（持仓明细、交易历史）
- 期权 CALL-only 策略（被动行权 T+1 开盘市价买回，禁止提前平仓/roll）
- 资金流水权利金独立显示（蓝色标注，与入金/accent 色/出金/红色区分）
- 账户现金汇总：入金合计排除权利金（权利金不统计为入金，仅影响现金余额）
- 按钮/卡片/微交互 UI 统一：hover 浮起效果、点击缩放反馈、统一过渡动画
- CALL-only 策略（已移除 PUT 相关代码）
- OTM 行权价参考（可调节百分比 + localStorage 记忆）
- 移动端 sticky 状态栏
- 权利金实时入账
- 云端同步纳入期权交易
- 移动端底部导航期权图标（底仓+CALL）
