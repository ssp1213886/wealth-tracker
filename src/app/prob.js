// 被行权概率与行权价的纯计算：正态分布、Black-Scholes、P(ITM)=N(d2)、反解 IV、按目标概率反解行权价。
// 不碰 DOM、不读写存储，链数据由调用方传入，因此可以离线单测。
//
// 口径：卖 CALL 被行权 = 到期时现价 > 行权价，所以在风险中性测度下就是 N(d2)。
// 这是**概率**不是保证金/指派通知；另外还有"除息日前提前行权"这条路，本模块不覆盖（界面单独提示）。

const DEFAULT_RATE = 0.04;

/** 标准正态 CDF。用 A&S 7.1.26 的 erf 近似（绝对误差 ~1.5e-7），够算概率用了。 */
export function normCdf(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const ax = Math.abs(n) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** 标准正态分位数（Acklam 有理逼近）。p 不在 (0,1) 内返回 NaN。 */
export function normInv(p) {
  const x = Number(p);
  if (!(x > 0) || x >= 1) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q;
  let r;
  if (x < plow) {
    q = Math.sqrt(-2 * Math.log(x));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (x > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - x));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = x - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 欧式看涨定价（连续复利、无股息）。股息对 ETF 期权有影响，但季度分红很小，这里忽略并在界面注明。 */
export function bsCall(spot, strike, years, rate, vol) {
  const s = Number(spot);
  const k = Number(strike);
  const t = Number(years);
  const r = Number.isFinite(Number(rate)) ? Number(rate) : DEFAULT_RATE;
  const v = Number(vol);
  if (!(s > 0) || !(k > 0)) return 0;
  if (!(t > 0)) return Math.max(0, s - k);
  if (!(v > 0)) return Math.max(0, s - k * Math.exp(-r * t));
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + (v * v) / 2) * t) / (v * sqrtT);
  return s * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d1 - v * sqrtT);
}

/** 看涨的 delta = N(d1)。只用于展示（"这个行权价大约等于多少股正股的风险敞口"）。 */
export function bsCallDelta(spot, strike, years, rate, vol) {
  const s = Number(spot);
  const k = Number(strike);
  const t = Number(years);
  const r = Number(rate);
  const v = Number(vol);
  if (!(s > 0) || !(k > 0) || !(t > 0) || !(v > 0)) return 0;
  return normCdf((Math.log(s / k) + (r + (v * v) / 2) * t) / (v * Math.sqrt(t)));
}

/**
 * 到期被行权的概率 = P(S_T > K) = N(d2)。
 * 到期日当天（years ≤ 0）退化成确定事件：已实值 100%，未实值 0%。
 * 缺 IV 或参数非法返回 null —— 让界面显示「—」，而不是编一个数出来。
 */
export function probITM(input) {
  const o = input || {};
  const spot = Number(o.spot);
  const strike = Number(o.strike);
  const iv = Number(o.iv);
  const dte = Number(o.dte);
  const rate = Number.isFinite(Number(o.rate)) ? Number(o.rate) : DEFAULT_RATE;
  if (!(spot > 0) || !(strike > 0)) return null;
  const years = dte / 365;
  if (!(years > 0)) return spot > strike ? 1 : 0;
  if (!(iv > 0)) return null;
  const d2 = (Math.log(spot / strike) + (rate - (iv * iv) / 2) * years) / (iv * Math.sqrt(years));
  return normCdf(d2);
}

/**
 * 由期权价格反推隐含波动率（二分法，稳健优先）。
 * 价格不含时间价值（≤ 内在价值）时无解，返回 null。
 */
