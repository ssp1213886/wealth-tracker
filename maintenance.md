# 维护与部署指南

个人投资仪表盘（wealth-tracker）长期维护文档。

---

## 项目结构（v140 起）

```
wealth-tracker/
├── public/                        ← 静态资源与构建产物
│   ├── index.html                 → 页面骨架（HTML + 内联样式片段）
│   ├── guide.html                 → 使用文档网页版
│   ├── assets/
│   │   ├── app.js                 → 【构建产物】前端单文件（勿直接编辑）
│   │   └── main.css               → 样式
│   ├── sw.js                      → Service Worker
│   ├── manifest.json              → PWA 配置
│   └── icon.png                   → 应用图标
├── src/
│   ├── worker.js                  → Worker 入口（路由 + 限流 + 鉴权）
│   ├── lib/                       → 后端模块
│   │   ├── auth.js  assets.js  http.js
│   │   ├── price.js               → 行情代理（Yahoo + 东方财富兜底）
│   │   ├── sync.js                → D1 同步读写
│   │   ├── logs.js                → 前端错误上报落库
│   │   └── rate-limit.js
│   └── app/                       → 【前端源码】改代码改这里
│       ├── index.js               → 页面逻辑（DOM / 交互 / 页面级渲染）
│       ├── calc.js                → 持仓聚合、成本结转、盈亏
│       ├── util.js                → 纯工具函数
│       ├── store.js               → 存储 key、安全读写、数据迁移
│       ├── sync.js                → 同步 payload 组装、错误分类
│       ├── render.js              → 独立渲染工具（转义、空态、提醒条）
│       ├── rows.js                → 列表行 HTML 生成（纯函数）
│       └── time.js                → 时区与交易日换算
├── scripts/
│   ├── bundle.mjs                 → esbuild 打包（src/app → public/assets/app.js）
│   ├── bump.mjs                   → 版本号升级（一条命令改 5 处 + 构建 + 测试）
│   ├── lint.mjs                   → 语法检查 + 样式债预算守卫
│   ├── build.mjs                  → 产物完整性校验
│   ├── lan-preview.mjs            → 局域网静态预览
│   ├── e2e-full.mjs               → 全站回归（47 项）
│   ├── manual-e2e.mjs             → 真实操作走查（11 步 + 截图）
│   ├── test-options.mjs           → 期权行权/结算/退回专项
│   ├── test-backup.mjs            → 备份导出导入专项
│   └── test-analytics.mjs         → 分析卡片数值专项
├── tests/                         → 单元测试（node --test）
├── schema.sql                     → D1 建表语句
├── package.json  wrangler.toml
├── INVESTMENT_STRATEGY.md         → 投资策略定义（AI 助手读取）
├── readme.md                      → 项目首页说明
└── maintenance.md                 → 本文档
```

> **关键认知**：`public/assets/app.js` 是 esbuild 的**构建产物**，永远不要直接编辑它。
> 前端逻辑在 `src/app/*`，改完必须构建（`npm run build`），否则改动不会生效。

---

## 日常命令

```bash
npm run build        # 打包 src/app/* → public/assets/app.js
npm test             # 单元测试（项数以输出为准）
npm run lint         # 语法检查 + 样式债守卫（!important 只减不增、:hover 必须包裹）
npm run audit        # 静态审计：死 id / 死按钮 / 未导出的 inline onclick（纯 Node，CI 会跑）
npm run e2e          # 端到端：无头 Chrome 跑爬查 + 数据流 + 交互流（不弹窗、不占用调试窗口）
npm run test:all     # 上面四项串起来跑一遍（单测 → lint → 审计 → e2e）
npm run bump         # 版本 +1：改 5 处版本号 → 重新打包 → 跑测试
npm run deploy       # 构建 + 部署到 Cloudflare（不会漏构建）
npm run preview:lan  # 局域网预览（手机可访问）
npx wrangler dev     # 本地 Worker 调试（含 /api）
```

### 发布流程

```bash
npm run bump                    # 一条命令升版本 + 构建 + 测试
git add -A && git commit -m "..."   # 提交
npm run deploy                  # 部署
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push origin main
```

> 本机 git 与部分外网请求需要走代理（见上行命令），否则会超时。

---

## 测试体系

四层，各有用途：

| 层级 | 命令 | 覆盖 |
| --- | --- | --- |
| **单元测试** | `npm test` | 工具函数、持仓计算、存储容错、迁移链、同步 payload、样式债守卫、转义安全、时区边界 |
| **静态审计** | `npm run audit` | 死 id（JS 引用了不存在的元素）、死按钮（渲染了但没监听器）、inline onclick 未导出到 window；纯 Node，**CI 会跑** |
| **端到端（无头）** | `npm run e2e` | 全页爬查零报错 + 数据流（买入/入金/卖 CALL 落库并同步）+ 交互流（搜索过滤/清空撤销/期权结算/备份结构）；自带假云端，**不碰生产数据** |
| **专项验证** | `scripts/test-*.mjs`、`scripts/e2e-full.mjs` | 期权行权与结算、备份往返、分析卡片数值、47 项全站回归 |

> `npm run e2e` 默认用**无头 Chrome**（`scripts/e2e/driver.mjs`）：不弹窗、不占用你正在用的调试窗口，也不弹原生确认框。
> 需要亲眼看画面时：`E2E_USE_DEBUG_CHROME=1 npm run e2e`（这时才依赖调试专用 Chrome + `scripts/e2e-full.mjs` 那套 cdp 驱动）。
> 假云端见 `scripts/e2e/mock-cloud.mjs`（`/_log` 看它收到了什么、`/_reset` 清空）；每个场景开始前都会 reset，避免互相污染。

