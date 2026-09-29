// 持仓/组合的纯计算：总盈亏与现金占比、今日变动、目标进度、距高点回撤、PnL 摘要行。
// 不碰 DOM、不读写存储（peak 与 hi52 由调用方取好传进来），因此可以离线单测。
// 注意：成本均价与已实现盈亏一律复用 calc.js 的 computeHoldings，不在别处重算（历史上 updatePnlSummary 抄过一份）。
import { computeHoldings, buildPositionRows } from './calc.js';

/**
 * 组合汇总：
 *   unreal      浮动盈亏（拿不到价时为 null）
 *   total       总盈亏 = 浮动 + 已实现 + 权利金
 *   pct         总收益率（分母是累计买入 totalInvested）
 *   totalAssets 持仓市值 + 净现金
 *   cashPct     现金占总资产比例（%）
 */
export function portfolioTotals(input) {
  const o = input || {};
  const hasPriced = !!o.hasPriced;
  const totalValue = Number(o.totalValue) || 0;
  const totalCost = Number(o.totalCost) || 0;
  const totalInvested = Number(o.totalInvested) || 0;
  const totalRealized = Number(o.totalRealized) || 0;
  const optionPremium = Number(o.optionPremium) || 0;
  const netCash = Number(o.netCash) || 0;
  const unreal = hasPriced ? totalValue - totalCost : null;
  const total = (hasPriced && unreal !== null) ? unreal + totalRealized + optionPremium : null;
  const pct = (hasPriced && totalInvested > 0) ? total / totalInvested : null;
  const totalAssets = totalValue + netCash;
  const cashPct = totalAssets > 0 ? netCash / totalAssets * 100 : 0;
  return { unreal: unreal, total: total, pct: pct, totalAssets: totalAssets, cashPct: cashPct };
}

/**
 * 今日变动：按"每行市值 × 当日涨跌额"累加（只算有行情的行），
 * 再用"昨日市值 = 当前市值 − 今日变动"求百分比。
 */
export function dailyChange(rows, changes, totalValue) {
  const map = changes || {};
  let change = 0;
  (rows || []).forEach(function (r) {
    if (!r || !r.priced || map[r.sym] == null) return;
    change += (Number(r.shares) || 0) * (Number(map[r.sym]) || 0);
  });
  const yesterday = (Number(totalValue) || 0) - change;
  const pct = yesterday > 0 ? (change / yesterday) * 100 : null;
  return { change: change, pct: pct };
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
