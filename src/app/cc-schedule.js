// 卖 CALL 的固定节奏（纯计算）：下次到期日、距今几天、连续按节奏执行了多少轮，
// 以及从历史派息推下一次除息日。不碰 DOM、不读写存储 —— 日期与配置全部由调用方传入，可离线单测。
//
// 为什么要有"固定节奏"：15-20 年的系统化策略里，日历本身就是纪律。
// 但节奏必须**可预测**才有意义，所以只支持两种每月/每三周可算的规则：
//   monthly3  每月第三个周五（VGT 只有月度期权，只能用它）
//   every3w   每 3 周的周五（SMH 有周期权，回测显示 21 天是区间最优）
// 注意：锚点（从哪个周五起算）在历史回测里能带来 ±1.5pt 的差异，但那是**路径运气**，
// 事前无法优化 —— 所以锚点只提供"可改"，不提供"推荐哪个更好"。

const DAY = 86400000;

/** 支持的节奏与中文名。 */
export const CC_RULES = ['monthly3', 'every3w', 'everyNw'];
/* v374：周期数可配（默认 3 周）—— every3w 保留兼容，everyNw 看 cfg.weeks */
export const RULE_LABELS = { monthly3: '每月第三个周五', every3w: '每 3 周的周五', everyNw: '每 N 周的周五' };
export const RULE_SHORT = { monthly3: '月度', every3w: '每3周', everyNw: '每N周' };

export function weeksOf(sym, cfg) {
  const c = (cfg && cfg[sym]) || {};
  const w = Math.round(Number(c.weeks));
  return Number.isFinite(w) && w >= 1 && w <= 6 ? w : 3;
}

export function ruleLabel(sym, cfg) {
  const rule = ruleFor(sym, cfg);
  if (rule === 'everyNw') return '每 ' + weeksOf(sym, cfg) + ' 周的周五';
  return RULE_LABELS[rule] || rule;
}

/** 每 N 周的周五（N=3 时与 nextEvery3W 等价）。 */
export function nextEveryNw(anchor, weeks, fromDate) {
  const w = Math.round(Number(weeks));
  if (!(w >= 1 && w <= 6)) return null;
  if (w === 3) return nextEvery3W(anchor, fromDate);
  const a = dateMs(anchor);
  const fr = dateMs(fromDate);
  if (!Number.isFinite(a) || !Number.isFinite(fr) || weekdayOf(anchor) !== 5) return null;
  const step = w * 7 * DAY;
  const k = Math.ceil((fr - a) / step);
  return isoOf(a + k * step);
}

/** 'YYYY-MM-DD' → UTC 毫秒；非法返回 NaN。 */
export function dateMs(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value).trim());
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return NaN;
  return ms;
}

export function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 0=周日 … 5=周五。 */
export function weekdayOf(iso) {
  const ms = dateMs(iso);
  return Number.isFinite(ms) ? new Date(ms).getUTCDay() : -1;
}

export function daysBetween(from, to) {
  const a = dateMs(from);
  const b = dateMs(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

/** 默认的吸附窗口：假期周最多把到期日从周五挪到周四，±7 天足够覆盖。 */
const SNAP_WINDOW_DAYS = 7;

/**
 * 把"按日历推出来的节奏档"吸附到市场**真实挂牌**的到期日上。返回 { date, shifted }。
 *
 * 为什么必须有这一步：节奏是纯日历推算（每月第三个周五 / 每 3 周），但市场并不总是照日历走
 * —— 假期周会把周五的到期日**挪到周四**（耶稣受难日那周就是），那天市场上根本没有合约。
 * 指着一张不存在的合约比不显示更糟，所以：
 *   ① 日历日就在挂牌列表里 → 原样返回（绝大多数情况）
 *   ② ±7 天内有挂牌档 → 取最近的那个（假期周顺延到周四就是这种）
 *   ③ 都没有 → 顺延到之后第一个挂牌档；再没有（超出链的范围）就取最后一个
 * 链还没加载（listed 为空）或日期非法时**原样返回**，绝不编一个"已顺延"出来。
 */
export function snapToListed(date, listed, opts) {
  const d = String(date == null ? '' : date).trim();
  const window = Number((opts || {}).windowDays) > 0 ? Number((opts || {}).windowDays) : SNAP_WINDOW_DAYS;
  const list = (Array.isArray(listed) ? listed : [])
    .map(function (x) { return String(x == null ? '' : x).trim(); })
    .filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); })
    .sort();
  if (!d || !Number.isFinite(dateMs(d)) || !list.length) return { date: d, shifted: false };
  if (list.indexOf(d) >= 0) return { date: d, shifted: false };
  const t = dateMs(d);
  let best = null;
  let bestGap = Infinity;
  list.forEach(function (x) {
    const gap = Math.abs(dateMs(x) - t);
    if (gap <= window * DAY && gap < bestGap) { best = x; bestGap = gap; }
  });
  if (best) return { date: best, shifted: true };
  const after = list.filter(function (x) { return dateMs(x) >= t; })[0];
  return { date: after || list[list.length - 1], shifted: true };
}