### 完整测试矩阵（v239 收尾时全量跑过一遍）

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | **153 项全绿** |
| 样式债守卫 | `npm run lint` | `!important 1608/1608 · :hover 15/15` |
| 静态审计 | `npm run audit` | 死 id / 死按钮 / 未导出 onclick / 空 catch 均为 0 |
| 端到端（无头） | `npm run e2e` | 爬查零报错 + 数据流 + 交互流，3/3 |
| 端到端（CI 自动） | push 后由 `.github/workflows/ci.yml` 的 `e2e` job 跑（假云端 + runner 自带 Chrome，`npm i --no-save playwright-core`） | 与本地同一套场景 |
| 全站回归（46 项起） | `E2E_PORT=8788 npm … 然后 node scripts/e2e/driver.mjs --file scripts/e2e-full.mjs` | **47/47** |
| 专项：期权 | `… --file scripts/test-options.mjs` | 5/5（行权拦截、行权成交、删除退权利金、到期结算） |
| 专项：备份 | `… --file scripts/test-backup.mjs` | 5/5（导出→清空→导入，含 watchlist） |
| 专项：分析卡 | `… --file scripts/test-analytics.mjs` | 数值与回撤正常，无报错 |
| 渲染回归 | `style-fingerprint.mjs` 对比重构前构建 | **四种组合 0 差异**（用 git worktree 拉出 v233 构建对比） |
| 线上冒烟 | `E2E_BASE=<线上域名> … prod-smoke.mjs` | 版本号/关键区块/无报错，通过 |

> 这套矩阵就是 v234–v239 拆分的安全网：抓到了 2 个真回归（持仓分组谓词、`renderSyncHealth` 悬空变量），
> 其中第二个是仓库里既有的 `e2e-full.mjs` 抓到的——所以每次大改都值得把整张表跑一遍。
>
> 补充（v244 教训）：验证要用**带种子数据**的路径。当时 charts 抽取漏了一处别名（`heatColor is not defined`），
> 空数据启动不会走到那段代码，是我的空探针漏掉的；而 e2e 场景都先写种子数据，一跑就全长红。排查时优先看带数据的场景。

### 截图调试的两个坑（踩过两次）

1. **页面有 `scroll-behavior: smooth`**：`scrollIntoView` 是动画，Playwright 的 `page.screenshot()` 会一直等"元素稳定"直到超时（日志停在 `fonts loaded` 之后）。截图前先 `document.documentElement.style.scrollBehavior='auto'` + 给滚动容器也设 `auto`。
2. **Service Worker 对 `/assets/*` 是 cache-first**：改完 CSS/JS 直接重载，页面跑的还是旧产物（会出现"改了没效果"的假象）。脚本里必须先 `navigator.serviceWorker.getRegistrations()` 全部 unregister + 清 `caches`，再带 `?t=时间戳` 重新打开。

> 另外 `page.screenshot()` 在**期权页**仍偶发超时；这种时候用 CDP 的 `Page.captureScreenshot`（可 `clip` 到指定区域）更稳。

### ⚠️ 调试专用 Chrome 里绝对不要留生产 token

调试配置目录（`C:\Users\topeasejs\ChromeDebug\profile`）会**按 origin 分别存 localStorage**。曾经因为"生产站点"那份 `wealth_sync_cfg` 还带着真实 token，只是**打开了一下线上页面**，就触发了一次真实上传：调试副本里过期的 `activities`（操作日志）和 `prices` 被推到了生产云端，覆盖掉用户真实的操作日志。

**规则**：
1. 用调试 Chrome 验证线上页面之前，先在该 origin 下把 `wealth_sync_cfg` 的 token 置空（`{"url":"","token":""}`）；只在需要测云端同步时临时填回，用完立刻清。
2. 每个 origin 都要清（`127.0.0.1:8788` 与 `wealth-tracker.ssp2180481336.workers.dev` 是两份独立存储）。
3. 万一把某个键写坏了，**别急着用缓存值回写**：先想"客户端哪里还有正确副本"。正确做法往往是**删掉该行**（`DELETE FROM data WHERE key='…'`）——客户端拉到"云端没有这一行"会保留本地并标记待推送，于是本地（正确的）那份会在打开 App 后自动推回去。见 v141 的"云端没有该行不判冲突"。

---

## 代码约定（血泪教训）

### 1. 改 `src/app/index.js` 里的函数：用括号配对，不要用正则

这个文件是压缩风格，同一行里可能挤着多个函数。用正则 `function xxx\([\s\S]*?\n\}` 去匹配函数体会**越界删多代码**——历史上发生过两次，最严重的一次产物从 126KB 掉到 75KB。

**正确做法**：用脚本里的括号配对扫描器（跳过字符串/模板串/注释/正则字面量），并在替换后校验：
- `node --check src/app/index.js`
- **产物大小突变就是危险信号**（正常在 165–180KB）

### 2. 不要新增 `!important`

`npm run lint` 会输出并校验 `!important` 数量（当前基线 1608，**只减不增**：想加一条就得先还掉一条）。需要覆盖既有样式时，用更具体的语义选择器（如 `#tab-data #holdBody td[data-cell="pnl"]`），而不是堆 `!important`。同一条 lint 还会拦"没包在 `@media (hover:hover) and (pointer:fine)` 里的 `:hover`"（触摸端会粘住高亮）。

### 3. 改完必须构建

前端源码改了但没 `npm run build`，线上不会有任何变化。

