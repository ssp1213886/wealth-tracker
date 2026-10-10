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
 * 某个时点的组合快照 —— 「组合值多少钱」的**唯一实现**。
 *
 *   cash   现金流水累计（只记外部进出：入金 / 出金 / 股息 / 权利金 / 修正）
 *   buy    累计买入支出     sell  累计卖出所得
 *   shares { VGT: 100, ... } 当时持股
 *   value  总资产 = 现金 + 卖出 − 买入 + Σ(持股 × 该标的的价)
 *   priced 所有"持有中"的标的都拿到了价（false 时界面该显示「—」，不编数字）
 *
 * 为什么必须只有这一处：月度收益、年度归因、首页总资产都是它的变体。
 * 这个项目历史上真出过"两处各算一份、改动只改了一处"的事故（见 portfolio.js 的 cashPctOf 注释）。
 */
export function portfolioStateAt(input) {
  const o = input || {};
  const end = String(o.end || '');
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const cashLog = Array.isArray(o.cashLog) ? o.cashLog : [];
  const px = o.priceBySymbol || {};
  let cash = 0; let buy = 0; let sell = 0;
  cashLog.forEach(function (l) {
    if (l && l.date && (!end || l.date <= end)) cash += cashSigned(l);
  });
  const shares = {};
  trades.forEach(function (t) {
    if (!t || !t.date || (end && t.date > end)) return;
    const n = Number(t.shares) || 0;
    const a = Math.abs(n) * (Number(t.price) || 0);
    if (n < 0) sell += a; else buy += a;
    const s = String(t.symbol);
    shares[s] = (shares[s] || 0) + n;
  });
  let mv = 0; let priced = true;
  Object.keys(shares).forEach(function (s) {
    const n = shares[s];
    if (!n) return;
    const p = Number(px[s]);
    if (!(p > 0)) { priced = false; return; }
    mv += n * p;
  });
  return { cash: cash, buy: buy, sell: sell, shares: shares, value: cash + sell - buy + mv, priced: priced };
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
/* ── 月末资产口径的共用实现（v370）──
   monthlyPnl（月度收益）与 equitySeries（资产曲线）必须用**同一套**"谁是注资 / 某个时点组合值多少钱"，
   所以把这两件事提到模块级共用。历史上这里犯过"同一个数两处算"的错（见 maintenance.md）。 */

/** 'YYYY-MM-DD' ≤ 'YYYY-MM-31' 即"在该月之内"，字符串比较就够，不用建 Date。 */
function monthEndOf(ym) { return ym + '-31'; }

/** '2026-01' 的上一个月 → '2025-12'（月初资产要用上月末的价）。 */
function prevMonthOf(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
}

function inMonthOf(date, ym) { return typeof date === 'string' && date.slice(0, 7) === ym; }

/** 算注资的只有这三类：入金 / 出金 / 修正。股息与权利金是收益，不能当注资。 */
function isCapitalEntry(l) {
  const t = String((l && l.type) || '');
  return t.indexOf('入金') >= 0 || t.indexOf('出金') >= 0 || t.indexOf('修正') >= 0;
}

/** 某个（月末）时点的总资产 —— 资产口径走共享实现，缺行情则 gap=true（这个月判为算不出来）。 */
function valueAtMonthEnd(input) {
  const o = input || {};
  const priceByMonth = o.priceByMonth || {};
  const prices = {};
  Object.keys(priceByMonth).forEach(function (s) { prices[s] = (priceByMonth[s] || {})[o.ym]; });
  const snap = portfolioStateAt({ trades: o.trades, cashLog: o.cashLog, end: o.end, priceBySymbol: prices });
  return { value: snap.value, gap: !snap.priced };
}

export function monthlyPnl(input) {
  const o = input || {};
  const months = (Array.isArray(o.months) ? o.months : []).map(String).filter(Boolean);
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const cashLog = Array.isArray(o.cashLog) ? o.cashLog : [];
  const px = o.priceByMonth || {};
  const out = {};
  if (!months.length) return out;

  const daysIn = function (ym) { return new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(); };
  /* v370：口径实现提到模块级（monthEndOf / prevMonthOf / inMonthOf / isCapitalEntry / valueAtMonthEnd），
     资产曲线 equitySeries 与这里共用同一份 —— 免得"同一个数两处算"再犯一次。
     这里保留同名局部别名，函数体一个字都不用改。 */
  const endOf = monthEndOf;
  const prevOf = prevMonthOf;
  const inMonth = inMonthOf;
  const isCapital = isCapitalEntry;
  const valueAt = function (ym, end) {
    return valueAtMonthEnd({ ym: ym, end: end, trades: trades, cashLog: cashLog, priceByMonth: px });
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

/**
 * 资产曲线（v370）：把"每月月末的总资产"连成一条线，再叠一条"累计净入金"参考线。
 *
 *   口径与 monthlyPnl **完全一致**（共用 valueAtMonthEnd / isCapitalEntry）：
 *     总资产 = Σ(持股 × 该月末收盘价) + 现金流水的累计 + 卖出所得 − 买入支出
 *     净入金只数入金 / 出金 / 修正三类（股息与权利金是收益，不是注资）
 *   gap=true 的月份**不补 0** —— 由渲染层断开线段（宁可断，不可编）。
 *   ready=false 表示可画的点不足 2 个，界面显示空态。
 */
export function equitySeries(input) {
  const o = input || {};
  const months = (Array.isArray(o.months) ? o.months : []).map(String).filter(Boolean);
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const cashLog = Array.isArray(o.cashLog) ? o.cashLog : [];
  const priceByMonth = o.priceByMonth || {};
  const points = [];
  let netInvested = 0;

  months.forEach(function (ym) {
    /* 净入金是按月累加的：只把"这个月发生的注资"加上去，所以要求 months 是有序月份 */
    cashLog.forEach(function (l) {
      if (!l || !isCapitalEntry(l) || !inMonthOf(l.date, ym)) return;
      netInvested += cashSigned(l);
    });
    const snap = valueAtMonthEnd({ ym: ym, end: monthEndOf(ym), trades: trades, cashLog: cashLog, priceByMonth: priceByMonth });
    points.push({ ym: ym, value: Number(snap.value) || 0, gap: !!snap.gap, netInvested: netInvested });
  });

  const usable = points.filter(function (p) { return !p.gap; });
  let peak = null;
  let trough = null;
  usable.forEach(function (p) {
    if (!peak || p.value > peak.value) peak = p;
    if (!trough || p.value < trough.value) trough = p;
  });
  const first = usable.length ? usable[0] : null;
  const last = usable.length ? usable[usable.length - 1] : null;
  const gain = first && last ? last.value - first.value : null;
  return {
    points: points,
    first: first,
    last: last,
    peak: peak,
    trough: trough,
    months: months.length,
    netInvested: netInvested,
    gain: gain,
    gainPct: first && last && first.value > 0 ? (last.value - first.value) / first.value : null,
    ready: usable.length >= 2,
  };
}

/**
 * 资产曲线的 SVG（纯字符串，可离线单测）。
 *   两条线：净值（实线 + 淡填充）、累计净入金（虚线）。gap 处**断开**（多个 M 段）。
 *   用 preserveAspectRatio="none" + vector-effect="non-scaling-stroke" 适配任意宽度而不拉粗线宽；
 *   因此这里**不画文字、不画圆点**（非等比缩放会把它们压扁）—— 标签交给 HTML 层。
 */
export function equityCurveSvg(series) {
  const pts = (series && Array.isArray(series.points)) ? series.points : [];
  if (pts.length < 2) return '';
  const usable = pts.filter(function (p) { return !p.gap; });
  if (usable.length < 2) return '';
  const VW = 300;
  const VH = 96;
  const PAD = 4;
  let min = Infinity;
  let max = -Infinity;
  usable.forEach(function (p) {
    const v = Number(p.value) || 0;
    const iv = Number(p.netInvested) || 0;
    if (v < min) min = v;
    if (v > max) max = v;
    if (iv < min) min = iv;
    if (iv > max) max = iv;
  });
  if (!isFinite(min) || !isFinite(max)) return '';
  const span = max - min > 0 ? max - min : 1;
  const xAt = function (i) { return pts.length <= 1 ? VW / 2 : PAD + (i / (pts.length - 1)) * (VW - PAD * 2); };
  const yAt = function (v) { return VH - PAD - ((Number(v) || 0) - min) / span * (VH - PAD * 2); };
  let line = '';
  let invested = '';
  let pen = false;
  pts.forEach(function (p, i) {
    if (p.gap) { pen = false; return; }
    const cmd = pen ? 'L' : 'M';
    line += cmd + xAt(i).toFixed(2) + ' ' + yAt(p.value).toFixed(2) + ' ';
    invested += cmd + xAt(i).toFixed(2) + ' ' + yAt(p.netInvested).toFixed(2) + ' ';
    pen = true;
  });
  /* 填充只在"一条不断线"时画：断了以后连首尾会把缺口也填上，反而像数据齐的 */
  const hasGap = pts.some(function (p) { return p.gap; });
  const area = hasGap ? '' : '<path class="eq-area" d="' + line +
    'L' + xAt(pts.length - 1).toFixed(2) + ' ' + (VH - PAD) +
    ' L' + xAt(0).toFixed(2) + ' ' + (VH - PAD) + ' Z"/>';
  return '<svg class="eq-svg" viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    area +
    '<path class="eq-invested" d="' + invested.trim() + '" vector-effect="non-scaling-stroke"/>' +
    '<path class="eq-line" d="' + line.trim() + '" vector-effect="non-scaling-stroke"/>' +
    '</svg>';
}
