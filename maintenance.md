# 维护与部署指南

个人投资仪表盘（wealth-tracker）长期维护文档。

---

## 项目结构

```
wealth-tracker/
├── public/
│   ├── index.html           → 主程序，单文件 SPA 全部逻辑
│   ├── guide.html           → 使用文档网页版
│   ├── sw.js                → Service Worker，network-first 导航 + SWR 资源缓存
│   ├── manifest.json        → PWA 配置
│   └── icon.png             → 应用图标
├── src/
│   └── worker.js            → Worker 后端（价格代理 + D1 数据同步 + 频率限制 + 输入校验）
├── .wrangler/
│   └── tmp/                 → Wrangler 本地开发临时文件（自动生成）
├── tests/
│   └── smoke.test.cjs       → 数据归一化、CSV、BTC ETF 边界与 PWA 冒烟测试
├── schema.sql               → D1 数据库建表语句
├── package.json             → 项目信息 + npm 脚本
├── wrangler.toml            → Cloudflare Workers 部署配置
├── INVESTMENT_STRATEGY.md   → 投资策略定义
├── readme.md                → 项目首页说明（GitHub）
└── maintenance.md           → 本文档
```

> **核心文件**：`public/index.html` —— 整个网站是单个 HTML 文件，所有 UI 和逻辑都在里面。约 198KB / 3565 行，包含 CSS + HTML + JavaScript。

---

## 修改后部署

```bash
cd wealth-tracker
npm run check
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
| 仪表盘 | 总资产、定投进度、目标进度条（shimmer）、高点回撤、仓位盈亏、持仓分布环形图、CC 收入卡片、期权持仓摘要 |
| 操作台 | 股票买卖录入（VGT/SMH/BTC）、年度再平衡（换仓/注资，仅12/31解锁） |
| 期权 | 持仓指标、OTM 行权价参考（可调百分比+localStorage）、期权状态（ITM 蓝色标签+铁律提示）、记录 CALL/PUT、CC 收入、持仓清单、被动行权 T+1 策略 |
| 数据 | 现金管理（入金/出金/修正）、持仓明细（含张数列+列排序）、交易历史（筛选/排序）、资金流水（权利金蓝色独立标注） |
| 日志 | 操作日志（热力图）、纪律打卡（连续定投+热力图）、年度复盘矩阵、投资规划（收入渐进加码/退出策略/提款模拟） |

### 侧边栏

- 总资产 + 期权持仓摘要 + 持仓环形图
- 实时价格（VGT/SMH/BTC，来源标注）
- 云端同步（D1 数据库推/拉，状态指示）
- 投资参数（月度 DCA 总额、路线图起点+年龄、财务目标、仓位分配滑块）
- 5 种配色方案（森林/海洋/暖阳/梅紫/极简）
- 自动备份开关 + JSON/CSV 导入导出
- 暗色/亮色模式切换

---

## 当前版本

线上地址：[https://wealth-tracker.ssp2180481336.workers.dev](https://wealth-tracker.ssp2180481336.workers.dev)

分支：`main`

策略：永久核心仓（VGT / SMH / BTC ETF，美股代码 BTC）+ VGT/SMH Covered Call

最近功能：
- 股息记录（VGT/SMH 入账，仅记现金流水不污染月度定投指标）
- 年度收益归因视图（选择年份拆解当年总收益，标注各来源贡献占比）
- 年度复盘热力矩阵：4×5 权利金贡献率热力 + 年末持仓 + 长线数据面板（总入金/总资产/CAGR/目标差额）
- 移动端矩阵 2 列自适应布局 + 资金流水渲染修复
- 纪律打卡模块：连续定投月份计数 + 操作日志热力图
- 投资规划：收入渐进加码（4阶段年龄自动计算）、47岁退出策略、提款模拟器
- Toast 提示美化：毛玻璃效果 + 弹性弹入动画 + 撤销 Toast 支持点击撤销
- 表格表头 sticky 固定（持仓明细、交易历史、资金流水）
- 期权 CALL-only 策略（被动行权 T+1 开盘市价买回，禁止提前平仓/roll）
- 资金流水权利金独立显示（蓝色标注，与入金/出金区分）
- 账户现金汇总：入金合计排除权利金（权利金不统计为入金，仅影响现金余额）
- 按钮/卡片/微交互 UI 统一：hover 浮起效果、点击缩放反馈、统一过渡动画
- 期权类型选择器保留 CALL/PUT 选项（策略建议仅卖 CALL）
- OTM 行权价参考（可调节百分比 + localStorage 记忆）
- 移动端 sticky 状态栏
- 权利金实时入账
- 云端同步纳入期权交易
- 移动端底部导航期权图标（底仓+CALL）
- Worker 频率限制（60 req/min per IP）+ 限流内存清理防泄漏
- Worker 安全加固：symbol 正则校验防路径穿越、POST /api/sync 输入校验（key 白名单 + value 512KB 限制）、OPTIONS 预检 Max-Age
- 数据安全：beforeunload 不再乐观清 dirty（防推送失败数据丢失）、期权权利金 NaN 防护、loadCash/saveCash NaN 死锁修复
- 导入安全：CSV 日期格式校验防 XSS、JSON 导入数据归一化（强制类型 + 补 id）
- 交易安全：卖出持仓校验防裸空、行权持仓校验
- 同步改进：autoPull 空值静默（清数据后不弹假同步 toast）、stableStr 键序无关比较（消除假冲突）、applyCloudVal 类型守卫
- 期权 delOpt/settleOpt/assignOpt 改用唯一 id 而非数组索引（防同步后误删）
- SW 升级 v4：导航 network-first（部署后即时生效）、PRECACHE 移除 /guide（防 404 安装失败）、SWR 兜底 503
- CSS 修复：.bb-btn 语法错误（裸声明合并）、.timeline 横向卡片（删竖向冲突）、.mob-status-bar 去重
- 年度归因：价格 API 失败返回 null + "价格数据不可用"警告（不再返回 0 导致归因失真）
- 存储满持久警告条（QuotaExceeded 不再静默）
- 暗色主题 --orange 提亮（#e8880c → #f59e0b）