### 4. 新增纯逻辑请放模块并补测

能写成"输入 → 输出"的逻辑（计算、格式化、行渲染）都应该放到 `src/app/*.js` 并配单测。目前纯函数模块的单测覆盖率是这一块最可靠的部分。

### 5. 小字颜色必须过 AA 对比度

提示条、健康行这类 11px 小字的文字色要满足 **≥4.5:1**（WCAG AA）。实测过一轮：浅色模式下用纯 `var(--red)` 只有 3.97:1，`暖阳` 配色下纯 `var(--accent)` 只有 4.07:1。做法是**把状态色与 `var(--fg)` 混合**（如 `color-mix(in srgb,var(--accent) 68%,var(--fg))`），浅色自动加深、深色自动提亮。改配色相关样式后请按"5 套配色 × 明暗 × 状态"重测一遍，当前最低 5.45:1。

---

## 可观测性：出错了怎么查

### 前端错误上报

`window.onerror` 与 `unhandledrejection` 会自动 `POST /api/log`，落库到 D1 的 `logs` 表（自动建表，只保留最近 200 条，同一错误 5 分钟内只报一次）。

```bash
npx wrangler d1 execute wealth-db --remote --command "SELECT id, version, message, ua FROM logs ORDER BY id DESC LIMIT 20"
```

日志里带 `APP_BUILD` 版本号，可以直接定位是哪次发布引入的问题。

### 用户侧的兜底

启动失败时会显示中文兜底页，包含错误摘要和「复制诊断信息」按钮（复制版本 / 时间 / URL / UA / 最近错误），用户可以直接把这些信息发过来。

### 同步状态

侧边栏「数据健康」区显示：最近同步时间、失败时间、待同步项数、冲突数。状态来自 `wealth_sync_state`。

页头下方还有一个**同步提示胶囊**（`#syncBar`）：同步中 / 已同步 / 失败三态，由 `syncFetch` 包装层统一驱动，改动同步逻辑时不要绕过它。

> 形态约定：`position:fixed` 居中悬浮（`left:50%` + `translate3d(-50%,…)`），**不占文档流**——早期版本是流内的一条，出现时会把页面顶下去 38px，已改掉。最大宽度 `calc(100vw - 132px)`，保证永远不压到左上角的 ☰（占位 12→52px）。
>
> **三态一律 132×30，尺寸不随状态变化**（早期宽度随文案变，出现 113/136/176 三种尺寸，看着忽大忽小）。区分阶段靠三重通道：颜色（中性灰 / 主色 / 红）、图标（⟳ / ✓ / !）、**视觉重量**（成功细阴影 `0 4px 14px .10`、进行中常规 `0 8px 22px .14`、失败红色光晕 `0 0 0 3px` + 中心 `scale(1.04)` + 更深阴影）。`scale` 是中心缩放，**布局尺寸不变**，所以不会左右外扩抖动。
>
> **胶囊里不放按钮**：失败的可操作出口是顶部失败横幅（重试 / 导出备份）与侧边栏数据健康。曾经在胶囊里放过"重试"，结果被按钮撑宽到 165px（比其它两态宽 33px），破坏了三态一致。时间：成功 2.2 秒、失败 8 秒自动收起，进行中常驻到有结果。
>
> 改样式后请复测：出现时位移必须为 0、与 ☰ 不重叠、三态布局尺寸一致、三态对比度 ≥4.5:1。

**同步反馈的分工（v144 收敛后的约定）**：一个事件只占一个通道。

| 信息 | 通道 |
| --- | --- |
| 用户主动动作的结果（保存/删除/导出） | 底部 toast（可带撤销） |
| 自动化同步的进行中 / 成功 | 顶部提示条 |
| 同步失败 | 顶部提示条变红 + 常驻失败横幅（唯一可重试的出口） |
| 当前是否一致（待同步 N 项 / 冲突） | 移动端状态栏一个词 + 数据健康 |

> toast 只有一个 DOM 槽（`#syncToast`），且**撤销条 8 秒内独占**（`if(t._undoActive&&!undoFn)return`）——所以"删除后立刻关页面"这种最需要同步反馈的场景，toast 通道是被锁住的，同步状态绝不能只靠 toast。

### 云同步的三条不变量（v141 修复的问题都出在这里）

1. **时间戳只用毫秒**：云端 `updated_at` 与本地 `cloudTs` 必须是同一单位。历史上客户端把响应 `ts` 截断到秒（`Math.floor(ts/1000)`），导致下次拉取永远认为"云端变过"，配上本地待同步标记就成了**假冲突**。归一化统一走 `normalizeSyncTs()`。
2. **没有基准就不带期望值**：`__expectedVersions` 只在"确实知道云端版本"时才带。带 `0` 等于告诉服务端"我期望这一行不存在"，而它存在 → 必然 409。云端没有这一行时，服务端也不再判冲突（`src/lib/sync.js`）。
3. **关页面的补推不带版本戳**：`flushDirtyOnHide()` 只发有改动的键，且按"本地为准"覆盖；否则用户自己的上一次推送会把版本号顶掉，下次打开就弹冲突。

另外：上传是**串行**的（`pushInFlight`/`pushQueued`），并发上传会让后一次带着过期版本号。收到 409 时先 `healPushConflict()` 拉云端比内容，内容一致就静默对齐，不一致才弹冲突。

---

## 数据与迁移

### 存储 key（统一在 `src/app/store.js` 的 `KEYS`）

