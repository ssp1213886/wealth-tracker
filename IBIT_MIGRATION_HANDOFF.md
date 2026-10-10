# 记录：第三腿 BTC → IBIT（v384 已完成）

> 状态：**已完成并上线（v384）**。本文从"交给下一个 agent 的交接"改成**完成记录**，
> 保留踩过的坑与完整改动清单 —— 因为**上一版 v373–v383 就是照一份不完整的清单做、连续出 bug 后整体回退的**。

## 0. 结论

第三腿从 Grayscale 的 `BTC`（Bitcoin Mini Trust）换成 iShares 的 **`IBIT`**，
并让 **IBIT 进入 Covered Call**（与 SMH 同节奏）。改动落在 `main` 的 v384。

**关键教训**：这类"把某个标的换成另一个标的"的改动，**写死的字面量扫描是不可靠的** ——
真正有效的方法是**按功能路径逐段读**：录入 → 保存 → 同步 → 渲染 → 提醒 → 备份/恢复。
下面第 2 节的清单是审计过的版本，每一处都对应一个"不改就会在真机上出错"的具体表现。

## 1. 上一版（v373–v383）为什么翻车

| 现象 | 根因 |
| --- | --- |
| 录了 IBIT CALL，**持仓里不显示** | `options.js` 的标的门禁是写死的 `sym !== 'VGT' && sym !== 'SMH'`，IBIT 被**静默丢掉**。当时的交接文档写的是"已改成 `allowed.includes(sym)`"，**实际没改** |
| 年度归因卡出现 `BTC 增值 $0.00 NaN%` | `renderAttribution` 写死读 `r.capGains.BTC`，而 `capGains` 是按 `ETF_SYMS` 生成的（只有 `IBIT`），取到 `undefined` |
| 点 IBIT 胶囊不高亮 | `#osym` 里没有 `<option value="IBIT">` → `select.value = 'IBIT'` 被浏览器置空 → 比对失败 |
| 看着"改了没生效" | 版本号复用了**已经部署过**的号，手机上残留同号缓存 |
| 年度复盘卡数字永远不对 | `switchTab` 开头就把 `'log'` 归一成 `'data'`，后面 `if(tab==='log'){renderAnnualMatrix()}` 是**死代码** → 卡片只在开机渲染一次（这个是早就存在的 bug，与 IBIT 无关，v384 顺手修了） |

## 2. 完整改动清单（v384 实际做的，按功能路径）

### 2.1 标的白名单与行情源

| 位置 | 改法 |
| --- | --- |
| `src/app/records-import.js` | `TRADE_SYMBOLS = ['VGT','SMH','IBIT']`（`normalizeTrades` 的第二参就是它） |
| `src/app/index.js` | `PRICE_SYMBOLS`、`ETF_NAMES`/`ETF_SYMS` |
| `src/lib/price.js` | `ALLOWED_SYMBOLS` 加 IBIT；**`EASTMONEY_SECID` 加 `IBIT: '107.IBIT'`** —— 不加这条，东方财富那条兜底链路对 IBIT 直接失效 |
| `src/lib/quotes.js` | 删掉 `QUOTE_ALIAS.BTCETF`（老别名退役） |
| `src/app/watch.js` | `WATCH_DEFAULTS`、`WATCH_HELD_OF = { BTC: '' }`、`labelOf` |
| `src/app/brand-icons.js` | `IBIT → bitcoin` |
| `src/app/symbols.js` | 删 `BTCETF` 词条、给 IBIT 补中文别名「比特币ETF」（同步 `tests/symbols.test.mjs` 的 62→61） |
| `src/app/index.js` 的 **v195 启动 IIFE** | 它会在"列表里有现货 BTC 但没有 BTCETF 行"时**自动补一行并推云** —— 必须一起换成 IBIT，否则每次开 App 都把老行塞回来 |

### 2.2 第三腿的"口径"与"界面位置"

**这一类是最容易漏的**，共同特征：符号没写在一起，而是散在 `state.btc` / 元素 id / 三元表达式里。

| 位置 | 不改会怎样 |
| --- | --- |
| `LEG_STATE_KEY = {VGT:'vgt',SMH:'smh',IBIT:'btc'}` + `legTargets()` | 原来每处都写 `{VGT:state.vgt,SMH:state.smh,BTC:state.btc}`，键名对不上就取不到目标配比 |
| 敞口卡 `curV/curS/curB` | 原来 `if(s==='BTC')curB=v`，IBIT 时第三腿恒为 0、占比 >100% |
| 年度矩阵的每股数（`c.btc` → `c.ibit`） | 不改的话 `undefined.toFixed()` 直接抛 |
| `LEG_METRIC_IDS` + `public/index.html` 的三格 | 「期权状态」卡原来只有 VGT/SMH 两格，第三腿没地方显示 |
| 定投卡的标签与 id（`dcaIBIT` / `mobileDcaIbitAmt` / `mobileDcaIbitPct` / `sbIbitPct`） | JS 是按 `'dca' + 符号` 派生的，id 不改就永远更新不到 |
| 交易历史的标的筛选下拉、目标配比图例、`og:description` | 页面上直接写着 BTC |
| `src/app/alerts-view.js` 的排序表、`charts.js` 的默认标的表 | 兜底顺序里少一只 |

