// 「被行权概率」板块的视图层：目标概率反解表、活跃持仓概率表、以及「行权价参考」那两行的概率联动。
// 只负责"把算好的数字写进 DOM"（HTML 构造部分是纯函数，可以直接单测），计算全在 prob.js。
import { fmtFull } from './util.js';
import { emptyStateHTML, escapeHtml } from './render.js';

/** 目标被行权概率的可选档位（%）。 */
export const TARGET_PROB_CHOICES = [5, 10, 15, 20, 25, 30];
/**
 * 目标期限的可选档位（天）。
 * 刻意收在 21~45：22 年回测（含买卖价差）显示净增厚在 2~4 周是一整个高原，
 * 超过 30~35 天开始断崖式衰减（SMH 21 天 +11pt → 43 天 +3pt）。
 */
export const TARGET_DTE_CHOICES = [21, 28, 35, 45];

/** 概率的颜色分级：越容易被行权越红。 */
export function probColor(prob) {
  if (prob == null || !isFinite(prob)) return 'var(--muted)';
  if (prob >= 0.25) return 'var(--red)';
  if (prob >= 0.10) return 'var(--orange)';
  return 'var(--accent)';
}

/** 概率文案：0.1475 → 「14.8%」；null → 「—」。 */
export function fmtProb(prob) {
  if (prob == null || !isFinite(prob)) return '—';
  return (prob * 100).toFixed(1) + '%';
}

/** 波动率文案：0.213 → 「21.3%」；null → 「—」。 */
export function fmtIv(iv) {
  if (!(iv > 0)) return '—';
  return (iv * 100).toFixed(1) + '%';
}

function fmtMoney(value) {
  const n = Number(value);
  if (!(n > 0)) return '—';
  return '$' + n.toFixed(2);
}

function fmtAnnual(pct) {
  const n = Number(pct);
  if (!isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}

/* ---------------- 行情时间 ---------------- */

const MARKET_TZ = 'America/New_York';

/** 某时区在给定 UTC 时刻相对 UTC 的偏移（分钟）。 */
function tzOffsetMinutes(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  dtf.formatToParts(new Date(utcMs)).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return (asUTC - utcMs) / 60000;
}

/**
 * 把 CBOE 的 last_trade_time 解析成绝对时刻（毫秒）。
 *
 * 它给的是「美东挂钟时间、且不带任何时区标记」（例如 "2026-10-07T15:59:58"）。
 * 直接丢给 new Date() 会被当成本地时间 —— 上海用户看到「10-07 15:59」就会以为是
 * 本地时间的旧数据，实际它是美东时间、也就是大约 10 小时前的收盘。必须显式按时区还原。
 * 解析不了返回 null，界面据此不显示时间，而不是编一个出来。
 */
export function parseMarketTime(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(raw == null ? '' : raw).trim());
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  if (!Number.isFinite(guess)) return null;
  // 迭代两次：偏移量本身依赖时刻，夏令时切换当天第一次猜会差一小时
  let ts = guess - tzOffsetMinutes(MARKET_TZ, guess) * 60000;
  ts = guess - tzOffsetMinutes(MARKET_TZ, ts) * 60000;
  return Number.isFinite(ts) ? ts : null;
}

/** 美东的年月日 / 时分。 */
function etParts(ms) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  dtf.formatToParts(new Date(ms)).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
  const hh = Number(p.hour) % 24;
  return { ymd: p.year + '-' + p.month + '-' + p.day, mmdd: p.month + '/' + p.day, hm: (hh < 10 ? '0' : '') + hh + ':' + p.minute };
}

function ageText(ageMin) {
  if (ageMin < 1) return '刚刚';
  if (ageMin < 60) return ageMin + ' 分钟前';
  if (ageMin < 60 * 30) return Math.round(ageMin / 60) + ' 小时前';
  return Math.round(ageMin / 1440) + ' 天前';
}

/**
 * 行情时间的完整文案。
 *   同一天 → 「美东 15:59（12 分钟前）」
 *   隔一天 → 「上一交易日收盘 · 美东 10/07 15:59（11 小时前）」
 * 后者是关键：不然用户看到昨天的日期会以为接口坏了。
 */
export function fmtChainTime(raw, nowMs) {
  const ts = parseMarketTime(raw);
  if (ts == null) return '';
  const now = Number(nowMs) || Date.now();
  const a = etParts(ts);
  const age = ageText(Math.max(0, Math.round((now - ts) / 60000)));
  if (a.ymd === etParts(now).ymd) return '美东 ' + a.hm + '（' + age + '）';
  return '上一交易日收盘 · 美东 ' + a.mmdd + ' ' + a.hm + '（' + age + '）';
}