| 常量 | key | 内容 |
| --- | --- | --- |
| `dashboard` | `wealth_dashboard_v2` | 投资参数与主题 |
| `trades` | `wealth_trades_v2` | 交易记录 |
| `cash` | `wealth_cash_v2` | 累计净投入（注意：不是"当前余额"） |
| `cashLog` | `wealth_cashlog_v2` | 资金流水 |
| `options` | `wealth_options_v2` | 期权持仓 |
| `prices` | `wealth_prices_v2` | 行情缓存 |
| `activity` | `wealth_activity_v1` | 操作日志 |
| `syncState` / `syncConfig` | `wealth_sync_state` / `wealth_sync_cfg` | 同步状态 / 连接配置 |
| `recordsSegment` | `wealth_records_segment_v1` | 记录页上次停留的分段 |
| `optPing` | `wealth_opt_ping_v1` | 期权到期提醒的"今天不再提醒" |
| `firstTime` / `schema` | `wealth_first_time` / `wealth_schema_v1` | 首启引导 / 数据版本 |

### 数据结构变更怎么加

`store.js` 里有 `DATA_SCHEMA` 与 `runMigrations()`，迁移链按版本号索引（**当前 `DATA_SCHEMA = 2`**）：

```js
export const DATA_SCHEMA = 2;
const steps = {
  1: () => removeKey(KEYS.alertSeen),   // v1 → v2
  // 2: () => { /* v2 → v3：改字段名 / 补默认值，同时把 DATA_SCHEMA 改成 3 */ },
};
```

启动时会自动补齐，失败会通过上报接口记录而不是中断启动。

### 备份与恢复

- 侧边栏「数据与备份」→ 导出 JSON（含交易/现金/流水/期权/设置/主题/行情缓存）
- 导入时会做归一化校验（类型强制、补 id）
- 云端恢复（应急）：`POST /api/sync`，**只提交白名单键**（`trades/cashBalance/cashLog/state/activities/optionTrades/otmSettings/exit_portfolio/prices`），未提交的键（如 `notes`）会保持原样
- v142 已删除 D1 里 `notes`、`options` 两行遗留数据（旧版功能残留，不在白名单、`updated_at` 是秒级）。D1 现在只剩上面 9 个白名单键；排查时可先核对 `SELECT key, updated_at FROM data` 是否为 9 行。

> ⚠️ `cashBalance` 这个字段存的**不是"当前余额"，而是"累计净投入"**。
> 可用现金 = `cashBalance + 卖出额 − 买入额`（见 `getNetCash()`）。手工改数据或做导入时务必注意。

---

## 常见故障

| 症状 | 排查 |
| --- | --- |
| 页面白屏 / 启动失败 | 看兜底页的错误摘要；查 D1 `logs` 表；清缓存重载 |
| 改了代码但线上没变 | 是否漏了 `npm run build`；SW 缓存用 `?v=版本号` 强制刷新 |
| 侧边栏显示"N 项待同步" | 有改动未推送；点设置里的「上传」，或再改一次数据触发自动推送 |
| 提示"云端已有更新，请确认冲突" | 冲突选择弹窗里逐键选「保留本地 / 使用云端」，或点「全部保留本地」覆盖云端 |
| 行情不更新 | 价格走 Worker 代理（Yahoo 优先，失败降级东方财富），查 `/api/price?symbol=VGT&range=1mo` 的返回 |
| 存储空间不足 | 会弹提示；导出备份后清理旧记录 |

---

## 设计参考（改 UI 前先对照）

这三份是用户指定的参考，改控件 / 动效 / 移动端手感时按它们检查，不要凭个人偏好：