export function impliedVol(input) {
  const o = input || {};
  const target = Number(o.price);
  const spot = Number(o.spot);
  const strike = Number(o.strike);
  const dte = Number(o.dte);
  const rate = Number.isFinite(Number(o.rate)) ? Number(o.rate) : DEFAULT_RATE;
  const years = dte / 365;
  if (!(target > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const intrinsic = Math.max(0, spot - strike * Math.exp(-rate * years));
  if (target <= intrinsic + 1e-9) return null;
  let lo = 1e-4;
  let hi = 5;
  if (bsCall(spot, strike, years, rate, hi) < target) return null;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bsCall(spot, strike, years, rate, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 链里某一档的报价：优先买卖价中值，没有就退回最新成交价。 */
export function contractMid(call) {
  if (!call) return 0;
  const bid = Number(call.b) || 0;
  const ask = Number(call.a) || 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  const last = Number(call.lp) || 0;
  return last > 0 ? last : (bid > 0 ? bid : ask);
}

/** 某个到期日的 CALL 阶梯，按行权价升序。 */
export function sortedCalls(expiry) {
  return (expiry && Array.isArray(expiry.calls) ? expiry.calls : [])
    .filter(function (c) { return c && Number(c.k) > 0; })
    .slice()
    .sort(function (a, b) { return a.k - b.k; });
}

/** 在链的 CALL 阶梯里找最接近给定行权价的一档。 */
export function nearestCall(calls, strike) {
  const list = Array.isArray(calls) ? calls : [];
  const k = Number(strike);
  if (!list.length || !(k > 0)) return null;
  let best = list[0];
  let bestGap = Math.abs(list[0].k - k);
  for (let i = 1; i < list.length; i += 1) {
    const gap = Math.abs(list[i].k - k);
    if (gap < bestGap) { best = list[i]; bestGap = gap; }
  }
  return best;
}

/** 链里的隐含波动率（在相邻两档之间线性插值，两端各自夹住）。全为 0 时返回 null。 */
export function ivAtStrike(expiry, strike) {
  const calls = sortedCalls(expiry).filter(function (c) { return Number(c.iv) > 0; });
  const k = Number(strike);
  if (!calls.length || !(k > 0)) return null;
  if (k <= calls[0].k) return calls[0].iv;
  const last = calls[calls.length - 1];
  if (k >= last.k) return last.iv;
  for (let i = 1; i < calls.length; i += 1) {
    if (calls[i].k >= k) {
      const a = calls[i - 1];
      const b = calls[i];
      const span = b.k - a.k;
      const t = span > 0 ? (k - a.k) / span : 0;
      return a.iv + (b.iv - a.iv) * t;
    }
  }
  return last.iv;
}

/**
 * 取某一档的波动率：先信链里的 IV；链里没有（Yahoo 兜底路径）就用那一档的成交价反推。
 * 两条路都走不通返回 null。
 */
export function resolveIv(expiry, spot, dte, strike, rate) {
  const direct = ivAtStrike(expiry, strike);
  if (direct > 0) return direct;
  const near = nearestCall(sortedCalls(expiry), strike);
  const price = contractMid(near);
  if (!(price > 0) || !near) return null;
  return impliedVol({ price: price, spot: spot, strike: near.k, dte: dte, rate: rate });
}

/** 从到期日列表里挑最接近目标天数的那个；并列取更早的。 */
export function pickExpiry(expiries, targetDte) {
  const list = (Array.isArray(expiries) ? expiries : []).filter(function (e) { return e && Number(e.dte) >= 1; });
  if (!list.length) return null;
  const target = Number(targetDte) > 0 ? Number(targetDte) : list[0].dte;
  let best = list[0];
  let bestGap = Math.abs(list[0].dte - target);
  for (let i = 1; i < list.length; i += 1) {
    const gap = Math.abs(list[i].dte - target);
    if (gap < bestGap || (gap === bestGap && list[i].dte < best.dte)) { best = list[i]; bestGap = gap; }
  }
  return best;
}

/** 权利金的年化率（%）：单轮权利金 ÷ 现价 × 365 ÷ 剩余天数。 */
export function annualizedPremiumPct(price, spot, dte) {
  const p = Number(price);
  const s = Number(spot);
  const d = Number(dte);
  if (!(p > 0) || !(s > 0) || !(d > 0)) return null;
  return (p / s) * (365 / d) * 100;
}

/**
 * 活跃持仓的当前被行权概率：把用户记的每张 CALL 映射到链上，算 N(d2)。
 * 链里找不到同一天到期就退到最近的到期日；行权价超出链的范围时 IV 会被两端夹住。
 * 返回按概率降序排列的行，算不出的行 prob 为 null（界面显示「—」）。
 */
export function optionProbabilities(chain, options, opts) {
  const settings = opts || {};
  const rate = Number.isFinite(Number(settings.rate)) ? Number(settings.rate) : DEFAULT_RATE;
  const now = Number(settings.now) || Math.floor(Date.now() / 1000);
  const list = (Array.isArray(options) ? options : []).filter(function (o) {
    return o && o.sym && o.type === 'CALL' && !o.settled && !o.archived;
  });
  return list.map(function (o) {
    const row = {
      id: o.id, sym: o.sym, strike: Number(o.strike), contracts: Number(o.contracts) || 1,
      expiry: o.expiry, dte: null, iv: null, prob: null, expiryUsed: '',
    };
    const chainFor = chain && chain.sym === o.sym ? chain : (settings.chains && settings.chains[o.sym]);
    if (!chainFor || !(Number(chainFor.spot) > 0)) return row;
    const dateGap = function (e) { return Math.abs((new Date(e.date + 'T00:00:00Z').getTime() / 1000) - (new Date(o.expiry + 'T00:00:00Z').getTime() / 1000)); };
    const expiries = (chainFor.expiries || []).filter(function (e) { return e && e.dte > 0; });
    if (!expiries.length) return row;
    let expiry = expiries.slice().sort(function (a, b) { return dateGap(a) - dateGap(b); })[0];
    row.dte = expiry.dte;
    row.expiryUsed = expiry.date;
    const iv = resolveIv(expiry, Number(chainFor.spot), expiry.dte, row.strike, rate);
    row.iv = iv;
    row.prob = probITM({ spot: Number(chainFor.spot), strike: row.strike, iv: iv, dte: expiry.dte, rate: rate });
    const near = nearestCall(sortedCalls(expiry), row.strike);
    row.marketPrice = contractMid(near);
    return row;
  }).sort(function (a, b) {
    if (a.prob == null && b.prob == null) return 0;
    if (a.prob == null) return 1;
    if (b.prob == null) return -1;
    return b.prob - a.prob;
  });
}

/** 概率矩阵默认的 OTM 档位（%）。 */
export const MATRIX_OTMS = [3, 5, 7, 10, 15];

/**
 * 概率矩阵：行 = 未来的到期日，列 = 各 OTM%。每格给【真实挂牌那一档】的
 * 行权价 / 被行权概率 / 权利金 / 年化。
 *
 * 三个刻意的取舍：
 * ① **概率与权利金必须同口径**：都用链里最接近目标 OTM 的**真实挂牌档**算。
 *    之前概率用精确目标价、权利金用挂牌价会是两个口径（一行里 138.43 的概率配 140 的权利金），
 *    看着差不多、实际对不上，所以统一到挂牌档。
 * ② **够不到的档显示 null（界面出「—」），不编数**：近月阶梯常被截断
 *    （实测 VGT 8 天那档只挂到现价 +4.4%），5%/7%/10%/15% 会全落到同一档。
 *    与其四列显示同一个数，不如老实说"这档不存在"。偏离目标超过 STRIKE_TOLERANCE 即判为不存在。
 * ③ **只留剩余 ≥ minDte 的到期日**：太近的 IV 噪、阶梯也残缺（SMH 1 天那行实测
 *    15% 的概率比 10% 还高），放进表里只会误导。
 *
 * 表里只有**一个**标记：★ 本轮该卖。所谓"本轮该处理"（手里那张等着结算/行权）和
 * "本轮该卖"本来就是同一轮 —— 到期日当天就把下一档卖出去 —— 拆成两个标记只会让人多读一层，
 * 所以 settle 那套已经去掉（那些持仓的风险在「持仓与收入」里逐张显示）。
 */
export function probMatrix(chain, opts) {
  const o = opts || {};
  const otms = Array.isArray(o.otms) && o.otms.length ? o.otms : MATRIX_OTMS;
  const minDte = Number(o.minDte) > 0 ? Number(o.minDte) : 14;
  const maxRows = Number(o.maxRows) > 0 ? Number(o.maxRows) : 5;
  const rate = Number.isFinite(Number(o.rate)) ? Number(o.rate) : DEFAULT_RATE;
  const spot = Number(chain && chain.spot);
  if (!(spot > 0)) return { otms: otms, rows: [], spot: 0 };
  const beat = String(o.fixed || '');       /* ★ 本轮该卖的那一档 */
  const all = (chain.expiries || []).filter(function (e) { return e && Number(e.dte) > 0; });
  /* ★ 那一档必须始终在表里 —— 它可能离得很近，被 minDte 滤掉的话最该看的那行反而没了。 */
  const picked = [];
  if (beat) {
    const hit = all.filter(function (e) { return e.date === beat; })[0];
    if (hit) picked.push(hit);
  }
  all.forEach(function (e) {
    if (picked.length >= maxRows) return;
    if (Number(e.dte) < minDte) return;
    if (picked.indexOf(e) >= 0) return;
    picked.push(e);
  });
  picked.sort(function (a, b) { return Number(a.dte) - Number(b.dte); });
  const rows = picked.slice(0, maxRows)
    .map(function (e) {
      const cells = otms.map(function (pct) { return matrixCell(e, spot, pct, rate); });
      /* monthly / gapPct 一起带出去：行头悬停要写"这是不是月度到期日、行权价多粗"，
         这样不用展开「到期日历」卡也能判断能不能精确挑到目标 OTM。 */
      return {
        date: e.date, dte: e.dte, sell: e.date === beat,
        monthly: isMonthlyExpiry(e.date), gapPct: Number(e.gapPct) || 0,
        cells: cells, probs: cells.map(function (c) { return c.prob; }),
      };
    });
  /* spot 一起带出去：列头要用它算「这一档 OTM 对应的价格」＝现价 ×(1+OTM%)。 */
  return { otms: otms, rows: rows, spot: spot };
}

/** 挂牌档偏离目标 OTM 超过这个比例就当"这一档不存在"（阶梯够不到）。 */
export const STRIKE_TOLERANCE = 0.02;

/** 标准月度到期日＝每月第三个周五（纯日期判断；VGT 只有这种，SMH 还有周度）。 */
export function isMonthlyExpiry(date) {
  const s = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  const day = Number(s.slice(8, 10));
  return d.getUTCDay() === 5 && day >= 15 && day <= 21;
}

/**
 * 矩阵里的一格：把目标 OTM% 吸附到该到期日**真实挂牌**的那一档，然后用它算概率与权利金。
 * 返回 { pct, strike, target, drift, prob, premium, annualPct }；档位不存在时三个数为 null。
 */
export function matrixCell(expiry, spot, pct, rate) {
  const r = Number.isFinite(Number(rate)) ? Number(rate) : DEFAULT_RATE;
  const sp = Number(spot);
  const target = sp * (1 + Number(pct) / 100);
  const trade = nearestCall(sortedCalls(expiry), target);
  const out = { pct: Number(pct), target: target, strike: 0, drift: null, otmPct: null, prob: null, premium: null, annualPct: null, listed: true };
  if (!trade || !(Number(trade.k) > 0)) { out.listed = false; return out; }
  const strike = Number(trade.k);
  out.strike = strike;
  /* drift＝实际挂牌档相对"你设的目标价"偏了多少（误差项）；
     otmPct＝实际挂牌档相对**现价**高多少（＝这张合约真正的 OTM）——界面主行显示的是后者。 */
  out.drift = strike / target - 1;
  if (sp > 0) out.otmPct = strike / sp - 1;
  if (Math.abs(out.drift) > STRIKE_TOLERANCE) { out.listed = false; return out; }
  const dte = Number(expiry && expiry.dte) || 0;
  const iv = resolveIv(expiry, Number(spot), dte, strike, r);
  out.prob = probITM({ spot: Number(spot), strike: strike, iv: iv, dte: dte, rate: r });
  const mid = contractMid(trade);          /* 真实挂单价：优先买卖价中值 */
  out.premium = mid > 0 ? mid : null;
  out.annualPct = annualizedPremiumPct(out.premium, Number(spot), dte);
  return out;
}
