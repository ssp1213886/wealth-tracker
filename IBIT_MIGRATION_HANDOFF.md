# 交接：把第三腿从 Grayscale BTC ETF（代码 `BTC`）换成 iShares IBIT

> 写给下一个 agent。**先读完本文再动代码**；本文里的"坑"都是已经踩过、并造成过回退的。

## 0. 当前仓库状态（重要）

- `main` = **v372**：`git checkout 67cfc2a -- .` 之后与 v372 **逐字节一致**，**代码里没有任何 IBIT 元素**。
- 第三腿在代码里是 `BTC`（= Grayscale Bitcoin Mini Trust 的美股代码），白名单 `['VGT','SMH','BTC']`。
- 备份分支（改动都在，随时可捡）：
  - `codex/ibit-attempt` —— v373–v383 全套：`1e351ea` 是"换腿 + 数据迁移"的实现，
    `tests/ibit-migration.test.mjs`、`tests/options-delete.test.mjs` 是当时的测试。
  - `codex/v374-core-config` —— 更早那版"标的做成可配置"（用户否掉了，别照抄）。

## 1. ⚠️ 第一步必须先处理数据（否则会丢持仓）

v373 的数据迁移**已经把云端和手机上的历史 `BTC` 记录换算成了 `IBIT`**（股数 ×0.778456、价格 ÷0.778456，
系数 = 36.39 / 46.7454 = Mini Trust 与 IBIT 在 2026-10-09 收盘价之比）。**回退代码不会回退数据**，
而 v372 的 `normalizeTrades` 会把 `IBIT` 当"非白名单标的"**静默丢弃** → 第三腿持仓/成本会消失并被推上云。

两条路，选一条（**先让用户导出一次 JSON 备份**）：

1. **数据回滚成 BTC**（如果这次只是想先把仓库清干净）：
   `shares ÷ 0.778456`、`price × 0.778456`（保持每笔"股数×价格"即成本不变）；
   本机备份键 `wealth_pre_ibit_migration_v1` 里存着**迁移前的原值**（`store.js` 迁移写的，不同步），
   优先用它还原。云端要一起看：`npx wrangler d1 execute wealth-db --remote --command "SELECT key, updated_at FROM data"`。
2. **直接完成换腿**（推荐，用户的目标就是这个）：照 `codex/ibit-attempt` 的 `1e351ea` 重做一遍，
   数据从 IBIT 状态继续走，不用来回换算。

## 2. 要做的事（按顺序，每步先给用户看方案）

### 2.1 换腿（白名单 / 标签 / 映射）

| 位置 | 改法 |
|---|---|
| `src/app/records-import.js` | `TRADE_SYMBOLS = ['VGT','SMH','IBIT']`；**BTC 走别名 + 换算**（见 `1e351ea`），别直接删它——否则旧设备推回来的 BTC 会被丢 |
| `src/app/index.js` | `PRICE_SYMBOLS`、`ETF_NAMES`（`ETF_NAMES` 实际 0 处消费，可删） |
| `src/lib/price.js` | `ALLOWED_SYMBOLS` 加 IBIT（可顺手去掉 BTC → 老客户端会回落到腾讯兜底） |
| `src/app/watch.js` | `WATCH_DEFAULTS` 的 `BTCETF` 行 → `IBIT`；`WATCH_HELD_OF` 里 `BTCETF:'IBIT'`；`labelOf('BTCETF') → 'IBIT'` |
| `src/app/watch-ui.js` | 敞口 extras：**行标写"比特币"**（这一层是底层资产），载体写备注 `IBIT（iShares Bitcoin Trust）· 1:1 跟踪比特币`；徽标映射到 `BTC` |
| `src/lib/quotes.js` | `QUOTE_ALIAS` 的 `BTCETF` → `'IBIT'` |
| `src/app/brand-icons.js` | 加 `"IBIT": "bitcoin"` |
| `src/app/symbols.js` | 删 `BTCETF` 那行、把 IBIT 的中文别名补全（名单条数断言在 `tests/symbols.test.mjs`） |
| 文档 | `INVESTMENT_STRATEGY.md` / `readme.md` 的策略描述 |

### 2.2 数据迁移（`src/app/store.js`）

- `steps[N]` 是"**到达**版本 N 时执行的那一步"（`from=2` 只会跑 `steps[3]`）。我第一次写成 `steps[2]`，
  整段迁移被静默跳过，而 `try/catch` 把空跑一起藏住 → **必须写一条"跑完之后数据必须变成什么样"的单测**。
- 迁移内容：trades 的 `symbol` BTC→IBIT **并按 r 换算股数/价格**；watchlist 的 `BTCETF`→`IBIT`
  （**加密现货那行 `BTC` 不动**）；`prices` 里的 `BTC` 键**删掉**（Mini Trust 的价 ≠ IBIT 的价）；
  迁移前把原值存本机备份键；改完记"动了哪些键"交给 `initAll` 标脏推云。
