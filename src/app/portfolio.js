// 持仓/组合的纯计算：总盈亏与现金占比、今日变动、目标进度、距高点回撤、PnL 摘要行。
// 不碰 DOM、不读写存储（peak 与 hi52 由调用方取好传进来），因此可以离线单测。
// 注意：成本均价与已实现盈亏一律复用 calc.js 的 computeHoldings，不在别处重算（历史上 updatePnlSummary 抄过一份）。
import { computeHoldings, buildPositionRows } from './calc.js';

/**
 * 组合汇总：
 *   unreal      浮动盈亏（拿不到价时为 null）
 *   total       总盈亏 = 浮动 + 已实现 + 权利金 + 股息
 *   pct         总收益率（分母是累计买入 totalInvested）
 *   totalAssets 持仓市值 + 净现金
 *   cashPct     现金占总资产比例（%）；总资产 ≤ 0 时为 null（占比无意义，界面显示「—」）
 *
 * 为什么股息要单列进总盈亏：**股息是真实收益，只是以现金形式躺在账户里**，
 * 既不是浮动盈亏（那只看持仓成本），也不是权利金。以前漏掉它，会和
 * 「纪律热力图」的当月收益（口径 A：月末总资产 − 月初总资产 − 当月入金）对不上 ——
 * 那两个数在没有任何现金修正时应当严格相等（差 = 股息 + 修正）。
 */
export function portfolioTotals(input) {
  const o = input || {};
  const hasPriced = !!o.hasPriced;
  const totalValue = Number(o.totalValue) || 0;
  const totalCost = Number(o.totalCost) || 0;
  const totalInvested = Number(o.totalInvested) || 0;
  const totalRealized = Number(o.totalRealized) || 0;
  const optionPremium = Number(o.optionPremium) || 0;
  const dividend = Number(o.dividend) || 0;
  const netCash = Number(o.netCash) || 0;
  const unreal = hasPriced ? totalValue - totalCost : null;
  const total = (hasPriced && unreal !== null) ? unreal + totalRealized + optionPremium + dividend : null;
  const pct = (hasPriced && totalInvested > 0) ? total / totalInvested : null;
  const totalAssets = totalValue + netCash;
  const cashPct = cashPctOf(totalAssets, netCash);
  return { unreal: unreal, total: total, pct: pct, totalAssets: totalAssets, cashPct: cashPct, dividend: dividend };
}

/**
 * 现金占总资产的比例（%）。总资产 ≤ 0 时返回 null —— 占比没有意义，界面显示「—」。
 *
 * 为什么单独抽出来：这个值有**两处**要写进 DOM（`renderMetricsTop` 走 `updatePortfolio`；
 * `updateMobStatusBar` 顺手也刷桌面卡）。历史上那两处各写了一份公式，其中一份还把 ≤0 硬写成 0，
 * 于是刚修好的「—」会被后一次调用覆盖回「0.00%」。口径只能有一份。
 */
export function cashPctOf(totalAssets, netCash) {
  const assets = Number(totalAssets) || 0;
  if (assets <= 0) return null;
  return (Number(netCash) || 0) / assets * 100;
}

/**
 * 今日收益：按"当日实际持有区间"算，而不是拿当前持股数 × 全天涨跌。
 *   change = 当前市值 − 昨日收盘市值 − 今日净买入成本
 * 展开就是：昨天就持有的吃「昨收→现价」；今天新买的只吃「买入价→现价」；今天卖出的吃「昨收→卖价」。
 * 修掉的老 bug：今天才按现价买入的仓位，今日收益却被算成 股数 × 全天涨跌。
 *   rows   = 当前持仓行（带 sym/shares/priced）
 *   quotes = { sym: { price, prevClose, change } }
 *   trades = 全部交易；today = 今天的美东交易日（与 trade.date 同格式）
 * 收益率分母 = 昨日收盘市值 + 今日净买入额（今早才投进来的钱也算本金）。
 */