/** 某年某月的第三个周五（标准月度到期日）。 */
export function thirdFriday(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + 14)).toISOString().slice(0, 10);
}

/** 不早于 fromDate 的下一个月度第三个周五。 */
export function nextMonthly3(fromDate) {
  const ms = dateMs(fromDate);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  for (let i = 0; i < 36; i += 1) {
    const tf = thirdFriday(year, month);
    if (dateMs(tf) >= ms) return tf;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return null;
}

/** 不早于 fromDate 的「锚点 + k×21 天」。锚点必须是周五，否则返回 null。 */
export function nextEvery3W(anchor, fromDate) {
  const a = dateMs(anchor);
  const f = dateMs(fromDate);
  if (!Number.isFinite(a) || !Number.isFinite(f) || weekdayOf(anchor) !== 5) return null;
  const step = 21 * DAY;
  const k = Math.ceil((f - a) / step);
  /* 锚点只定**相位**（每 3 周落哪几个周五），不代表"你从那天才开始"。
     网格必须能往锚点**之前**延伸，否则"上一档"算不出来，卡片就会误以为你手里已经握着锚点那一档。
     例：锚点 10-30、今天 10-08 → 下一次卖出是 10-09（10-30 的上一档），目标 10-30 到期。 */
  return isoOf(a + k * step);
}

/** 过去 count 个已经到过的到期日（不含 fromDate 当天），由近到远。 */
export function pastExpiries(rule, anchor, fromDate, count) {
  const out = [];
  const f = dateMs(fromDate);
  if (!Number.isFinite(f)) return out;
  if (rule === 'every3w') {
    const a = dateMs(anchor);
    if (!Number.isFinite(a)) return out;
    const step = 21 * DAY;
    let k = Math.floor((f - a) / step);
    /* 同上：锚点只是相位，已过的档可以早于锚点（空仓时"上一档"必须算得出来）。 */
    for (let i = 0; out.length < count && i < count + 2; i += 1) {
      const iso = isoOf(a + (k - i) * step);
      if (dateMs(iso) < f) out.push(iso);
    }
    return out;
  }
  const d = new Date(f);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  for (let i = 0; i < count + 2; i += 1) {
    const tf = thirdFriday(year, month);
    if (dateMs(tf) < f) out.push(tf);
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
  }
  return out.sort(function (a, b) { return b.localeCompare(a); }).slice(0, count);
}

/** 某标的的生效节奏：非法值按标的名回落（VGT→monthly3，SMH→every3w）。 */
export function ruleFor(sym, cfg) {
  const c = (cfg && cfg[sym]) || {};
  if (CC_RULES.indexOf(c.rule) >= 0) return c.rule;
  return String(sym).toUpperCase() === 'SMH' ? 'every3w' : 'monthly3';
}

/**
 * 一个标的的节奏摘要：
 *   nextExpiry 下次到期日（= 下次卖出日：到期日当天就卖下一档）
 *   daysToGo   距今天数；0 = 今天就是到期日
 *   isDue      今天该操作（到期日当天）
 */
export function scheduleRow(sym, cfg, fromDate) {
  const c = (cfg && cfg[sym]) || {};
  const rule = ruleFor(sym, cfg);
  const nextExpiry = (rule === 'every3w' || rule === 'everyNw') ? nextEveryNw(c.anchor, rule === 'every3w' ? 3 : weeksOf(sym, cfg), fromDate) : nextMonthly3(fromDate);
  if (!nextExpiry) return null;
  const daysToGo = daysBetween(fromDate, nextExpiry);
  return {
    sym: sym,
    rule: rule,
    label: ruleLabel(sym, cfg),
    short: RULE_SHORT[rule],
    anchor: c.anchor || '',
    nextExpiry: nextExpiry,
    daysToGo: daysToGo,
    isDue: daysToGo === 0,
  };
}

/** 推导用不到 24 个月的日历，避免用户改了锚点后算出一堆噪音。 */
const STREAK_LOOKBACK = 24;

/**
 * 连续按节奏执行的轮数：从最近一个已过的到期日往回数，
 * 只要那一轮在到期日 ±window 天内记过一张 CALL，就算执行了；遇到第一轮没做就停。
 *
 * 设计取舍：**不新增任何存储**，完全从现有 optionTrades 推导 —— 这样不会给老数据引入新字段，
 * 用户也不用额外打卡。代价是"卖出日"用的是固定的节奏日历，而不是他实际的操作日。
 */
export function complianceStreak(optionTrades, sym, cfg, fromDate, opts) {
  const o = opts || {};
  const window = Number(o.window) > 0 ? Number(o.window) : 5;
  const calls = (Array.isArray(optionTrades) ? optionTrades : [])
    .filter(function (x) { return x && String(x.sym).toUpperCase() === String(sym).toUpperCase() && x.type === 'CALL' && x.added; });
  const addedMs = calls.map(function (x) { return dateMs(String(x.added).slice(0, 10)); }).filter(function (v) { return Number.isFinite(v); });
  if (!addedMs.length) return { streak: 0, checked: 0, missed: null, total: 0 };
  const earliest = Math.min.apply(null, addedMs);
  const rule = ruleFor(sym, cfg);
  const anchor = ((cfg && cfg[sym]) || {}).anchor;
  const past = pastExpiries(rule, anchor, fromDate, STREAK_LOOKBACK);
  let streak = 0;
  let checked = 0;
  let missed = null;
  for (let i = 0; i < past.length; i += 1) {
    const target = dateMs(past[i]);
    if (target < earliest - window * DAY) break;   // 那会儿还没开始卖 CALL，不算漏
    checked += 1;
    const hit = addedMs.some(function (m) { return Math.abs(m - target) <= window * DAY; });
    if (hit) streak += 1;
    else { if (!missed) missed = past[i]; break; }
  }
  return { streak: streak, checked: checked, missed: missed, total: calls.length };
}

/**
 * 从历史派息日推下一次除息日。
 *
 * 拿不到"未来的除息日"——公开接口只给已发生的派息，公告一般提前 2-4 周才出。
 * 所以这里按历史规律外推：季度派息的取最近 4 次的月份/日期的中位数，年度派息同理。
 * mode 不写死："季度" 还是 "年度" 由历史间隔判断，换标的也不用改代码。
 * 返回 { date, amount, cadence, estimated:true }，推不出来返回 null。
 */
export function estimateNextExDiv(dividends, fromDate) {
  const list = (Array.isArray(dividends) ? dividends : [])
    .filter(function (d) { return d && Number(d.amount) > 0 && Number.isFinite(dateMs(String(d.date).slice(0, 10))); })
    .map(function (d) { return { date: String(d.date).slice(0, 10), amount: Number(d.amount) }; })
    .sort(function (a, b) { return a.date.localeCompare(b.date); });
  if (list.length < 2) return null;
  const f = dateMs(fromDate);
  if (!Number.isFinite(f)) return null;
  // 用相邻派息的间隔中位数判断频率（季度≈91 天，年度≈365 天）
  const gaps = [];
  for (let i = 1; i < list.length; i += 1) gaps.push((dateMs(list[i].date) - dateMs(list[i - 1].date)) / DAY);
  gaps.sort(function (a, b) { return a - b; });
  const gap = gaps[Math.floor(gaps.length / 2)];
  const stepDays = gap > 200 ? 365 : (gap > 150 ? 182 : (gap > 60 ? 91 : 30));
  const cadence = stepDays >= 365 ? '年度' : (stepDays >= 180 ? '半年' : (stepDays >= 60 ? '季度' : '月度'));
  const amount = list[list.length - 1].amount;
  // 找到最近一次派息，往后按周期推，直到落在 fromDate 之后
  let cursor = dateMs(list[list.length - 1].date);
  for (let i = 0; i < 40 && cursor <= f; i += 1) cursor += stepDays * DAY;
  return { date: isoOf(cursor), amount: amount, cadence: cadence, estimated: true };
}