- ⚠️ 标脏/推云**不能写在模块顶层**：那里 `syncCfg`/`SYNC_STATE_KEY` 还没初始化（实测 `syncCfg.url` 为空），
  要放到 `initAll` 后半段，用 `pushKeysForce`（"强制上传"那条路径）推。

### 2.3 如果要给 IBIT 开 Covered Call

- **标的白名单只在一处定义**：`OPTION_SYMS = ['VGT','SMH','IBIT']`，页面 tab / 到期日历 / 概率矩阵 /
  提醒 / 录入弹层 / Worker 链白名单全部跟着它。
- `src/lib/chain.js` 的 `ALLOWED_SYMBOLS` 加 IBIT（CBOE 有链：实测 3048 张合约、29 个到期日档）。
- `src/app/options.js / normalizeOptions` 的**标的门禁**：原来是 `sym !== 'VGT' && sym !== 'SMH'`
  → 录入 IBIT 会被**静默丢掉**（表现是"记了但持仓里不显示"）。改成 `normalizeOptions(list, symbols)`
  + `allowed.includes(sym)`，调用点传 `OPTION_SYMS`。
- `src/app/prob-view.js / probTabsHtml(current)` 里也写死了 `['VGT','SMH']` → 被行权概率卡看不到 IBIT。
- `public/index.html`：**`#osym` 与 `#tfAsset` 是两个 select，各自都要有 IBIT**（我漏了 `#osym`，
  于是 `asset.value='IBIT'` 被浏览器置空 → 胶囊点了不高亮）。`#divSym`（股息标的）保持 VGT/SMH 即可。
- 节奏与 OTM：IBIT = **every3w + 锚点 2026-10-30**（与 SMH 同一天操作）；OTM 默认 **10%**
  （实测 IBIT 近月 IV ≈36%，SMH ≈32%，按"0.7–0.8σ"对齐）。

## 3. 必须避免的坑（都是踩过的，按代价排序）

1. **改超长行不要用 `node -e`**：PowerShell 会吃掉 `\"`、`$'`、多行模板 —— 一律写**临时脚本文件**跑完即删。
2. **钉子/断言要锚定具体元素**：`assert.match(html, /<option value="IBIT">/)` 会被交易表单满足（假阳性，
   放过了两个版本）；要按 id 抓出那个 `<select>` 再断言内部。
3. **`doesNotMatch` 要排除注释与兜底串**：我三次被自己写的解释性注释打中（注释里提到旧写法）。
4. **改某处"口径/合计"前先贴上下文 + 查消费方**，并给"改动前后数值等价"的断言：我曾把
   `['VGT','SMH'].forEach(...)` + 一行显式加 IBIT（**本来就对**）改成 `ETF_SYMS.forEach(...)`，
   却没删那行显式加 → **IBIT 被算两遍**。
5. **`refreshPrices` 补 history 时不许写 `livePrices`**：价格只有一个来源（quotes 独占），
   否则 `flows-marketcap` 的行情一致性护栏会红。
6. **"写死的字面量"扫描查不出这类问题**：`sym !== 'VGT' && sym !== 'SMH'` 没有数组字面量；
   真正有效的做法是**按功能路径**（录入→保存→渲染→提醒）逐段读。
7. 动同步/启动链路：`npm run e2e` 不是可选项（单测测不出来）。
8. SW 是**内容比对**：`sw.js` 内容变了才会更新；回退版本号靠这一点生效（这次 v372 回退已验证）。

## 4. 被这次回退一起撤掉、但**与 IBIT 无关的真 bug**（建议先补回来）

**删期权 + 删对应权利金流水 → 现金退两次**：`delOpt` 当时是**新写一条「权利金退回-X」**，
原来那条「权利金+X」还在 → 再删它就又退一次。正确口径（对齐 `index.js:111` 那条不变量
"`cashBalance` 恒等于 Σ 现金流水"）：**连带删掉那条权利金流水**，现金只动这一次。
实现与单测在 `codex/ibit-attempt`：`options.js / planOptionDelete` + `tests/options-delete.test.mjs`
（含"删第二次不许再动现金"）。

## 5. 验收清单

- `npm test` / `npm run lint` / `npm run audit` / `npm run e2e` / `npm run e2e:all` 全绿
- iPhone 13 描述符（`node scripts/e2e/driver-engine.mjs --device "iPhone 13" --file <探针>`）走查：
  侧栏曲线 3 条 · 期权页有 IBIT tab · 点 IBIT 胶囊**高亮** · 录一张 IBIT CALL 后**持仓里出现** ·
  年度复盘卡"当前总资产 = 持仓市值 + 现金" · 敞口卡第三腿显示**比特币** · 无 `NaN/undefined` 文本 · 无 console 报错
- 线上核对：`manifest` 的 `start_url`、`sw.js` 第一行版本号
- 每步先给用户方案与"改动前后数值等价"的说明，**推送前汇报**