export function dailyChange(rows, quotes, trades, today) {
  const q = quotes || {};
  const list = Array.isArray(trades) ? trades : [];
  const day = String(today || '');
  const prevShares = {}, todayBuy = {}, todaySell = {};
  list.forEach(function (t) {
    if (!t) return;
    const d = String(t.date || '');
    const sh = Number(t.shares) || 0;
    if (!d || !day) return;
    const amt = Math.abs(sh) * (Number(t.price) || 0);
    if (d < day) prevShares[t.symbol] = (prevShares[t.symbol] || 0) + sh;
    else if (d === day) {
      if (sh > 0) todayBuy[t.symbol] = (todayBuy[t.symbol] || 0) + amt;
      else if (sh < 0) todaySell[t.symbol] = (todaySell[t.symbol] || 0) + amt;
    }
  });
  const priced = {};
  (rows || []).forEach(function (r) { if (r && r.priced) priced[r.sym] = Number(r.shares) || 0; });
  const syms = {};
  [priced, prevShares, todayBuy, todaySell].forEach(function (m) {
    Object.keys(m).forEach(function (s) { syms[s] = 1 });
  });

  let change = 0, prevValue = 0, netBuy = 0;
  Object.keys(syms).forEach(function (sym) {
    const info = q[sym] || {};
    const price = Number(info.price), prev = Number(info.prevClose);
    const cur = priced[sym] === undefined ? 0 : priced[sym];
    const prevSh = prevShares[sym] || 0;
    const buy = todayBuy[sym] || 0, sell = todaySell[sym] || 0;
    if (!isFinite(price) || price <= 0 || !isFinite(prev) || prev <= 0) {
      // 缺现价或缺昨收：退回旧口径，至少不比以前更差
      const leg = Number(info.change);
      if (isFinite(leg)) change += cur * leg;
      return;
    }
    change += cur * price - prevSh * prev - buy + sell;
    prevValue += prevSh * prev;
    netBuy += buy - sell;
  });
  const base = prevValue + Math.max(0, netBuy);
  const pct = base > 0 ? (change / base) * 100 : null;
  return { change: change, pct: pct, prevValue: prevValue, netBuy: netBuy };
}

/** 目标进度：百分比封顶 100，还差多少不低于 0。 */
export function goalProgress(totalAssets, targetGoal) {
  const target = Number(targetGoal) || 0;
  const assets = Number(totalAssets) || 0;
  if (target <= 0) return { pct: 0, gap: 0 };
  return { pct: Math.min(100, assets / target * 100), gap: Math.max(0, target - assets) };
}

/**
 * 距高点回撤（单只标的）。峰值取三者最大：记在本地的高点、行情里的 52 周高点、当前价。
 * 脏数据保护：历史峰值若超过当前价 5 倍（换股/拆股/写坏）就当没有；52 周高点同理。
 * 现价缺失返回 null（界面据此不显示这一行）。
 */
export function drawdownLine(sym, price, storedPeak, hi52) {
  const cp = Number(price) || 0;
  if (cp <= 0) return null;
  let peak = Number(storedPeak) || 0;
  if (peak > cp * 5) peak = 0;
  const h52 = Number(hi52) || 0;
  if (h52 && h52 > peak && h52 < cp * 5) peak = h52;
  if (!peak || cp > peak) peak = cp;
  return { sym: sym, price: cp, peak: peak, dd: ((peak - cp) / peak) * 100 };
}

/**
 * 首页「盈亏摘要」用的行数据：复用 calc.js 的成本结转，
 * 只挑指定标的（默认按传入顺序），没持仓的会被过滤掉。
 * 返回的 pct 是百分数（13.7 表示 +13.7%）。
 */
export function summaryRows(trades, prices, symbols) {
  const pack = computeHoldings(trades);
  const rows = buildPositionRows(pack.holdings, prices || {}).rows;
  const wanted = (Array.isArray(symbols) && symbols.length) ? symbols : rows.map(function (r) { return r.sym; });
  return wanted.map(function (sym) {
    const hit = rows.filter(function (r) { return r.sym === sym; })[0];
    if (!hit) return null;
    return {
      sym: sym,
      shares: hit.shares,
      price: hit.curPrice || 0,
      value: hit.value || 0,
      pnl: hit.unrealPnL || 0,
      pct: hit.pnlPct != null ? hit.pnlPct * 100 : 0,
    };
  }).filter(Boolean);
}
