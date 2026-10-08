// 图表的数据整形（纯逻辑）：纪律热力图的月度数据、年度矩阵、甜甜圈切片、热力色阶。
// 只做"算数据"，画布/HTML 仍留在 index.js；因此这些数字可以离线单测。
import { marketDate } from './time.js';
import { cashSigned } from './util.js';

/**
 * 纪律热力图：最近 N 个月（默认 12）的定投完成情况 + 连续完成月数。
 *   完成 = 当月有买入 且 买入金额 ≥ 目标定投额 × 0.7
 *   连续月数从最近一个月往回数；未来的月份跳过、当月未完成也跳过（不算断）
 * 每个月给出 state（CSS 类后缀）与 icon，交给渲染层直接用。
 */
export function disciplineMonths(input) {
  const o = input || {};
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const curYM = o.ym || marketDate().slice(0, 7);
  const dca = Number(o.dca) || 0;
  const count = Number(o.count) || 12;
  const symbols = Array.isArray(o.symbols) && o.symbols.length ? o.symbols : ['VGT', 'SMH', 'BTC'];
  const base = new Date(Number(curYM.slice(0, 4)), Number(curYM.slice(5, 7)) - 1, 1);
  const months = [];
  for (let i = -(count - 1); i <= 0; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    months.push({ ym: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: (d.getMonth() + 1) + '月', isFuture: false });
  }
  months.forEach(function (mt) {
    if (mt.ym > curYM) mt.isFuture = true;
    const buys = trades.filter(function (t) { return t.shares > 0 && t.date.slice(0, 7) === mt.ym; });
    const bySym = {};
    buys.forEach(function (t) { bySym[t.symbol] = (bySym[t.symbol] || 0) + t.shares * t.price; });
    mt.totalV = symbols.reduce(function (sum, sym) { return sum + (bySym[sym] || 0); }, 0);
    mt.hasBuy = buys.length > 0;
    mt.complete = !mt.isFuture && mt.totalV >= dca * 0.7 && mt.hasBuy;
    mt.state = mt.isFuture ? '' : (mt.ym === curYM ? 'is-current' : (!mt.hasBuy ? 'is-empty' : (mt.complete ? 'is-done' : 'is-partial')));
    mt.icon = mt.isFuture ? '' : (!mt.hasBuy ? '✕' : (mt.complete ? '✓' : '~'));
  });
  let streak = 0;
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const m = months[i];
    if (m.isFuture || (m.ym === curYM && !m.complete)) continue;
    if (m.complete) streak += 1;
    else break;
  }
  return { months: months, streak: streak };
}

/**
 * 月度收益（口径 A：当月**整个组合**的收益）—— 不是"当月新投那笔"的收益，也不是累计收益。
 *
 *   收益额 = 月末总资产 − 月初总资产 − 当月净入金
 *   收益率 = 收益额 ÷ (月初总资产 + Σ 每笔入金 × 在场时间占比)     ← Modified Dietz
 *
 * 为什么收益率要加权：定投的钱不是整月都在场。只用月初资产当分母 → 分母偏小、收益率偏高；
 * 只用月末资产 → 分母偏大、收益率偏低；按"这笔钱待了几天"加权才是行业标准做法。
 *
 * 资产口径跟 app 里已有的「年度归因」（index.js 的 calcAttribution）**完全一致**：
 *   · 资产 = Σ(持股 × 月末收盘价) + Σ 现金流水的累计 + 卖出所得 − 买入支出
 *     （现金流水只记外部进出：入金/出金/股息/权利金/修正；买卖股票对现金的影响由 trades 自己算）
 *   · 净入金数「入金 / 出金 / 修正」—— 股息、权利金是**收益**，不能当注资；
 *     「修正」是记账调整（原因不明，多半是补记/改错），按**资本变动**处理，不算收益也不算亏损。
 *     这一条与「年度归因」「首页累计收益」三处必须一致，否则同一个数在两个地方会差出那一笔。
 *   于是有个可测的好性质：同一年 12 个月的收益额加起来 ≈ 那一年的总收益，两处不会互相打脸。
 *
 * ⚠️ 铁律：**必须减掉当月入金**，否则定投会被当成收益。
 *
 * 输入
 *   months       ['2026-08','2026-09']（要算的月份，升序）
 *   trades      交易（shares 带正负、date 'YYYY-MM-DD'）
 *   cashLog     现金流水（type / date / amount）
 *   priceByMonth { VGT: {'2026-07': 118.2, '2026-08': 121.4, ...}, ... }
 *                —— 每个标的、每个月给"该月最后一个交易日的收盘价"。
 *                   **建议多给一个月**：列表里第一个月的"月初资产"要用上个月末的价。
 * 输出
 *   { '2026-09': { amount, rate, computed, gap } }
 *   computed=false（缺行情）→ 界面显示「—」，绝不编数字；
 *   amount 有值但 rate=null（分母 ≤ 0，例如入金发生在当月最后一天）→ 只显示金额。
 */
