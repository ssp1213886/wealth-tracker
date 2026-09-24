# Wealth Tracker · 个人投资仪表盘

VGT + SMH + BTC ETF（美股代码 `BTC`，非现货 BTC）永久核心仓 + Covered Call 增强策略，Cloudflare Worker + D1 云端同步的 PWA 投资追踪工具。

**线上地址**：[https://wealth-tracker.ssp2180481336.workers.dev](https://wealth-tracker.ssp2180481336.workers.dev)

---

## ⚠️ 给开发者 / AI 助手的须知

> 前端**已经不是单文件**了。改前端请改 `src/app/*`，**永远不要直接编辑 `public/assets/app.js`** —— 它是 esbuild 的构建产物，下次构建就被覆盖。

- **前端源码**：`src/app/`（`index.js` 页面逻辑 + 8 个纯函数模块）
- **前端产物**：`public/assets/app.js`（由 `npm run build` 生成）；`public/assets/main.css` 是手写的
- **改完必须构建**：`npm run build`，否则线上不会有任何变化
- **后端**：`src/worker.js` + `src/lib/*`
- 更详细的代码约定、血泪教训与排障流程见 [maintenance.md](./maintenance.md)

---

## 投资策略：永久核心仓 + Covered Call

核心思想：永远持有 VGT/SMH/BTC ETF 作为财富发动机，用部分仓位卖 CALL 获取额外现金流，权利金继续买入核心资产，让期权成为复利加速器，而不是替代投资。

- **核心仓（永不动）**：VGT / SMH / BTC 按月定投，比例可调
- **Covered Call**：仅针对 VGT / SMH，持有正股后卖出虚值 CALL；BTC ETF 不进入期权模块
- **权利金复投**：收取的权利金按核心仓比例继续买入 VGT/SMH/BTC
- **被动行权 T+1 买回**：若 CALL 被行权，T+1 手动买回正股保持仓位，不提前平仓
- **铁律**：不卖正股、不提前平仓

完整策略定义见 [INVESTMENT_STRATEGY.md](./INVESTMENT_STRATEGY.md)。

---

## 页面结构

**4 个 Tab**（桌面端顶部 Tab / 移动端底部导航）：仪表盘 → 操作台 → 期权 → 记录

| Tab | 功能 |
|------|------|
| 仪表盘 | 总资产指标、定投进度、20 年旅程、目标进度条、高点回撤、仓位盈亏、持仓分布环形图、Covered Call 收入卡片、期权持仓摘要 |
| 操作台 | 股票买卖录入（VGT/SMH/BTC）、年度再平衡（换仓/注资，仅 12/31 解锁）、手动刷新行情 |
| 期权 | 持仓指标（可卖张数 + 可复投金额）、OTM 行权价参考（百分比可调）、记录 CALL/PUT、期权状态与铁律提示、CC 收入、持仓清单 |
| 记录 | **明细**分段（现金管理 / 持仓明细 / 交易历史 / 资金流水 / 年度收益归因）+ **日志**分段（操作日志 / 纪律打卡 / 年度复盘矩阵 / 投资规划），顶部搜索框跨两段生效 |

### 移动端

- 底部导航 4 键；右下角悬浮「快捷操作」按钮 → 入金 / 买入 / 卖出 / 卖 Call
- 顶部状态栏（总资产 + 今日收益 + 实时价 + 同步状态 + 提醒铃铛 + 明暗切换）。点击**不再**刷新行情（避免误触，刷新入口在操作台）
- 侧边栏是从左侧滑入的抽屉，第二层抽屉放"设置"；安全区适配、44pt 触控目标、卡片按压缩放反馈

---

## 侧边栏

- **资产概览**：总资产 + 今日收益 + 持仓市值 / 可用现金 + 下次定投日期 + 期权持仓摘要
- **目标配比**：环形图 + VGT/SMH/BTC 目标比例
- **市场行情**：VGT / SMH / BTC 实时价格（标注来源与更新时间）
- **数据健康**：最近云同步 / 最近备份 / 冲突状态，附「重试」「强制上传」
- **设置**（点进去展开第二层）：
  - 快捷设置：手动行情 / 云端同步 / 数据与备份 / 投资参数
  - 高级设置（折叠）：连接配置、JSON 导出导入、券商 CSV 导入、自动备份开关、定投参数
- **配色**：森林 / 海洋 / 暖阳 / 梅紫 / 极简 5 套
- 明暗模式切换、隐私开关（一键隐藏金额）
- 底部：使用文档、清除所有数据

---

## 主要功能

**投资与持仓**

- 年度复盘矩阵：4 行 × 5 列热力方格，年度权利金贡献率（CC 权利金 ÷ 总买入）驱动着色，含年末持仓 / CC 权利金 / 总买入，右侧长线数据面板（总入金 / 总资产 / CAGR / 目标差额）
- 年度收益归因：选择年份拆解当年总收益（各标的增值 + CC 权利金 + 股息 + 其他），标注贡献占比
- OTM 行权价参考：VGT/SMH 按 ± 调整百分比计算建议行权价，本地记忆
- Covered Call 卡片：本月 CC 收入 + 活跃张数，权利金按比例复投核心仓
- 持仓明细：标的 / 持仓 / 均价 / 市值 / 盈亏 / 收益率，支持列排序
- 交易历史：方向标签（买入/卖出多少股）+ 标的筛选 + 列排序
- 资金流水：入金 / 出金 / 股息 / 权利金 / 修正分色标注，权利金不计入入金
- 现金管理：入金 / 出金 / 现金修正 / 股息记录（股息只记流水，不混入定投指标）
- 纪律打卡：连续定投月份计数 + 操作日志热力图
- 投资规划：收入渐进加码（4 阶段）、47 岁退出策略、提款模拟器
- 年度再平衡：换仓 / 注资模式，仅 12 月 31 日解锁执行

**提醒与交互**

- 待办提醒（移动端右上角铃铛、或快捷操作面板）：已卖 Call 覆盖情况与行权价逼近告警、期权 ≤3 天到期或已过期提醒（可「今天不再提醒」）、本月定投差额提示
- 记录页搜索：按标的 / 日期 / 金额搜索，自动展开命中的卡片
- 删除类操作统一走确认弹窗 + **8 秒可撤销** Toast
- Toast 毛玻璃 + 弹性弹入；成功 3 秒、普通提示 2.5 秒
- 按钮 / 卡片统一按下反馈（`scale(.97)`）、输入框聚焦自动滚入视口（键盘不挡正在填的格子）
- 表格表头 sticky 吸顶

**数据与安全**

- Cloudflare D1 云端同步：改动后约 0.7 秒自动推送、页面打开自动拉取、支持手动上传 / 下载
- 顶部同步提示胶囊：三态尺寸统一（132×30），靠颜色 + 图标 + 视觉重量区分 —— 同步中「⟳ 正在上传…」、已同步「✓ 已同步 03:30」2.2 秒收起、失败「! 同步失败」（红色光晕 + 中心放大，8 秒收起；重试在顶部横幅里）
- 删除、撤销类操作立即推送；退出页面时对未同步的改动补发一次，下次打开自动续传
- 冲突处理：收到 409 先自动核对云端内容，确实不一致才弹窗，可逐键选择「保留本地 / 使用云端」，或一键「全部保留本地」覆盖云端
- 数据健康面板：最近同步时间、失败次数、待同步项数、冲突状态
- JSON 导出 / 导入（导入做归一化校验：类型强制 + 补 id）
- Schwab CSV 拖拽导入
- 存储 schema 版本 + 迁移链（数据结构变更自动升级，失败上报而不中断启动）
- 前端错误上报：`window.onerror` / `unhandledrejection` → `POST /api/log` → D1 `logs` 表
- 启动失败中文兜底页 + 「复制诊断信息」按钮
- Worker 安全加固：API key 白名单 + value 大小限制、行情代码白名单、symbol 正则防注入、限流

---

## 技术栈

| 层 | 实现 |
| --- | --- |
| 前端 | 原生 HTML/CSS/JS（无框架）。源码模块化在 `src/app/`，esbuild 打包成单文件产物 `public/assets/app.js` |
| 后端 | Cloudflare Worker（`src/worker.js` + `src/lib/`） |
| 存储 | localStorage（带 schema 版本与迁移链），键常量集中在 `src/app/store.js` |
| 行情 | Yahoo Finance（Worker 代理绕 CORS），失败降级东方财富，支持手动录入并标注来源 |
| 同步 | Cloudflare D1（单 token 鉴权 + 版本冲突检测） |
| 部署 | Cloudflare Workers（静态资源由 `ASSETS` binding 提供） |

---

## 本地开发

```bash
npm install
npm run dev          # = npx wrangler dev，本地 Worker（含 /api）
npm run preview:lan  # 局域网静态预览，手机可访问（调移动端用）
```

## 常用命令

```bash
npm run build        # 打包 src/app/* → public/assets/app.js（改完前端必跑）
npm test             # 单元测试（85 项）
npm run lint         # 语法检查 + !important 预算守卫（当前上限 1609，只减不增）
npm run bump         # 版本号 +1（改 5 处）→ 重新打包 → 跑测试
npm run deploy       # 构建 + 部署到 Cloudflare（不会漏构建）
npm run check        # test + build + wrangler deploy --dry-run
```

## 部署

```bash
npm run deploy
```

---

## 文件结构

| 路径 | 作用 |
|------|------|
| `public/index.html` | 页面骨架（HTML + 少量内联样式） |
| `public/guide.html` | 使用文档（网页版，`/guide`） |
| `public/assets/app.js` | **构建产物**，由 `src/app/*` 打包而来，勿直接编辑 |
| `public/assets/main.css` | 样式（手写） |
| `public/sw.js` | Service Worker（network-first，版本号与页面一致） |
| `public/manifest.json` | PWA 配置 |
| `public/icon.png` | 应用图标 |
| `src/worker.js` | Worker 入口（路由 + 鉴权 + 限流） |
| `src/lib/` | 后端模块：auth / assets / http / price / sync / logs / rate-limit |
| `src/app/` | **前端源码**：`index.js`（页面逻辑）+ calc / util / store / sync / render / rows / time |
| `scripts/` | bundle / bump / lint / build / lan-preview + e2e 与专项测试脚本 |
| `tests/` | 单元测试（`node --test`，85 项） |
| `schema.sql` | D1 建表语句 |
| `wrangler.toml` | Cloudflare Workers 配置 |
| `INVESTMENT_STRATEGY.md` | 投资策略定义（AI 助手读取） |
| `maintenance.md` | 维护指南 + 代码结构速查 + 排障 |

---

## 测试体系

| 层级 | 命令 | 覆盖 |
| --- | --- | --- |
| 单元测试 | `npm test` | 85 项：工具函数、持仓计算与成本结转、存储容错、迁移链、同步 payload 与 409 分类、转义安全、时区与交易日 |
| 端到端回归 | `node <cdp.mjs> --file scripts/e2e-full.mjs` | 47 项：仪表盘 / 操作台 / 期权 / 记录页 / 侧边栏 / 主题 / 响应式 |
| 专项验证 | `scripts/test-options.mjs` 等 | 期权行权与结算、备份往返、分析卡片数值与手算比对 |

> e2e 脚本依赖调试专用 Chrome（端口 9222）与 `npm run preview:lan` 起的本地服务，用法见 `.codex/skills/chrome-debug`。

---

## 数据备份

- **自动备份**：开启后每次数据保存自动下载 JSON 并记录时间
- **JSON 手动导出 / 导入**：含交易、现金、流水、期权、参数、主题；导入做归一化校验
- **Schwab CSV 导入**：拖拽或点击选择文件
- **云端同步**：D1 推送 / 拉取，多设备同步 + 冲突处理
- **Git 代码备份**：`git add -A && git commit -m "backup" && git push`

首次使用检测到无数据时，会提示导入备份或从云端下载。

---

## 首次部署

```bash
# 1. 克隆仓库
git clone https://github.com/ssp1213886/wealth-tracker.git
cd wealth-tracker

# 2. 安装依赖
npm install

# 3. 创建 D1 数据库
npx wrangler d1 create wealth-db

# 4. 初始化表结构
npx wrangler d1 execute wealth-db --file=schema.sql

# 5. 将 d1 create 输出的 database_id 填入 wrangler.toml 的 database_id 字段

# 6. 设置 AUTH_TOKEN（用于 API 鉴权，任意随机字符串）
echo "YOUR_SECRET_TOKEN" | npx wrangler secret put AUTH_TOKEN

# 7. 构建 + 部署
npm run deploy
```

## License

MIT
