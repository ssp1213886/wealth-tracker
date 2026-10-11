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

/** 矩阵最多显示几列（手机一屏放得下的真实档位数）。 */
export const MATRIX_COLS = 4;

/** 阶梯带：只把「高于现价 0~20%」的档当候选（再往上权利金趋近 0，卖它没意义）。 */
export const LADDER_MAX_OTM = 0.2;

/** 这一档在这份阶梯里吗（1 分钱容差；CBOE 的档位都是 0.5/1/2.5/5 的整数倍）。 */
function findStrike(calls, strike) {
  const list = Array.isArray(calls) ? calls : [];
  const k = Number(strike);
  for (let i = 0; i < list.length; i += 1) {
    if (Math.abs(Number(list[i].k) - k) < 0.001) return list[i];
  }
  return null;
}

/**
 * 可卖档位阶梯：**锚定那一行**（＝剩余天数最短的那一行）真实挂牌、且高于现价 ≤20% 的行权价，升序。
 *
 * 为什么用"某一行的阶梯"，而不是"所有行的交集 / 并集"（v391 定稿前的实测取舍）：
 *   · **并集** → 只在这一期挂牌的档，在别的行就变成一格「无此档」，一大片空格看着像坏了；
 *   · **交集** → 远期月份阶梯很粗（实测 VGT 2027-02 那期上方只有 $5 一档），会把整张表压成 2~3 列；
 *   · **锚定最近那一期** → 它是你最先要操作的一期，也一定每列都有报价；别的行缺某一档时照实写
 *     「无此档」—— 那是各期阶梯粗细的真实差异，不该被抹平（VGT 2027-02 确实没有 $137.5）。
 */
export function ladderOf(expiry, spot) {
  const sp = Number(spot);
  if (!(sp > 0)) return [];
  return sortedCalls(expiry)
    .map(function (c) { return Number(c.k); })
    .filter(function (k) {
      const pct = k / sp - 1;
      return pct >= 0 && pct <= LADDER_MAX_OTM;
    });
}

/** 阶梯里离目标 OTM% 最近的那一档的下标（阶梯为空返回 -1）。 */
export function nearestLadderIdx(ladder, spot, otmPct) {
  const list = Array.isArray(ladder) ? ladder : [];
  const sp = Number(spot);
  if (!list.length || !(sp > 0)) return -1;
  const want = sp * (1 + (Number(otmPct) || 0) / 100);
  let best = 0;
  let gap = Math.abs(list[0] - want);
  for (let i = 1; i < list.length; i += 1) {
    const g = Math.abs(list[i] - want);
    if (g < gap) { best = i; gap = g; }
  }
  return best;
}

/**
 * 从阶梯里切出要显示的窗口：以你选中的那一档为锚，让它落在窗口的**第 2 个位置**
 * （左边留一档好往下调，右边留够看上面几档）；到两端时窗口贴边、不越界。
 * 返回 { window, selected }；selected 是选中档在 window 里的下标（阶梯为空时 -1）。
 */
export function matrixWindow(ladder, spot, otmPct, count) {
  const list = Array.isArray(ladder) ? ladder : [];
  const cols = Number(count) > 0 ? Number(count) : MATRIX_COLS;
  const sel = nearestLadderIdx(list, spot, otmPct);
  if (sel < 0) return { window: [], selected: -1, start: 0 };
  const start = Math.min(Math.max(sel - 1, 0), Math.max(0, list.length - cols));
  return { window: list.slice(start, start + cols), selected: sel - start, start: start };
}

/**
 * 概率矩阵：行 = 未来的到期日，列 = **链上真实挂牌档位**（v391 起；以前是"OTM% 目标"）。
 *
 * 为什么列要换成真实档位：OTM% 只是你的想法，能下单的是**行权价**。老口径拿 spot×(1+OTM%)
 * 去吸最近的档、容差 2%，于是 VGT 2026-11-20 那一期 5%/6%/7% 三列**全吸到同一张 $135**
 * （真实 +5.5%），列头却写着链上根本不存在的 $134.38/$135.66/$136.94 —— 手机上（没有悬停）
 * 你一张真实价格都看不到。现在列就是真实档位，OTM% 降级成列头那行小字与选中指针。
 *
 * 三条不变的取舍：
 * ① **概率与权利金同口径**：都用这一档**真实挂牌**的报价与 IV 算（不再有"目标价"这种中间量）。
 * ② **缺档就老实说「无此档」**：那一期阶梯里没有这一档时不吸到隔壁、也不编数。
 * ③ **只留剩余 ≥ minDte 的到期日**：太近的 IV 噪、阶梯也残缺，放进表里只会误导。
 *
 * 表里**没有任何"该卖哪一档"的标记**（v389）：系统不替用户决策。每行只给事实 ——
 * 剩余天数、年化（按当前选中那一列算），界面另标"我持有这一档"。
 *
 * opts：`otm`（你选的 OTM%，驱动窗口位置）、`minDte`、`maxRows`、`cols`、`rate`。
 * 返回 { columns:[{strike,otmPct}], rows, ladder, selected, spot }：
 *   · `ladder` 是这一期的完整候选阶梯（± 按钮靠它逐档移动指针）
 *   · `selected` 是选中列在 columns 里的下标
 */