### 2.3 IBIT 进 Covered Call

| 位置 | 改法 |
| --- | --- |
| `src/app/index.js` | **`var OPTION_SYMS=['VGT','SMH','IBIT']` 单点定义**；页面 tab / 到期日历 / 概率矩阵 / 节奏 / 提醒 全部改为跟着它（约 18 处 `['VGT','SMH']` 字面量） |
| `src/lib/chain.js` | `ALLOWED_SYMBOLS` 加 IBIT（服务端链白名单，CBOE 有链：实测约 29 档到期日） |
| `src/app/options.js` | `normalizeOptions(list, symbols)`，门禁改 `allowed.includes(sym)`；导出 `DEFAULT_OPTION_SYMBOLS` 作兜底 |
| `src/app/prob-view.js` | `probTabsHtml(current, symbols)` —— 视图层不许再写死标的名 |
| `public/index.html` | **`#osym` 与 `#tfAsset` 两个 select 都要加 IBIT**，另加一颗 `data-option-asset="IBIT"` 胶囊 |
| 节奏与 OTM | IBIT = `every3w` + 锚点 `2026-10-30`（与 SMH 同一天操作）；OTM 默认 **10%**（近月 IV≈36%，按 0.7–0.8σ 换算） |
| `src/app/backup.js` | 备份导入的 `otmSettings` 要认 `ibit` 键 |

### 2.4 退役符号的清理

`BTCETF` 在 **`normalizeWatchlist`** 里被丢弃（`RETIRED_SYMBOLS`），`addWatch` 也拒绝它。
**为什么不写一次性迁移**：`normalizeWatchlist` 是观察列表的**唯一漏斗**（加载 / 云端并集 / 增删改都过它），
在这里丢弃是**幂等且无状态**的；而写 `steps[N]` 迁移会踩另一个坑 —— 手机跑过 v373，`wealth_schema_v1` 已经是 **3**，
再写一个 `steps[3]` 会被 `runMigrations` 的 `from >= DATA_SCHEMA` 直接**静默跳过**。

## 3. 顺手修掉的 4 个真 bug（与换腿无关，但都在同一片代码里）

1. **删期权退两次现金** —— `delOpt` 原来是"再写一条 `权利金退回-X`"，而原来那条 `权利金+X` 还留着；
   用户跟着删掉那条孤儿流水就退第二次。改成 `planOptionDelete`：**连带删掉那条权利金流水**，现金只动这一次。
2. **年度归因的 `capGains.BTC`** → 改成 `capGains.IBIT`，并给占比加 `isFinite` 防护。
3. **`switchTab` 里 `if(tab==='log')` 是死代码**（开头已把 `log` 归一成 `data`）→ 年度复盘卡只在开机渲染一次。
4. **期权胶囊的处理器没分家** —— `querySelectorAll('.asset-chip')` 把期权那组也扫进来，
   点期权胶囊会顺手把 `#tfAsset` 设成 `undefined`。加了作用域。

## 4. 验证方式（可复用）

- 单测 / lint / audit / `npm run e2e` / `npm run e2e:all`（7 阶段）
- 真机走查脚本：`tmp/v384-walkthrough-scenario.mjs`（iPhone 13 描述符，跑法见 `tmp/diag-syncbar-run.mjs` 头部注释），
  逐项断言：胶囊高亮 / 录 IBIT CALL 后持仓出现 / 概率卡与日历都有 IBIT tab / 敞口卡第三腿=比特币 /
  **年度复盘卡的「当前总资产 = 持仓市值 + 现金」精确相等** / 全页无 `NaN`、`undefined` / 无真实网络错误
- 调试 Chrome 截图：`tmp/v384-cdp-check.mjs`（输出到 `C:/Users/topeasejs/ChromeDebug/v384-*.png`）
- 排查 `NaN` 用：`tmp/v384-nan-probe.mjs`（把含 `NaN` 的最小元素与上下文打出来）

## 5. 仍然有意保留的"按标的写死"

- `src/lib/dividends.js` 白名单与 `fetchDividends` 只拉 **VGT/SMH**：IBIT 是比特币信托、**没有除息日**，
  拉它只会白拿一个 400。将来加**有股息**的期权标的时必须同时放开这两处。
- 持仓穿透（`/api/holdings`、敞口卡的"其余成分股"）只对 VGT/SMH 有意义 —— IBIT 没有成分股，
  这里的 `['VGT','SMH']` 是**正确的**，别一刀切改成 `ETF_SYMS`。

细节与后续维护要求见 [maintenance.md](./maintenance.md) 的「已知未修问题」第 10 条。