export function monthlyPnl(input) {
  const o = input || {};
  const months = (Array.isArray(o.months) ? o.months : []).map(String).filter(Boolean);
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const cashLog = Array.isArray(o.cashLog) ? o.cashLog : [];
  const px = o.priceByMonth || {};
  const syms = Object.keys(px);
  const out = {};
  if (!months.length) return out;

  /* 'YYYY-MM-DD' ≤ 'YYYY-MM-31' 即"在该月之内"，字符串比较就够，不用建 Date */
  const endOf = function (ym) { return ym + '-31'; };
  const daysIn = function (ym) { return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(); };
  const prevOf = function (ym) {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  };
  const inMonth = function (date, ym) { return typeof date === 'string' && date.slice(0, 7) === ym; };
  /* 算注资的只有这三类：入金 / 出金 / 修正。股息与权利金是收益，不能当注资。 */
  const isCapital = function (l) {
    const t = String((l && l.type) || '');
    return t.indexOf('入金') >= 0 || t.indexOf('出金') >= 0 || t.indexOf('修正') >= 0;
  };

  /** 到 end 为止的累计：现金流水 / 买入支出 / 卖出所得，以及当时的持股。 */
  const cumulative = function (end) {
    let cash = 0; let buy = 0; let sell = 0;
    cashLog.forEach(function (l) { if (l && l.date && l.date <= end) cash += cashSigned(l); });
    const sh = {};
    trades.forEach(function (t) {
      if (!t || !t.date || t.date > end) return;
      const n = Number(t.shares) || 0;
      const a = Math.abs(n) * (Number(t.price) || 0);
      if (n < 0) sell += a; else buy += a;
      const s = String(t.symbol);
      sh[s] = (sh[s] || 0) + n;
    });
    return { cash: cash, buy: buy, sell: sell, sh: sh };
  };

  /** 某个（月末）时点的总资产。持有中但缺当月行情 → gap=true（这个月就判为算不出来）。 */
  const valueAt = function (ym, end) {
    const c = cumulative(end);
    let mv = 0; let gap = false;
    syms.forEach(function (s) {
      const n = c.sh[s] || 0;
      if (!n) return;
      const p = Number((px[s] || {})[ym]);
      if (!(p > 0)) { gap = true; return; }
      mv += n * p;
    });
    return { value: c.cash + c.sell - c.buy + mv, gap: gap };
  };

  months.forEach(function (ym) {
    const prevYm = prevOf(ym);
    const prev = valueAt(prevYm, endOf(prevYm));
    const now = valueAt(ym, endOf(ym));
    const days = daysIn(ym);
    let netDep = 0;
    let weighted = 0;
    cashLog.forEach(function (l) {
      if (!l || !isCapital(l) || !inMonth(l.date, ym)) return;
      const amt = cashSigned(l);                                  /* 入金为正、出金为负 */
      netDep += amt;
      const day = Number(String(l.date).slice(8, 10));            /* 当月第几天 */
      const left = Math.max(0, days - day + 1);                   /* 在场天数（含入金当天） */
      weighted += amt * (left / days);
    });
    const computed = !prev.gap && !now.gap;
    const amount = now.value - prev.value - netDep;
    const denom = prev.value + weighted;
    out[ym] = {
      amount: computed ? amount : null,
      rate: computed && denom > 0 ? amount / denom : null,
      computed: computed,
      gap: prev.gap || now.gap,
      /* blank：这个月前后都没有任何资产、也没有进出 —— 界面连「—」都不用画（比如你还没开始记账的那些月） */
      blank: !(prev.value > 0 || now.value > 0 || netDep !== 0),
    };
  });
  return out;
}

/**
 * 年度矩阵：从"第一笔买入或第一笔入金"那年开始，每年一格（最多 20 年）。
 *   每格：当年权利金、当年买入额、权利金贡献率、年末各标的持股
 *   汇总：累计入金、当前总资产、长期 CAGR（按有买入的年份数）、目标差额
 * 没有任何买入与入金时返回 empty=true，由界面显示空态。
 */