/** 卡片右上角的紧凑写法：同一天给时刻，隔天只说「上一交易日收盘 · N 小时前」。 */
export function fmtChainTimeShort(raw, nowMs) {
  const ts = parseMarketTime(raw);
  if (ts == null) return '';
  const now = Number(nowMs) || Date.now();
  const a = etParts(ts);
  const age = ageText(Math.max(0, Math.round((now - ts) / 60000)));
  if (a.ymd === etParts(now).ymd) return '美东 ' + a.hm + ' · ' + age;
  return '上一交易日收盘 · ' + age;
}

/** 目标概率 / 目标期限的选项按钮。选中项用 is-on 标记，点击由 index.js 委派处理。 */
export function chipsHtml(choices, current, attr) {
  return choices.map(function (value) {
    const on = Number(value) === Number(current);
    return '<button type="button" class="prob-chip' + (on ? ' is-on' : '') + '" data-' + attr + '="' + value + '">' + value + '</button>';
  }).join('');
}

/**
 * 反解结果表：一行一只标的。
 * rows 为 null / 空时给空态文案（通常是链还没回来）。
 */
export function planRowsHtml(rows, ctx) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const targetProb = Number(ctx && ctx.targetProb);
  if (!list.length) {
    return '<div class="prob-empty">' + escapeHtml((ctx && ctx.emptyHint) || '期权链加载中…') + '</div>';
  }
  let html = '<table class="prob-table"><thead><tr>' +
    '<th>标的</th><th>建议行权价</th><th>OTM</th><th>到期</th><th>IV</th>' +
    '<th>被行权概率</th><th>权利金</th><th>年化</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (r) {
    const probText = fmtProb(r.prob);
    // 注意单位：r.prob 是小数（0.15），targetProb 是百分数（15）——必须换算到同一量纲再比，
    // 否则「命中目标」永远判不成立，脚注会一直挂着（v326 被测试抓到）。
    const hit = Number.isFinite(targetProb) && r.prob != null && Math.abs(r.prob * 100 - targetProb) < 0.5;
    html += '<tr>' +
      '<td data-cell="sym"><strong>' + escapeHtml(r.sym) + '</strong></td>' +
      '<td data-cell="strike">$' + Number(r.strike).toFixed(2) + '</td>' +
      '<td data-cell="otm">' + (r.otmPct >= 0 ? '+' : '') + Number(r.otmPct).toFixed(1) + '%</td>' +
      '<td data-cell="expiry">' + escapeHtml(String(r.expiry || '')) + '<small class="prob-sub">' + (r.dte || 0) + '天</small></td>' +
      '<td data-cell="iv">' + fmtIv(r.iv) + '</td>' +
      '<td data-cell="prob" style="color:' + probColor(r.prob) + ';font-weight:600">' + probText +
        (hit ? '' : '<small class="prob-sub">目标 ' + targetProb + '%</small>') + '</td>' +
      '<td data-cell="premium">' + fmtMoney(r.premium) + (r.premiumIsMarket ? '' : '<small class="prob-sub">理论</small>') + '</td>' +
      '<td data-cell="annual">' + fmtAnnual(r.annualPct) + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/** 活跃持仓的概率表：按概率降序，越红越危险。 */
