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

/** 按日期精确找到期日（链里必须有这一天）；找不到返回 null。 */
export function findExpiry(chain, date) {
  const want = String(date == null ? '' : date);
  if (!want) return null;
  const list = (chain && Array.isArray(chain.expiries) ? chain.expiries : []);
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].date === want && list[i].dte > 0) return list[i];
  }
  return null;
}

/**
 * 「行权价参考」那两行的联动：给定 OTM 百分比，算出被行权概率和这一档的权利金。
 *
 * 到期日优先用 o.expiry **精确锁定** —— 也就是「节奏」卡算出来的那一档
 * （VGT 月度第三个周五 / SMH 每 3 周）。这样两张卡说的是同一天，用户不用再手选期限；
 * 链里查不到那天时才退回到"最接近 targetDte"的老行为。
 */
export function planAtOtm(input) {
  const o = input || {};
  const chain = o.chain;
  const sym = String(o.sym || '').toUpperCase();
  const spot = Number(o.spot) || Number(chain && chain.spot);
  const otmPct = Number(o.otmPct);
  const rate = Number.isFinite(Number(o.rate)) ? Number(o.rate) : DEFAULT_RATE;
  if (!(spot > 0) || !(otmPct > 0)) return null;
  const expiry = findExpiry(chain, o.expiry) || pickExpiry(chain && chain.expiries, o.targetDte);
  if (!expiry || !(expiry.dte > 0)) return null;
  const dte = expiry.dte;
  const wantStrike = spot * (1 + otmPct / 100);
  const calls = sortedCalls(expiry);
  const trade = nearestCall(calls, wantStrike);
  const strike = trade ? Number(trade.k) : wantStrike;
  const iv = resolveIv(expiry, spot, dte, strike, rate);
  const marketPrice = contractMid(trade);
  const modelPrice = iv > 0 ? bsCall(spot, strike, dte / 365, rate, iv) : 0;
  const price = marketPrice > 0 ? marketPrice : modelPrice;
  return {
    sym: sym,
    spot: spot,
    dte: dte,
    expiry: expiry.date,
    strike: strike,
    otmPct: (strike / spot - 1) * 100,
    iv: iv,
    prob: probITM({ spot: spot, strike: strike, iv: iv, dte: dte, rate: rate }),
    premium: price,
    premiumIsMarket: marketPrice > 0,
    annualPct: annualizedPremiumPct(price, spot, dte),
  };
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
