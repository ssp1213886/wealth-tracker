// 「被行权概率」板块的视图层：目标概率反解表、活跃持仓概率表、以及「行权价参考」那两行的概率联动。
// 只负责"把算好的数字写进 DOM"（HTML 构造部分是纯函数，可以直接单测），计算全在 prob.js。
import { fmtFull } from './util.js';
import { emptyStateHTML, escapeHtml } from './render.js';

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
  return parts.join(' · ');
}

/** 把数据源 / 口径说明写进 DOM。 */
export function renderProbNote(doc, meta) {
  const el = doc.getElementById('probNote');
  if (el) el.innerHTML = noteHtml(meta);
}

/**
 * 链拿不到时的提示（带上原因，别让用户以为是 App 坏了）。
 * v330 起反解表没了，改成写在卡片底部的说明行里 —— 注意调用方必须**先** renderProbNote
 * 再调这个，否则会被说明文案覆盖掉。
 */
export function renderProbUnavailable(doc, hint) {
  const el = doc.getElementById('probMatrix');
  if (el) el.innerHTML = '<div class="prob-empty" style="color:var(--orange)">⚠️ 期权链暂不可用：' + escapeHtml(hint || '稍后会自动重试') + '</div>';
}

/**
 * 概率矩阵：行 = 未来到期日，列 = 各 OTM% 下的被行权概率。
 * 当前 OTM 那一列整列高亮；★ 标记本轮该卖的那一档，「本轮该处理」是手里那张。
 */
/**
 * 一格：上面是被行权概率（大字、按风险着色），下面是权利金（灰色小字）。
 * 两行同格 = 不用再来回切「看概率 / 看权利金」，风险与收益一眼同时在。
 * 年化不占格位（放悬停提示里），免得一格挤三行。
 * 这一档没有挂牌行权价（阶梯够不到）时两行都给「—」，不编数。
 */
export function matrixCellHtml(cell) {
  if (!cell || cell.prob == null) {
    return '<span class="mx-prob" style="color:var(--muted)">—</span><span class="mx-prem">—</span>';
  }
  const prem = cell.premium > 0 ? '$' + Number(cell.premium).toFixed(2) : '—';
  return '<span class="mx-prob" style="color:' + probColor(cell.prob) + '">' + fmtProb(cell.prob) + '</span>' +
    '<span class="mx-prem">' + prem + '</span>';
}

/** 单元格的悬浮提示：写出这一格挂在哪个真实行权价上、年化多少。 */
function cellTitle(cell) {
  if (!cell || !(cell.strike > 0)) return '这一档没有挂牌行权价（行权价阶梯够不到该 OTM）';
  const drift = cell.drift == null ? 0 : cell.drift * 100;
  const annual = cell.annualPct != null ? '，年化 ' + Number(cell.annualPct).toFixed(1) + '%' : '';
  return '真实挂牌行权价 $' + Number(cell.strike).toFixed(2) +
    '（比目标 ' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '%）' + annual;
}

/**
 * 概率矩阵。
 *  · 行：未来到期日。sell=true 是本轮该卖的那一档（★），settle=true 是本轮该处理（结算/行权）的那一档。
 *  · 列头是**可点的按钮** —— 点一下就把 OTM 设成那一档，不需要 +/- 按钮。
 *  · 每格两行：概率（按风险着色）+ 权利金（灰字）。
 */