| 参考 | 用法 |
| --- | --- |
| `mobile-native` · [github.com/emilkowalski/skills](https://github.com/emilkowalski/skills) | 手机端"像原生 App"的硬规则：**输入框字号 ≥16px**（低于 16px 时 iOS 聚焦会缩放整个页面）、按压反馈放在 `:active`/`pointerdown` 而不是 `click`、`:hover` 必须包在 `@media (hover:hover) and (pointer:fine)` 里、`100dvh`、`overscroll-behavior`、`env(safe-area-inset-*)` 配 `viewport-fit=cover`、控件文字不可长按选中 |
| `apple-design` · 同一仓库 | Apple 式判断标准：**同外观必同行为**、每个间距/时长/对齐值都要能解释（"没有任何一个值可以是随意的"）、材质与层级（浅色半透明不要叠浅色半透明）、字号相关字距、`prefers-reduced-motion / -transparency / -contrast` 的降级 |
| [beautifului.dev](https://www.beautifului.dev/) | 组件库的控件令牌：`--radius-control/-card/-chip` 分档、hairline ring（半透明 1px 而不是硬边框）、`font:inherit`、`focus-visible` 用 ring 不用 outline |

> 已落地：v149 统一了表单控件 —— 全站输入框 `font-size:16px`（修掉筛选下拉 10.88px 导致 iOS 缩放页面的 bug）、select 自绘线性 chevron、日期图标线性化（深色反色）、隐藏数字框桌面上下箭头、输入框边框改半透明 hairline、定投起点由 `input[type=month]`（iOS 不支持）改成 年/月两个下拉。

## 当前版本

线上地址：https://wealth-tracker.ssp2180481336.workers.dev
分支：`main` · 版本：见 `public/sw.js` 第一行

### 近期版本要点

| 版本 | 内容 |
| --- | --- |
| v112–v117 | 记录页三张卡片改为信息卡布局、方向标签、去现价列、资产色统一（VGT 紫） |
| v118–v119 | 期权「距现价」移位修截断；侧边栏甜甜圈配色统一 |
| v120–v121 | 卡片内细节统一（卡中卡圆角、标签、数值、按钮阴影）；聚焦自动滚入视口、按下反馈统一 |
| v122–v125 | 期权到期提醒（可当天忽略）；现金汇总改「累计」并去掉冗余负号 |
| v129–v131 | 引入 esbuild 构建链路与前四个模块（util/calc/store/sync） |
| v132–v133 | 模块化继续（并补 17 个单测） |
| v134–v138 | 错误上报 + 中文兜底页 + 数据迁移链；渲染层拆分（render/rows/time） |
| v139 | **删除 `beforeunload` 自动推送**（原来可能用空数据覆盖云端） |
| v140 | **手动上传接入 409 冲突处理**（原来只提示"同步失败"） |
| v141 | **修掉假冲突链路**：云端版本号单位统一为毫秒、不知道版本时不发 `__expectedVersions`、云端没有该行不再判冲突、409 先自动核对内容；删除/撤销立即推送 + 关页面补推（仅脏键）；推送串行化；新增顶部同步提示条 |
| v142 | 侧边栏「数据健康」新增**上次成功推送**时间；清理 D1 中 `notes`/`options` 两行遗留数据 |
| v143 | 数据健康顺序调整为「最近云同步 → 上次成功推送 → 最近备份 → 冲突状态」；同步提示条文字色改为与前景色混合，5 套配色 × 明暗下对比度全部 ≥5.45:1（浅色错误态原来只有 3.97:1） |
| v144 | 同步反馈收敛：自动上传成功不再弹 toast（交给提示条），去掉设置面板圆点；数据健康拆成「最近成功下载 / 上次成功上传」两条独立通道（新增 `lastPullAt`），失败不再占用时间行 |
| v145 | 同步提示条改为**居中悬浮胶囊**：覆盖式不推内容（原先把页面顶下去 38px）、固定宽度避开 ☰、三态加图标区分（转圈 / ✓ / !）、成功停留 1.6→2.2 秒；实测三态对比度浅色 15.35/6.86/5.82、深色 12.49/7.65/6.56 |
| v146 | 胶囊**三态尺寸统一**：图标盒一律 13×13（转圈改成在盒内画 11px 的环，原来只有 11px 显得比对勾小）、`min-width:132px` + 内容居中、文案统一缩短（正在上传…／正在下载…／同步失败）。实测三态均为 **132×30**（原 113/136/176），位移仍为 0 |
| v147–v148 | 加回"用大小暗示紧急度"的直觉但不动几何：失败态红色光晕 + 中心 `scale(1.04)`（视觉 137×31，布局仍 132×30）、成功态最轻、进行中居中；并**移除胶囊内的重试/关闭按钮**（原本把失败态撑到 165px），失败的可操作出口统一到横幅与数据健康，失败态 8 秒后自动收起 |
| v149 | **表单控件统一**（对齐 mobile-native / apple-design / beautifului）：全站输入框字号 ≥16px（修掉筛选下拉 10.88px → iOS 聚焦缩放页面的 bug）、筛选下拉 36→44px/圆角 12、select 自绘线性 chevron、日期日历图标线性化（深色反色）、隐藏桌面数字箭头、输入框边框改半透明 hairline、`background:` 简写改 `background-color`（否则会重置自绘箭头）、定投起点由 `input[type=month]`（iOS Safari 不支持）改为 年/月两个下拉 |
| v150–v151 | 侧边栏底部显示**构建版本号**（`#sbBuild` ← `APP_BUILD`，用户可自行确认手机跑的是哪一版，排查"改了没生效"先看它）；日期图标 18→16px、右侧留白 11→19px |
| v152 | **修 iOS 日期框挤到相邻字段**：iOS 的 `input[type=date]` 有最小固有宽度，栅格项默认 `min-width:auto` 不肯收缩，于是"到期日"顶进"张数"。处理：① 栅格项 `min-width:0`；② `@media (pointer:coarse)` 下日期框改 `appearance:none` + 自绘线性日历图标（同时隐藏原生日历按钮），彻底去掉固有宽度。**已知取舍**：触摸端不再用 iOS 原生日历按钮，点字段仍应弹原生日期滚轮（待真机确认） |
| v153 | 触摸端日期框**有值时隐藏自绘日历图标**（`class="has-val"`，由 `input`/`change` 委托维护）——否则 iOS 的长日期文本末尾会与图标重叠；真机已确认 iOS 弹原生日期滚轮正常 |

### 已知未修问题

1. ~~新用户现金为 0 时录入买入会被拦，提示未引导"先去入金"~~ → v242：提示会说明差额，并**自动跳到「现金管理」入金输入框**
2. ~~同步设置是三层嵌套，入口偏深~~ → v242：点侧边栏「数据健康」任意一行即可直达（移动端会自动打开设置面板并展开「云端同步」）
3. `main.css` 仍有 **1605 个 `!important`**（基线只减不增）——这是最大的样式债
   > **v241 的三次实验结论（都有指纹验证）**：
   > ① 机械删 `!important`：严格按"手机/桌面 × 明/暗"四种组合验证，1608 个里只有 25 个能零差异删除；
   > ② 同选择器规则合并（构造上安全的那类）：能删 **38 条死声明（含 3 个 `!important`）**，已落地（1608 → 1605）；
   > ③ 完全重复的整条规则：**0 条**。
   > 结构数据：`!important` 里 **247 个在 `@media(max-width:800px)` 覆盖层**，**1361 个在非手机规则里**——所以"把手机覆盖层挪到最后"也解决不了大头。
   > 真正的还债方式是**重写层叠**（把 base 规则里靠 `!important` 压制的写法，换成明确的特异性/变量），属于独立工程；工具已就位：`scripts/e2e/style-fingerprint.mjs` 可在每次改动前后做四种组合的计算样式对比。
   > 已实测：**机械删除走不通**。用四种组合（手机/桌面 × 明/暗）的计算样式指纹逐批验证，1608 条里只有 25 条能在"零视觉差异"前提下直接删掉——其余都在支撑移动端覆盖层（删了桌面就崩）。真正还债要按"合并重复规则组 + 重组覆盖层"来做，属独立工程。
   > 指纹工具已入库：`scripts/e2e/style-fingerprint.mjs`（改 CSS 前后各跑一次，比对 1731 个元素的关键计算样式；`#roadBar` 随时间变化已排除）。
4. `src/app/index.js` 已从 212.3KB 拆到 **158.7KB**（v234–v251 共 17 轮），剩下的主要是**重耦合的渲染型函数**；
   按大小排的下一个候选：`initAll`(6.5K)、`updateRebalance`(4.5K)、`updateAlerts`(3.6K)、`importBackupData`＋`createBackupData`(3.6K，纯逻辑可测)、
   `renderOpt`(2.4K)、`switchTab`(1.9K)、`updateMobStatusBar`(1.9K)、观察列表的搜索面板 UI(~2K)
5. 源码里还有约 60 处 `catch(e){}` 空捕获，失败会被静默吞掉（排查时最容易踩）

> 已修/已过时（v229–v232 期间处理，保留记录避免重复排查）：
> - ~~`forceUploadLocal()` 没有调用点~~ → 实际已接到设置的"强制上传"按钮上
> - ~~观察列表改动不会推送~~、~~操作日志单条删除点不动~~、~~手机端记录页搜索过滤失效~~、~~备份漏观察列表~~ → 均已修复并有 e2e 覆盖
> - ~~JS 引用的死 id / 死代码（sbDonut、pillYear、holdMeta）~~ → 已清理，`npm run audit` 会持续守

### index.js 拆分路线图（进行中）

已完成：

| 版本 | 抽出内容 | 新模块 | 覆盖 |
| --- | --- | --- | --- |
| v234 | 观察列表搜索名单（别名表 62 条 + S&P100∪纳指100 共 167 条）与匹配逻辑 | `src/app/symbols.js` | 6 项单测 + e2e 断言（搜 berkshire 首行必须是 BRK-B） |
| v235 | 策略工具与提款模拟的纯逻辑（默认档位、`readPlan` 归并、就地编辑、提款耗尽年数） | `src/app/plan.js` | 9 项单测 + e2e 断言（档位就地编辑与提款滑杆要写进 `state.plan`） |
| v236 | 记录页的表格搜索匹配与顶部汇总金额（累计入金/买入/卖出） | 并入 `src/app/rows.js` | 4 项单测 + e2e 断言（搜索过滤生效、汇总数字正确） |
| v237 | 观察列表状态机：归属映射（BTCETF↔BTC）、云端**并集**合并、持仓/关注分组 | 并入 `src/app/watch.js` | 5 项单测 + e2e 断言（添加标的 → 落库 + 进关注组 + 推到云端） |
| v238 | 期权纯计算：记录校验、到期状态（美东 16:00 收盘判定）、行内派生值（剩余天数/虚值实值/距现价）、权利金汇总、OTM 建议行权价；`normalizeDateValue` 从 index.js 移到 time.js | 新增 `src/app/options.js` | 10 项单测 + e2e 断言（卖 CALL 后权利金汇总与行内状态正确） |
| v239 | 设置抽屉与云同步面板：面板映射、同步配置解析、数据健康文案判定（冲突>失败>未配置>待同步>正常） | 新增 `src/app/settings.js` | 6 项单测 + e2e 断言（数据健康三行必须渲染） |
| v240 | 同步决策层：拉取逐键判定 `decidePullAction`、整轮拉取计划 `planPullSync`、409 核对计划 `planConflictHeal`、推送脏键与跳过判断 | 新增 `src/app/sync-engine.js` | 10 项单测（覆盖七个判定分支）+ e2e 新增「模拟另一台设备改云端 → 本机自动拉取」 |
| v241 | 样式债：删掉同选择器组内的 38 条死声明（含 3 个 `!important`），`!important` 基线 1608 → 1605；并把"机械删 / 同选择器合并 / 重复规则"三次实验结论写进文档 | `public/assets/main.css` | 四种组合渲染指纹零差异 + 全站回归 47/47 |
| v242 | 两处入口体验：① 现金不足时提示差额并自动跳到「现金管理」入金框；② 侧边栏「数据健康」整块可点直达同步设置（移动端自动打开整屏设置面板并展开「云端同步」） | `src/app/index.js` + `main.css` | e2e 新增两项断言（焦点落到入金框 / 移动端同步面板真的可见）+ 指纹零差异 |
| v243 | 拆分第二轮：**持仓/组合**纯计算（总盈亏与现金占比、今日变动、目标进度、距高点回撤、盈亏摘要；并统一了 `updatePnlSummary` 里重复的成本结转）→ `src/app/portfolio.js`；**记录域**规整与 CSV 导入（白名单/日期归一/id 去重/日志 200 上限、Schwab 表头识别与买卖方向）→ `src/app/records-import.js`；`TRADE_SYMBOLS` 成为唯一白名单来源 | 新增 2 个模块 | 15 项单测（另把两条 smoke 改成新接口）+ 47 项回归 + 四种组合指纹零差异 |
| v244 | **图表数据整形**：纪律热力的月度（完成判定/连续月数/state·icon）、年度矩阵（权利金贡献率/年末持股/CAGR/目标差额）、甜甜圈切片、热力色阶 | 新增 `src/app/charts.js` | 6 项单测 + 47 项回归 + 指纹零差异 |
| v245 | **观察/行情视图模型**：显示名派生（加密品牌名/现货标记/括号剥离）、现价取值优先级、52 周与历史缓存取值、小额价格格式化、搜索结果价格、价格胶囊 HTML | 新增 `src/app/watch-view.js` | 9 项单测 + 47 项回归 + 指纹零差异 |
| v246 | **修 v240 引入的同步回归**：抽取 `planPullSync` 时漏掉了 `saveSyncState(ss)`，拉取算出的 dirty/cloudTs 不再落盘 → 「云端没有该行但本地有数据」不标脏、关页面也不补推（线上 v240–v245 共 6 个版本存在） | `src/app/index.js` + `scripts/e2e/flows-data.mjs` | e2e 新增启动引导断言（关页面后云端必须收到 trades/cashBalance）＋ 四种组合指纹 v233 → v246 从 26 处差异收敛到 0（只剩随时间变化的 `#roadBar`） |
| v247 | **同步视图层**：状态条胶囊（三态类名/图标/停留时长）、数据健康四行（`healthRowStatuses` 判定 + `applyHealthRows` 写入）、失败横幅（显示判定 + 四个出口接线）、冲突弹窗（行 HTML/外壳/单选项读取）、数据健康整块可点跳转；引擎、网络、409 决策一行未动 | 新增 `src/app/sync-view.js` | 17 项单测（纯函数 + 轻量假 doc 钉 DOM 契约）＋ 47 项回归 ＋ 四种组合指纹零差异（只剩 `#roadBar` 时间噪声） |
| v248 | **设置/主题视图层**：主题（翻转/跟随系统/随主题换地址栏配色）、配色圆点、移动端整屏设置抽屉与 aria、桌面设置面板搬移、手机端快捷菜单手风琴、侧栏折叠、触感反馈；顺带把 `logSwallowed` 从 index.js 搬到 util.js（各模块共用一份）；**并清掉 5 个"只定义从不调用"的遗留函数**（`calcPortfolio`＋它专用的 `AD`、`fillTradeForm`、`initSidebarMarketCollapse`、`initSidebarHealthCollapse`、搜索里的 `fmtSmall`） | 新增 `src/app/settings-view.js` | 14 项单测（含假 DOM 钉 aria/类名/落库键）＋ 47 项回归 ＋ 指纹零差异；审计新增「跨模块调用必须 import」守卫（见下） |
| v249 | **观察列表视图层**：行情行渲染（含排序与状态胶囊）、管理面板（勾选/上下移/移除）、排序按钮高亮、更多菜单、刷新触发、行内详情（穿透敞口）；状态与网络留在 index.js，用 `configureWatchUI` 注入（状态走 getter，保证读到最新值） | 新增 `src/app/watch-ui.js` | 10 项单测（假 DOM 钉 innerHTML/胶囊文案/排序）＋ 47 项回归 ＋ 指纹零差异；审计扫描清单补上 new DOM 模块 |
| v250 | **持仓视图层**：把 `updatePortfolio` 里的 DOM 写入整段分出——顶部指标卡、今日涨跌/总盈亏/浮动·已实现·权利金徽章、持仓表、目标进度条、距高点回撤面板、行情胶囊；计算（computeHoldings/portfolioTotals/dailyChange/goalProgress/回撤循环）全部留在 index.js，三个宿主函数（资产色/行情胶囊/金额缩写）用 `configurePortfolioView` 注入 | 新增 `src/app/portfolio-view.js` | 11 项单测（钉数字→文案/类名/进度宽度/空态）＋ 47 项回归 ＋ 指纹零差异 |
| v251 | **侧栏行情行**：`updateSidebarPrices`（价格行 + 迷你走势 + 涨跌配色 + 更新时间文案）与它专用的 `formatChinaTime` 搬进观察/行情视图层；`ETF_SYMS` / `liveQuoteData` 用 host getter 注入，价格缓存键改用 `store.js` 的 `KEYS.prices` | 并入 `src/app/watch-ui.js` | 3 项单测（价格行/涨跌色/走势/等待态、ts→time 迁移、时间文案三态）＋ 47 项回归 ＋ 指纹零差异 |

建议顺序（每步都要过 `npm test` / `npm run lint` / `npm run audit` / `npm run e2e`，动到样式再跑指纹）：

1. ~~策略工具与提款模拟的纯逻辑 → `src/app/plan.js`~~ ✅ v235
2. ~~记录页的行数据整形与筛选排序~~ ✅ v236（`selectTrades`/`selectCashLogs` 早就在 rows.js；这轮把表格搜索匹配与汇总金额也搬了过去，并统一了"入金"判定口径）
3. ~~观察列表状态机 → `watch.js`~~ ✅ v237（增删改排序本来就在 watch.js；这轮把归属映射、云端并集、分组也搬了过去）
4. ~~期权纯计算 → `src/app/options.js`~~ ✅ v238
5. ~~设置抽屉与同步条 → `src/app/settings.js`~~ ✅ v239（DOM 事件绑定仍留 index.js，纯逻辑已抽出）
6. ~~同步视图层（状态条 / 数据健康 / 失败横幅 / 冲突弹窗）→ `src/app/sync-view.js`~~ ✅ v247
   （只搬渲染：判定用 `sync-engine.js`、文案用 `settings.js`、状态与网络仍在 index.js）
7. ~~设置/主题视图层（主题/配色/整屏设置抽屉/面板搬移/手风琴/侧栏折叠/触感）→ `src/app/settings-view.js`~~ ✅ v248
   （`refreshVisualPalette` 这类依赖渲染函数的钩子用 `configureSettingsView()` 注入）
8. ~~观察列表视图层（行情行/管理面板/排序/更多菜单/行内详情）→ `src/app/watch-ui.js`~~ ✅ v249
   （状态与网络仍在 index.js：`configureWatchUI()` 注入 getter + `saveWatch`/`refreshMarket` 回调）
9. ~~持仓视图层（指标卡/盈亏明细/持仓表/目标进度/回撤面板/行情胶囊）→ `src/app/portfolio-view.js`~~ ✅ v250
   （只搬 DOM 写入；计算仍全在 index.js，`configurePortfolioView()` 注入资产色/行情胶囊/金额缩写）
10. ~~侧栏行情行（价格行/迷你走势/更新时间）→ 并入 `src/app/watch-ui.js`~~ ✅ v251

> v247 的副作用之一：`scripts/audit/static.mjs` 的扫描清单要跟着 DOM 模块走。
> 新模块里 `modal.id = 'conflictModal'`（带空格）没被"动态创建"的正则认出来，于是报成死 id。
> 已修：把 `sync-view.js` 加进扫描清单，并让 `.id = "x"` 这类带空格的写法也能识别；
> 顺手用"注释里塞一个假 id"验证过审计仍抓得住真问题（v247 起，DOM 模块拆出去时记得同步这个清单）。
>
> v248 的另一课：**把函数搬到新模块后，调用点忘了补 import，打包不会报错**（ESM 里那只是个"全局变量"引用），
> 只在运行到那条路径时 ReferenceError。当时是 `switchTab` 里的 `setMobileSettings`，靠 `npm run e2e` 的全页爬查抓到。
> 已加护栏：`scripts/audit/static.mjs` ⑤ —— 名字是别的模块的导出、本文件在调用它、但既没 import 也没本地声明 → 直接报错
> （同样用"临时删掉 import"验证过它抓得住）。
>
> **拆出一个新的 DOM 模块时，固定要改三处**（v247 / v249 / v250 连着踩了三次，已形成清单）：
> 1. `scripts/audit/static.mjs` 的 `appFiles` —— 不加，它引用的 id 会被算成"死 id"，审计数字会凭空掉一截；
> 2. `tests/smoke.test.mjs` 的 `appSource` 拼接 —— 不加，靠源码形状断言的用例会红（v250 的 `drawdown-track` 就是这么红的）；
> 3. `scripts/audit` 的 ⑤ 号守卫会主动提醒漏掉的 import（这条不用改，但一定会响）。

**拆分收尾（v234–v239）**：`index.js` 从 212.3KB 降到 ~199KB，新增 5 个纯逻辑模块（symbols/plan/rows/watch/options/settings），单测从 105 项涨到 153 项。

**收尾时靠"最完整测试"抓到的两个真问题**（都已修，并补了护栏）：
1. **v237 引入的分组回归**：持仓判定被写成"持有市值 > 0"，导致**拿不到现价的持仓行会掉进「关注」组**。靠"重构前后计算样式指纹对比"抓到（v233 → v239 四种组合从 80 处差异收敛到 0）。现在 `splitByHolding` 支持显式传入"是否持仓"谓词，线上传的是"持有股数 > 0"，并补了单测。
2. **v239 改写 `renderSyncHealth` 留下悬空变量**（`configured`/`dirtyCount`/`backupAt` 与状态对象 `s`），运行期 ReferenceError 让同步健康面板与 OTM 步进失效。靠仓库里既有的 `scripts/e2e-full.mjs`（47 项）抓到。同时补上 `crawl.mjs` 的覆盖率漏洞：**启动期**的 console 报错以前不计入失败。

**v246 又靠同一套办法抓到第三个**（v240 引入，潜伏了 6 个版本）：

3. **v240 抽 `planPullSync` 时丢了一行 `saveSyncState(ss)`**。重建后的 `autoPull` 仍然算出 `dirty/cloudTs`，却没写回 localStorage —— 表现是「云端没有该行、本地有数据」时不再标脏、也不再补推（新键/清库后的自愈链路整段失效）。
   - 为什么单测没挡住：`sync-engine.js` 的单测只验证**决策结果**，丢的是调用方的**落盘动作**；而 e2e 的拉取场景断言的是"云端改了 → 本机能拉到"，方向正好相反。
   - 抓到它的方式：**拿 v233（重构前）与当前构建做四种组合的计算样式指纹对照**。同步状态那一簇（`#sbSyncState`／`#msSyncText`／重试与强推按钮的可见性）有 26 处真实差异，逐条回溯到这一行。
   - 护栏：`scripts/e2e/flows-data.mjs` 开头加了「本地有数据 + 云端为空 → 必须标脏，关页面时补推上云」的断言，并**先用含 bug 的旧产物验证过它确实会失败**（改测试必须证明新断言抓得住老 bug）。
   - 教训：**指纹对照要跨"重构前后"两个构建做**，不能只跟上一版比（v244/v245 都是跟上一版比，所以一路零差异却漏了它）。

验收标准：每步做完 `index.js` 明显变小、新模块有单测、e2e 与（动样式时）样式指纹均无差异。