export function probMatrix(chain, opts) {
  const o = opts || {};
  const minDte = Number(o.minDte) > 0 ? Number(o.minDte) : 14;
  const maxRows = Number(o.maxRows) > 0 ? Number(o.maxRows) : 5;
  const cols = Number(o.cols) > 0 ? Number(o.cols) : MATRIX_COLS;
  const otm = Number(o.otm) || 0;
  const rate = Number.isFinite(Number(o.rate)) ? Number(o.rate) : DEFAULT_RATE;
  const spot = Number(chain && chain.spot);
  if (!(spot > 0)) return { columns: [], rows: [], ladder: [], selected: -1, spot: 0 };
  const all = (chain.expiries || []).filter(function (e) { return e && Number(e.dte) > 0; });
  /* v389：不再有"该卖的那一档"（fixed）—— 表里只按"14 天以上、取前 maxRows 档"来排。 */
  const picked = [];
  all.forEach(function (e) {
    if (picked.length >= maxRows) return;
    if (Number(e.dte) < minDte) return;
    if (picked.indexOf(e) >= 0) return;
    picked.push(e);
  });
  picked.sort(function (a, b) { return Number(a.dte) - Number(b.dte); });
  /* 阶梯锚在**最近的那一行**上（它一定有报价、也是你最先操作的一期）；那一行没档就顺延到下一行。
     注意：行对象里的 gapPct 仍然是**各期自己**的档距（悬停里要写"这一期档位多粗"）。 */
  const shown = picked.slice(0, maxRows);
  let ladder = [];
  for (let i = 0; i < shown.length && !ladder.length; i += 1) ladder = ladderOf(shown[i], spot);
  const win = matrixWindow(ladder, spot, otm, cols);
  const rows = shown
    .map(function (e) {
      const cells = win.window.map(function (k) { return matrixCellAt(e, spot, k, rate); });
      /* monthly / gapPct 一起带出去：行头悬停要写"这是不是月度到期日、行权价多粗"，
         这样不用展开「到期日历」卡也能判断能不能精确挑到目标 OTM。 */
      return {
        date: e.date, dte: e.dte,
        monthly: isMonthlyExpiry(e.date), gapPct: Number(e.gapPct) || 0,
        cells: cells, probs: cells.map(function (c) { return c.prob; }),
      };
    });
  return {
    columns: win.window.map(function (k) { return { strike: k, otmPct: k / spot - 1 }; }),
    rows: rows, ladder: ladder, selected: win.selected,
    /* selectedAbs＝选中档在**完整阶梯**里的下标（± 靠它走相邻真实档）。
       只给窗口内下标的 selected 会导致 ± 走错档 —— 实测过（VGT 点 + 从 $135 跳到 $129.38）。 */
    selectedAbs: win.selected < 0 ? -1 : win.start + win.selected,
    spot: spot,
  };
}

/** 标准月度到期日＝每月第三个周五（纯日期判断；VGT 只有这种，SMH 还有周度）。 */
export function isMonthlyExpiry(date) {
  const s = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  const day = Number(s.slice(8, 10));
  return d.getUTCDay() === 5 && day >= 15 && day <= 21;
}

/**
 * 矩阵里的一格：**直接取这一档**在该到期日的真实报价，算概率 / 权利金 / 年化。
 *
 * v391 起不再有"目标价"与吸附容差 —— 列本身就是真实档位，
 * 所以只有两种结果：这一期有这一档（listed=true，三个数都算得出来）或没有（listed=false，界面写「无此档」）。
 * 返回 { strike, otmPct, prob, premium, annualPct, listed }。
 */
export function matrixCellAt(expiry, spot, strike, rate) {
  const r = Number.isFinite(Number(rate)) ? Number(rate) : DEFAULT_RATE;
  const sp = Number(spot);
  const k = Number(strike);
  const out = { strike: k, otmPct: sp > 0 && k > 0 ? k / sp - 1 : null, prob: null, premium: null, annualPct: null, listed: false };
  if (!(sp > 0) || !(k > 0)) return out;
  const trade = findStrike(sortedCalls(expiry), k);
  if (!trade) return out;
  out.listed = true;
  const dte = Number(expiry && expiry.dte) || 0;
  const iv = resolveIv(expiry, sp, dte, k, r);
  out.prob = probITM({ spot: sp, strike: k, iv: iv, dte: dte, rate: r });
  const mid = contractMid(trade);          /* 真实挂单价：优先买卖价中值 */
  out.premium = mid > 0 ? mid : null;
  out.annualPct = annualizedPremiumPct(out.premium, sp, dte);
  return out;
}
