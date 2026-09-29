// 期权的纯计算：记录校验、到期状态、行内派生值（剩余天数/虚值实值/距现价）、权利金汇总、OTM 建议行权价。
// 不碰 DOM、不读全局状态（now 与现价由调用方传入），所以可以离线单测。
// 注意：这里**只做搬运**，投资/期权口径保持原样（例如权利金按"每张"记）。
import { cleanText, dateOrdinal } from './util.js';
import { MARKET_TIME_ZONE, zonedDateParts, marketDate, normalizeDateValue } from './time.js';

/** 校验并规整期权记录：标的只认 VGT/SMH，类型只认 CALL/PUT，行权价>0、权利金≥0、到期日必须合法。 */
export function normalizeOptions(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (o, i) {
    const sym = cleanText(o && o.sym, 12).toUpperCase();
    const type = cleanText(o && o.type, 8).toUpperCase();
    const strike = Number(o && o.strike);
    const premium = Number(o && o.premium);
    const contracts = Math.max(1, parseInt(o && o.contracts) || 1);
    const expiry = normalizeDateValue(o && o.expiry);
    const added = normalizeDateValue(o && o.added) || marketDate();
    let id = Number(o && o.id);
    if ((sym !== 'VGT' && sym !== 'SMH') || (type !== 'CALL' && type !== 'PUT') || !expiry || !isFinite(strike) || strike <= 0 || !isFinite(premium) || premium < 0) return null;
    if (!isFinite(id)) id = Date.now() + i + Math.random();
    return { id: id, sym: sym, type: type, strike: strike, premium: premium, contracts: contracts, expiry: expiry, added: added, settled: !!(o && o.settled), archived: !!(o && o.archived) };
  }).filter(Boolean);
}

/**
 * 到期状态：按**美东交易日**算剩余天数。
 * 到期日当天 16:00（960 分钟）之后即视为已过期；非法日期按已过期处理。
 */
export function optionExpiryState(expiry, now) {
  const clock = zonedDateParts(now || new Date(), MARKET_TIME_ZONE);
  const today = clock.year + '-' + clock.month + '-' + clock.day;
  const days = dateOrdinal(expiry) - dateOrdinal(today);
  const afterClose = (Number(clock.hour) || 0) * 60 + (Number(clock.minute) || 0) >= 960;
  const expired = !isFinite(days) || days < 0 || (days === 0 && afterClose);
  return { days: isFinite(days) ? Math.max(0, days) : 0, expired: expired };
}

/** 是否活跃持仓：未结算、未归档、且未过期。 */
export function isActiveOption(o, now) {
  return !!(o && !o.settled && !o.archived && o.expiry && !optionExpiryState(o.expiry, now).expired);
}

/**
 * 期权行需要的全部派生值（原先是散在 renderOpt 里的行内判断）。
 * statusKind: done（已归档/已结算/已过期）| warn（实值临近行权）| live（虚值倒计时）
 */
export function optionRowStatus(o, opts) {
  const now = (opts && opts.now) || new Date();
  const spot = Number(opts && opts.spot) || 0;
  const state = optionExpiryState(o && o.expiry, now);
  const itm = !!(o && o.type === 'CALL' && spot > o.strike);
  let expired = state.expired;
  let statusKind = 'live';
  let statusText = state.days + 'd';
  if (o && o.archived) { statusKind = 'done'; statusText = '已归档'; expired = true; }
  else if (o && o.settled) { statusKind = 'done'; statusText = '已结算'; expired = true; }
  else if (state.expired) { statusKind = 'done'; statusText = '已过期'; }
  else if (itm) { statusKind = 'warn'; statusText = '临近行权 ' + state.days + 'd'; }
  const distancePct = (!expired && spot > 0) ? ((o.strike - spot) / spot * 100) : null;
  return {
    days: state.days,
    expired: expired,
    itm: itm,
    distancePct: distancePct,
    statusKind: statusKind,
    statusText: statusText,
    canAssign: !!(o && o.type === 'CALL' && !expired && !o.settled),
    canSettle: !!(o && !o.settled && expired),
  };
}

/**
 * 权利金汇总与覆盖统计（原先是 updatePnLOpt 里的一串 filter+reduce）：
 * - total          累计权利金 = Σ 每张权利金 × 张数（含已结算/已归档）
 * - month / year   本月 / 本年开仓的权利金（按 added 的年月/年份）
 * - callsThisMonth 本月开仓的 CALL 张数（用于"复投核心仓"那行）
 * - activeCount    活跃持仓数量；nearest 最近到期的那笔
 */
export function optionTotals(list, opts) {
  const items = Array.isArray(list) ? list : [];
  const now = (opts && opts.now) || new Date();
  const ym = (opts && opts.ym) || marketDate(now).slice(0, 7);
  const year = (opts && opts.year) || ym.slice(0, 4);
  let total = 0;
  let month = 0;
  let yearPremium = 0;
  let callsThisMonth = 0;
  items.forEach(function (o) {
    const contracts = Number(o && o.contracts) || 1;
    const amount = (Number(o && o.premium) || 0) * contracts;
    total += amount;
    const added = String((o && o.added) || '');
    if (added.slice(0, 7) === ym) {
      month += amount;
      if (o.type === 'CALL') callsThisMonth += contracts;
    }
    if (added.slice(0, 4) === year) yearPremium += amount;
  });
  const active = items.filter(function (o) { return isActiveOption(o, now); })
    .sort(function (a, b) { return String(a.expiry || '').localeCompare(String(b.expiry || '')); });
  return { total: total, month: month, year: yearPremium, callsThisMonth: callsThisMonth, activeCount: active.length, nearest: active[0] || null };
}

/** OTM 百分比：非法或 0 时回落到默认（与旧实现 `Number(x)||默认` 一致）。 */
export function otmPercent(raw, fallback) {
  const n = Number(raw);
  return n ? n : fallback;
}

/** 加减 OTM 百分比并钳制在 1~20%（设定面板的 +/- 按钮）。 */
export function stepOtmPercent(current, delta, fallback) {
  return Math.min(20, Math.max(1, otmPercent(current, fallback) + (Number(delta) || 0)));
}

/** 建议行权价 = 现价 × (1 + OTM%)；现价缺失返回 0（界面据此不显示）。 */
export function suggestedStrike(price, pct) {
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  return p * (1 + (Number(pct) || 0) / 100);
}