export function probMatrixHtml(matrix, ctx) {
  const c = ctx || {};
  const m = matrix || { otms: [], rows: [] };
  const rows = Array.isArray(m.rows) ? m.rows : [];
  const otms = Array.isArray(m.otms) ? m.otms : [];
  if (!rows.length || !otms.length) {
    return '<div class="prob-empty">' + escapeHtml(c.emptyHint || '期权链加载中…') + '</div>';
  }
  const cur = Number(c.otm);
  /* 刻意不加 .prob-table：那套手机端规则会把 td 变成 grid 单元格，而矩阵要的是横向滚动 */
  let html = '<table class="mx-table"><thead><tr><th>到期日</th><th>剩余</th>' +
    otms.map(function (o) {
      return '<th><button type="button" class="mx-col' + (Number(o) === cur ? ' is-on' : '') +
        '" data-probotm="' + o + '" title="把 OTM 设成 ' + o + '%">' + o + '%</button></th>';
    }).join('') + '</tr></thead><tbody>';
  rows.forEach(function (r) {
    /* 按 otms 逐列取值，而不是遍历 r.cells —— 万一某行缺几列，直接 map 会少渲染 td、整行错位 */
    const cells = Array.isArray(r.cells) ? r.cells : [];
    const cls = (r.sell ? 'mx-sell-row' : '') + (r.settle ? (r.sell ? ' ' : '') + 'mx-settle-row' : '');
    html += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<td data-cell="expiry">' + escapeHtml(r.date) +
        (r.sell ? '<small class="prob-sub mx-sell-tag">★ 本轮该卖</small>'
          : (r.settle ? '<small class="prob-sub mx-settle-tag">本轮该处理</small>' : '')) + '</td>' +
      '<td data-cell="dte">' + r.dte + '天</td>' +
      otms.map(function (o, i) {
        const cell = cells[i];
        return '<td class="mx-cell' + (Number(o) === cur ? ' mx-on' : '') +
          '" title="' + escapeHtml(cellTitle(cell)) + '">' + matrixCellHtml(cell) + '</td>';
      }).join('') +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/**
 * 「本轮该卖」结论行：把 25 个数字收敛成一句话 —— 行权价 / 被行权概率 / 权利金 / 年化。
 * 取的是 ★ 那一行 ∩ 当前 OTM 那一列，也就是你这轮真正会下的单。
 */
/** 两个 'YYYY-MM-DD' 相差几天；格式不对返回 null（界面据此不显示这一句）。 */
function dayGap(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const a = re.test(String(from || '')) ? Date.parse(from + 'T00:00:00Z') : NaN;
  const b = re.test(String(to || '')) ? Date.parse(to + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function probSummaryHtml(matrix, ctx) {
  const c = ctx || {};
  const m = matrix || { otms: [], rows: [] };
  const sell = (Array.isArray(m.rows) ? m.rows : []).filter(function (r) { return r.sell; })[0];
  if (!sell) return '<div class="mx-sum mx-sum-empty">还没有可卖的到期档</div>';
  const cur = Number(c.otm);
  const idx = (Array.isArray(m.otms) ? m.otms : []).indexOf(cur);
  const cell = idx >= 0 ? (sell.cells || [])[idx] : null;
  /* 「还有 N 天」＝从今天到到期日；括号里的「持有 N 天」＝这一轮真正持有多久（卖出日 → 到期日）。
     两者对 3 周节奏的 SMH 差得很远：今天看还有 43 天，但 10-30 卖出、11-20 到期，持有只有 21 天。
     不写清楚的话，VGT(35 天) 和 SMH(21 天) 两张卡都会顶着一个「43 天」，看着像同一个周期。 */
  const from = ((Array.isArray(m.rows) ? m.rows : []).filter(function (r) { return r.settle; })[0] || {}).date || '';
  const tenor = from ? dayGap(from, sell.date) : null;
  const held = (from && tenor != null) ? '（' + escapeHtml(from) + ' 卖出 · 持有 ' + tenor + ' 天）' : '';
  const head = '<div class="mx-sum-head">本轮该卖 <b>' + escapeHtml(sell.date) + '</b> · 还有 ' + sell.dte + ' 天' + held +
    (idx < 0 ? ' · ' + cur + '%' : '') + '</div>';
  if (!cell || cell.prob == null) {
    return '<div class="mx-sum">' + head +
      '<div class="mx-sum-meta">' + cur + '% OTM 在这一档没有挂牌行权价 —— 换一档 OTM 或看下一行</div></div>';
  }
  const drift = (cell.drift || 0) * 100;
  const every = cell.prob > 0 ? Math.round(1 / cell.prob) : 0;
  return '<div class="mx-sum">' + head +
    '<div class="mx-sum-main">$' + Number(cell.strike).toFixed(2) +
      ' <small>（' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '% OTM）</small></div>' +
    '<div class="mx-sum-meta">被行权 <b style="color:' + probColor(cell.prob) + '">' + fmtProb(cell.prob) + '</b>' +
      '（约 ' + every + ' 轮 1 次） · 权利金 ' + (cell.premium > 0 ? '$' + Number(cell.premium).toFixed(2) : '—') +
      ' · 年化 ' + (cell.annualPct != null ? Number(cell.annualPct).toFixed(1) + '%' : '—') + '</div></div>';
}

/** 把「本轮该卖」写进 DOM。 */
export function renderProbSummary(doc, matrix, ctx) {
  const el = doc.getElementById('probSummary');
  if (el) el.innerHTML = probSummaryHtml(matrix, ctx);
}

/** 把概率矩阵写进 DOM。 */
export function renderProbMatrix(doc, matrix, ctx) {
  const el = doc.getElementById('probMatrix');
  if (el) el.innerHTML = probMatrixHtml(matrix, ctx);
}

/** 标的切换（VGT / SMH），与到期日历同一种分段控件。 */
export function probTabsHtml(current) {
  return ['VGT', 'SMH'].map(function (s) {
    return '<button type="button" class="prob-chip' + (s === current ? ' is-on' : '') +
      '" data-probtab="' + s + '">' + s + '</button>';
  }).join('');
}

/**
 * 期权到期日历：把市场**真实存在**的到期日列出来，而不是让用户凭记忆手输。
 *
 * 为什么要一栏「类型」：VGT 只有月度（第三个周五），SMH 还有周度/每日 ——
 * 这个差别直接决定"能不能做 21 天的 CC"（见 prob.js 顶部说明），但界面上原本一个字都没有。
 */
export function expiryCalendarHtml(entries, ctx) {
  const c = ctx || {};
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const holdings = c.holdings || {};
  const sym = String(c.sym || '');
  const fixed = c.fixed || '';   /* 固定节奏该卖的那一档，例如 '2026-10-16' */
  if (!list.length) {
    return '<div class="prob-empty">' + escapeHtml(c.emptyHint || '期权链加载中…') + '</div>';
  }
  /* 一次只渲染一个标的（由调用方的 VGT/SMH 分页决定）—— 两个标的的到期日结构差太多，
     摆在同一张表里既难比对，也没法各自"只看近几档"。 */
  const rows = list.slice().sort(function (a, b) { return Number(a.dte) - Number(b.dte); });
  let html = '<table class="prob-table cal-table"><thead><tr>' +
    '<th>到期日</th><th>剩余</th><th>类型</th><th>行权价间距</th><th>我的持仓</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function (e) {
    const mine = holdings[sym + '|' + e.date] || 0;
    const onBeat = fixed === e.date;
    const cls = (mine ? 'cal-mine' : '') + (onBeat ? (mine ? ' ' : '') + 'cal-onbeat' : '');
    /* 只显示平值附近相邻行权价的中位间距 —— 它决定"能不能精确挑到目标 OTM%"。
       市场挂牌的**个数**不显示：那是市场侧的事实，不是选行权价需要的输入。 */
    const gap = Number(e.gapPct) > 0 ? Number(e.gapPct).toFixed(2) + '%' : '—';
    html += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<td data-cell="expiry">' + escapeHtml(e.date) +
        (onBeat ? '<small class="prob-sub">★ 按节奏该卖这档</small>' : '') + '</td>' +
      '<td data-cell="dte">' + e.dte + '天</td>' +
      '<td data-cell="kind">' + (e.monthly ? '<span class="cal-tag is-monthly">月度</span>' : '<span class="cal-tag">周度</span>') + '</td>' +
      '<td data-cell="strikes">' + gap + '</td>' +
      '<td data-cell="mine">' + (mine ? mine + ' 张' : '—') + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}