export function annualMatrix(input) {
  const o = input || {};
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const optionTrades = Array.isArray(o.optionTrades) ? o.optionTrades : [];
  const cashLog = Array.isArray(o.cashLog) ? o.cashLog : [];
  const prices = o.prices || {};
  const symbols = Array.isArray(o.symbols) && o.symbols.length ? o.symbols : ['VGT', 'SMH', 'BTC'];
  const netCash = Number(o.netCash) || 0;
  const targetGoal = Number(o.targetGoal) || 0;
  const now = o.now instanceof Date ? o.now : new Date();
  const deposits = cashLog.filter(function (l) { return String(l.type || '').indexOf('入金') >= 0; });
  const allDates = [].concat(trades.map(function (t) { return t.date; }), deposits.map(function (l) { return l.date; }));
  if (!allDates.length) return { empty: true, cells: [], totalInvested: 0, activeYears: 0, totalMktV: 0, totalAssets: netCash, cagr: 0, targetGap: Math.max(0, targetGoal - netCash) };
  const sorted = allDates.slice().sort();
  const startYear = parseInt(String(sorted[0]).slice(0, 4), 10);
  const totalYears = Math.min(20, now.getFullYear() - startYear + 1);
  const cells = [];
  for (let i = 0; i < totalYears; i += 1) {
    const y = startYear + i;
    const ys = String(y);
    const yBuys = trades.filter(function (t) { return t.shares > 0 && t.date.slice(0, 4) === ys; });
    const yPrem = optionTrades.filter(function (op) { return op.added && op.added.slice(0, 4) === ys; })
      .reduce(function (sum, op) { return sum + (op.premium || 0) * (op.contracts || 1); }, 0);
    const dcaTotal = yBuys.reduce(function (sum, t) { return sum + t.shares * t.price; }, 0);
    const premRate = dcaTotal > 0 ? yPrem / dcaTotal * 100 : 0;
    const endHolds = {};
    trades.filter(function (t) { return t.date.slice(0, 4) <= ys; }).forEach(function (t) { endHolds[t.symbol] = (endHolds[t.symbol] || 0) + t.shares; });
    cells.push({
      ym: ys,
      prem: yPrem,
      dca: dcaTotal,
      rate: premRate,
      vgt: Math.max(0, endHolds.VGT || 0),
      smh: Math.max(0, endHolds.SMH || 0),
      btc: Math.max(0, endHolds.BTC || 0),
      hasData: dcaTotal > 0,
    });
  }
  const totalInvested = deposits.reduce(function (sum, l) { return sum + l.amount; }, 0);
  const activeYears = cells.filter(function (c) { return c.hasData; }).length;
  const totalHoldings = {};
  trades.forEach(function (t) { totalHoldings[t.symbol] = (totalHoldings[t.symbol] || 0) + t.shares; });
  const totalMktV = symbols.reduce(function (sum, sym) { return sum + Math.max(0, totalHoldings[sym] || 0) * (Number(prices[sym]) || 0); }, 0);
  const totalAssets = totalMktV + netCash;
  const cagr = (totalInvested > 0 && activeYears > 0) ? Math.pow(totalAssets / totalInvested, 1 / activeYears) - 1 : 0;
  return {
    empty: false,
    cells: cells,
    totalInvested: totalInvested,
    activeYears: activeYears,
    totalMktV: totalMktV,
    totalAssets: totalAssets,
    cagr: cagr,
    targetGap: Math.max(0, targetGoal - totalAssets),
  };
}

/** 年度热力色阶：返回 [底色, 主文字色, 次级文字色, 边框色]（阈值与旧实现一致）。 */
export function heatColorFor(rate, hasData) {
  if (!hasData) return ['#f0f0ec', '#888', 'rgba(0,0,0,.3)', 'rgba(0,0,0,.25)'];
  if (rate >= 100) return ['#6c0a1e', '#fff', 'rgba(255,255,255,.75)', 'rgba(255,255,255,.6)'];
  if (rate >= 50) return ['#922b3e', '#fff', 'rgba(255,255,255,.75)', 'rgba(255,255,255,.6)'];
  if (rate >= 25) return ['#c0392b', '#fff', 'rgba(255,255,255,.75)', 'rgba(255,255,255,.65)'];
  if (rate >= 10) return ['#e67e22', '#fff', 'rgba(255,255,255,.75)', 'rgba(255,255,255,.65)'];
  if (rate >= 8) return ['#f0ad4e', '#2c2c2c', 'rgba(0,0,0,.5)', 'rgba(0,0,0,.4)'];
  if (rate >= 6) return ['#f9e79f', '#2c2c2c', 'rgba(0,0,0,.45)', 'rgba(0,0,0,.35)'];
  if (rate >= 3) return ['#aed6f1', '#1a5276', 'rgba(0,0,0,.45)', 'rgba(0,0,0,.35)'];
  if (rate >= 0.1) return ['#d6eaf8', '#2e86c1', 'rgba(0,0,0,.45)', 'rgba(0,0,0,.35)'];
  return ['#5b6d8a', '#fff', 'rgba(255,255,255,.7)', 'rgba(255,255,255,.6)'];
}

/**
 * 甜甜圈切片：只算有价格且市值 > 0 的持仓。
 * reason = 'ok' | 'no-data'（一条都没有）| 'unpriced'（有持仓但都没价格）。
 */
export function donutSlices(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || list.every(function (r) { return !r.priced; })) return { slices: [], total: 0, reason: 'no-data' };
  const priced = list.filter(function (r) { return r.priced && r.value > 0; });
  if (!priced.length) return { slices: [], total: 0, reason: 'unpriced' };
  const total = priced.reduce(function (sum, r) { return sum + r.value; }, 0);
  return {
    slices: priced.map(function (r) { return { sym: r.sym, value: r.value, pct: r.value / total }; }),
    total: total,
    reason: 'ok',
  };
}