export function holdingRowsHtml(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return '';
  let html = '<div class="prob-section-title">活跃持仓</div>' +
    '<table class="prob-table"><thead><tr>' +
    '<th>标的</th><th>行权价</th><th>到期</th><th>剩余</th><th>IV</th><th>被行权概率</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (r) {
    html += '<tr>' +
      '<td data-cell="sym"><strong>' + escapeHtml(r.sym) + '</strong><small class="prob-sub">×' + (r.contracts || 1) + '</small></td>' +
      '<td data-cell="strike">$' + Number(r.strike).toFixed(2) + '</td>' +
      '<td data-cell="expiry">' + escapeHtml(String(r.expiry || '')) + '</td>' +
      '<td data-cell="dte">' + (r.dte == null ? '—' : r.dte + '天') + '</td>' +
      '<td data-cell="iv">' + fmtIv(r.iv) + '</td>' +
      '<td data-cell="prob" style="color:' + probColor(r.prob) + ';font-weight:600">' + fmtProb(r.prob) + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/** 数据源与口径说明。source 为 '' 时按"还没拿到"处理。 */
export function noteHtml(meta) {
  const m = meta || {};
  const parts = [];
  if (m.source) {
    const label = m.source === 'cboe' ? 'CBOE 延迟报价' : (m.source === 'yahoo' ? 'Yahoo 期权链（IV 为反推值）' : m.source);
    parts.push('数据源：' + escapeHtml(String(label)));
  }
  /* 时间必须走 fmtChainTime：CBOE 给的是无时区标记的美东时间，
     原样显示会让非美东用户误读成本地时间的旧数据。 */
  const when = fmtChainTime(m.updated, m.nowMs);
  if (when) parts.push(escapeHtml(when));
  const iv = m.iv30;
  if (iv) {
    const ivText = Object.keys(iv)
      .filter(function (k) { return Number(iv[k]) > 0; })
      .map(function (k) { return k + ' ' + fmtIv(Number(iv[k]) / 100); });
    if (ivText.length) parts.push('官方 30 天 IV：' + ivText.join(' · '));
  }
  parts.push('概率＝到期时现价 &gt; 行权价（N(d2)），未含除息日提前行权');
  return parts.join(' · ');
}

/** 把反解表写进 DOM。 */
export function renderProbPlan(doc, rows, ctx) {
  const el = doc.getElementById('probPlan');
  if (el) el.innerHTML = planRowsHtml(rows, ctx);
}

/** 把活跃持仓表写进 DOM。 */
export function renderProbHoldings(doc, rows) {
  const el = doc.getElementById('probHoldings');
  if (el) el.innerHTML = holdingRowsHtml(rows);
}

/** 把数据源 / 口径说明写进 DOM。 */
export function renderProbNote(doc, meta) {
  const el = doc.getElementById('probNote');
  if (el) el.innerHTML = noteHtml(meta);
}

/** 链拿不到时的整体空态（带上原因，别让用户以为是 App 坏了）。 */
export function renderProbUnavailable(doc, hint) {
  const plan = doc.getElementById('probPlan');
  if (plan) plan.innerHTML = emptyStateHTML({ title: '期权链暂不可用', hint: hint || '稍后会自动重试', compact: true });
  const hold = doc.getElementById('probHoldings');
  if (hold) hold.innerHTML = '';
}

/**
 * 「行权价参考」那两行的概率联动。
 * 同一条 OTM 百分比，顺带显示对应的被行权概率；链没回来就先留空，不影响原来的建议行权价。
 */
export function renderOtmProbLine(doc, sym, plan) {
  const el = doc.getElementById(sym === 'VGT' ? 'otmVgtProb' : 'otmSmhProb');
  if (!el) return;
  if (!plan || plan.prob == null) {
    el.textContent = '';
    return;
  }
  el.innerHTML = '被行权概率 <b style="color:' + probColor(plan.prob) + '">' + fmtProb(plan.prob) + '</b>' +
    ' · 权利金 ' + fmtMoney(plan.premium) +
    ' <span style="color:var(--muted)">(' + escapeHtml(String(plan.expiry || '')) + ' 到期 · ' + plan.dte + '天 · IV ' + fmtIv(plan.iv) + ')</span>';
  el.setAttribute('title', '按当前期权链：' + plan.sym + ' $' + Number(plan.strike).toFixed(2) +
    '，年化权利金率 ' + fmtAnnual(plan.annualPct) + '，到期日 ' + plan.expiry);
}

/**
 * 期权到期日历：把市场**真实存在**的到期日列出来，而不是让用户凭记忆手输。
 *
 * 为什么要一栏「类型」：VGT 只有月度（第三个周五），SMH 还有周度/每日 ——
 * 这个差别直接决定"能不能做 21 天的 CC"（见 prob.js 顶部说明），但界面上原本一个字都没有。
 */
export function expiryCalendarHtml(entries, ctx) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const holdings = (ctx && ctx.holdings) || {};
  if (!list.length) {
    return '<div class="prob-empty">' + escapeHtml((ctx && ctx.emptyHint) || '期权链加载中…') + '</div>';
  }
  let html = '<table class="prob-table cal-table"><thead><tr>' +
    '<th>标的</th><th>到期日</th><th>剩余</th><th>类型</th><th>行权价档位</th><th>我的持仓</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (e) {
    const mine = holdings[e.sym + '|' + e.date] || 0;
    html += '<tr' + (mine ? ' class="cal-mine"' : '') + '>' +
      '<td data-cell="sym"><strong>' + escapeHtml(e.sym) + '</strong></td>' +
      '<td data-cell="expiry">' + escapeHtml(e.date) + '</td>' +
      '<td data-cell="dte">' + e.dte + '天</td>' +
      '<td data-cell="kind">' + (e.monthly ? '<span class="cal-tag is-monthly">月度</span>' : '<span class="cal-tag">周度</span>') + '</td>' +
      '<td data-cell="strikes">' + e.calls + ' 档 · $' + Number(e.lo).toFixed(0) + '~$' + Number(e.hi).toFixed(0) + '</td>' +
      '<td data-cell="mine">' + (mine ? mine + ' 张' : '—') + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}
