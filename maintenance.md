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
npm test             # 单元测试（85 项）
npm run lint         # 语法检查 + !important 预算守卫
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

三层，各有用途：

| 层级 | 命令 | 覆盖 |
| --- | --- | --- |
| **单元测试** | `npm test` | 85 项：工具函数、持仓计算、存储容错、迁移链、同步 payload、转义安全、时区边界 |
| **端到端回归** | `node …/cdp.mjs --file scripts/e2e-full.mjs` | 47 项：仪表盘/操作台/期权/记录页/侧边栏/主题/响应式 |
| **专项验证** | `scripts/test-*.mjs` | 期权行权与结算、备份往返、分析卡片数值 |

> e2e 与专项脚本依赖**调试专用 Chrome**（`C:\Users\topeasejs\ChromeDebug\profile`，端口 9222）和 `npm run preview:lan` 起的本地服务。用法见 `.codex/skills/chrome-debug`。

---

## 代码约定（血泪教训）

### 1. 改 `src/app/index.js` 里的函数：用括号配对，不要用正则

这个文件是压缩风格，同一行里可能挤着多个函数。用正则 `function xxx\([\s\S]*?\n\}` 去匹配函数体会**越界删多代码**——历史上发生过两次，最严重的一次产物从 126KB 掉到 75KB。

**正确做法**：用脚本里的括号配对扫描器（跳过字符串/模板串/注释/正则字面量），并在替换后校验：
- `node --check src/app/index.js`
- **产物大小突变就是危险信号**（正常在 120–126KB）

### 2. 不要新增 `!important`

`npm run lint` 会输出并校验 `!important` 数量（当前预算 1609，**只减不增**）。需要覆盖既有样式时，用更具体的语义选择器（如 `#tab-data #holdBody td[data-cell="pnl"]`），而不是堆 `!important`。

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

> 形态约定：`position:fixed` 居中悬浮（`left:50%` + `translate3d(-50%,…)`），**不占文档流**——早期版本是流内的一条，出现时会把页面顶下去 38px，已改掉。最大宽度 `calc(100vw - 132px)`，保证永远不压到左上角的 ☰（占位 12→52px）。三态靠"颜色 + 图标 + 文案"区分：进行中是中性灰 + 转圈，成功是主色 + ✓（停留 2.2 秒），失败是红 + !（常驻）。改样式后请复测：出现时位移必须为 0、与 ☰ 不重叠、三态对比度 ≥4.5:1。

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

### 已知未修问题

1. 新用户现金为 0 时录入买入会被拦（逻辑正确），但提示未引导"先去入金"
2. 同步设置是三层嵌套（设置 → 云端同步 → 连接配置），入口偏深
3. `forceUploadLocal()` 定义了但没有调用点（死代码）
4. `main.css` 仍有 1609 个 `!important`（有守卫，不再增长）
5. 页面级渲染函数仍与全局状态耦合，未拆出模块
