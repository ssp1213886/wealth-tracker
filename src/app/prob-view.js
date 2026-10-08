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
    /* 不再写「数据源：」前缀 —— 底部只有这一行小字了，能省一个字是一个 */
    parts.push(escapeHtml(String(label)));
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
 * 「同上」：这一列吸到的行权价和左边最近一个有数的列相同 —— 同一张合约（市场在这段区间
 * 只挂了这一档），不再把同一组数字重复报一遍，否则看着像"卡住了"。
 */
function dittoHtml(strike) {
  return '<span class="mx-prob mx-ditto">〃</span><span class="mx-prem">同上 $' + Number(strike).toFixed(2) + '</span>';
}

/**
 * 概率矩阵。
 *  · 行：未来到期日。sell=true 是本轮该卖的那一档（★）—— 表里只有这一个标记。
 *  · 列头是**可点的按钮** —— 点一下就把 OTM 设成那一档，不需要 +/- 按钮。
 *  · 每格两行：概率（按风险着色）+ 权利金（灰字）；与左边同一张合约的列显示「同上」。
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
  /* 列头第二行：这一档 OTM 对应的价格＝现价 ×(1+OTM%)，给你一个"距离多少钱"的参照。
     实际下单看的是真实挂牌档（可能差一点），那个写在每格的悬停提示里。 */
  const spot = Number(m.spot) || 0;
  /* 刻意不加 .prob-table：那套手机端规则会把 td 变成 grid 单元格，而矩阵要的是横向滚动 */
  let html = '<table class="mx-table"><thead><tr><th>到期日</th><th>剩余</th>' +
    otms.map(function (o) {
      const tgt = spot > 0 ? '<small class="mx-target">$' + (spot * (1 + Number(o) / 100)).toFixed(2) + '</small>' : '';
      return '<th><button type="button" class="mx-col' + (Number(o) === cur ? ' is-on' : '') +
        '" data-probotm="' + o + '" title="把 OTM 设成 ' + o + '%">' + o + '%</button>' + tgt + '</th>';
    }).join('') + '</tr></thead><tbody>';
  rows.forEach(function (r) {
    /* 按 otms 逐列取值，而不是遍历 r.cells —— 万一某行缺几列，直接 map 会少渲染 td、整行错位 */
    const cells = Array.isArray(r.cells) ? r.cells : [];
    const cls = r.sell ? 'mx-sell-row' : '';
    let prevStrike = 0;   /* 左边最近一个有挂牌档的列吸到了哪个行权价 */
    html += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<td data-cell="expiry">' + escapeHtml(r.date) +
        (r.sell ? '<small class="prob-sub mx-sell-tag" title="按你的固定节奏算出来的本期档位（到期日当天卖下一档）">★ 本期</small>' : '') + '</td>' +
      '<td data-cell="dte">' + r.dte + '天</td>' +
      otms.map(function (o, i) {
        const cell = cells[i];
        const listed = !!(cell && cell.listed && cell.prob != null && Number(cell.strike) > 0);
        const same = listed && prevStrike === Number(cell.strike);
        if (listed) prevStrike = Number(cell.strike);
        const title = same ? ('和左边那一列是同一张合约 · ' + cellTitle(cell)) : cellTitle(cell);
        return '<td class="mx-cell' + (Number(o) === cur ? ' mx-on' : '') + (same ? ' mx-same' : '') +
          '" title="' + escapeHtml(title) + '">' +
          (same ? dittoHtml(cell.strike) : matrixCellHtml(cell)) + '</td>';
      }).join('') +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/**
 * 「本期」结论行：整张卡的主结论不再是"你下次该卖哪一档"（那是纯日历推算），
 * 而是**本期做到哪一步了** —— 以今天为准取本期那一档，再看记录里有没有这张 CALL：
 *   已卖出 → 显示你实际卖的行权价 / 张数 / 收到的权利金
 *   未卖出 → 显示按当前 OTM 算出的目标（可以现在补卖）
 *   今天到期 → 最醒目地提示"该卖下一档了"
 * 末尾补一句下一轮：卖出日＝本期到期日（到期日当天卖下一档）+ 这一轮实际持有多久。
 */
/** 下一轮提示：卖出日 → 到期日，以及这一轮真正持有多久（VGT 35 天 / SMH 21 天）。 */
function rollText(roll) {
  const r = roll || {};
  if (!r.from || !r.date) return '';
  return '下一轮 ' + escapeHtml(String(r.from)) + ' 卖出 → ' + escapeHtml(String(r.date)) + ' 到期' +
    (r.tenor != null ? '（持有 ' + r.tenor + ' 天）' : '');
}

/** 当前那一列没挂牌时，退到列里最近的一个有数有档的列；都没有返回 -1。 */
function nearestListedIdx(cells, idx) {
  const list = Array.isArray(cells) ? cells : [];
  const at = idx >= 0 ? idx : 0;
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (!c || c.prob == null || !(c.strike > 0)) continue;
    const gap = Math.abs(i - at);
    if (gap < bestGap) { best = i; bestGap = gap; }
  }
  return best;
}

export function probSummaryHtml(matrix, ctx) {
  const c = ctx || {};
  const m = matrix || { otms: [], rows: [] };
  const row = (Array.isArray(m.rows) ? m.rows : []).filter(function (r) { return r.sell; })[0];
  if (!row) return '<div class="mx-sum mx-sum-empty">还没有可卖的到期档</div>';
  const cur = Number(c.otm);
  const idx = (Array.isArray(m.otms) ? m.otms : []).indexOf(cur);
  const cell = idx >= 0 ? (row.cells || [])[idx] : null;
  const sold = c.sold || null;
  const due = !!c.due;                       /* 今天就是本期到期日（＝该卖下一档的那天） */
  const roll = rollText(c.roll);
  const badge = sold ? '已卖出 ✓' : (due ? '今天该卖' : '未卖出');
  const badgeCls = sold ? 'is-done' : (due ? 'is-due' : 'is-todo');
  const rule = c.ruleLabel ? ' · ' + escapeHtml(String(c.ruleLabel)) : '';
  const head = '<div class="mx-sum-head">本期 <b>' + escapeHtml(row.date) + '</b> · ' +
    (due ? '今天到期' : '还有 ' + row.dte + ' 天') + rule +
    ' <span class="mx-badge ' + badgeCls + '">' + badge + '</span>' +
    (idx < 0 ? ' · ' + cur + '%' : '') + '</div>';
  /* 已卖出：数字全部来自你的记录，不拿行情去猜 */
  if (sold) {
    const n = Number(sold.contracts) || 1;
    const got = (Number(sold.premium) || 0) * n;
    return '<div class="mx-sum">' + head +
      '<div class="mx-sum-main">$' + Number(sold.strike || 0).toFixed(2) + ' <small>×' + n + ' 张</small></div>' +
      '<div class="mx-sum-meta">收 <b>$' + got.toFixed(2) + '</b>' +
        (sold.added ? ' · ' + escapeHtml(String(sold.added)) + ' 卖出' : '') +
        (roll ? ' · ' + roll : '') + '</div></div>';
  }
  if (!cell || cell.prob == null) {
    /* 当前 OTM 在这一档没挂牌（实测 VGT 10-16 上方只到 $135，7% 就够不到）。
       别让结论行变成死胡同 —— 退到最近一个有数的列，直接告诉你现在能卖哪一档。 */
    const alt = nearestListedIdx(row.cells, idx);
    const tip = alt >= 0
      ? ('最近可卖 ' + m.otms[alt] + '% = $' + Number(row.cells[alt].strike).toFixed(2))
      : ('换一档 OTM');
    return '<div class="mx-sum">' + head +
      '<div class="mx-sum-meta">' + cur + '% 在这一档没挂牌档位 · ' + tip +
        (roll ? ' · ' + roll : '') + '</div></div>';
  }
  const drift = (cell.drift || 0) * 100;
  return '<div class="mx-sum">' + head +
    '<div class="mx-sum-main">$' + Number(cell.strike).toFixed(2) +
      ' <small>（' + (drift >= 0 ? '+' : '') + drift.toFixed(1) + '% OTM）</small></div>' +
    '<div class="mx-sum-meta">被行权 <b style="color:' + probColor(cell.prob) + '">' + fmtProb(cell.prob) + '</b>' +
      ' · 权利金 ' + (cell.premium > 0 ? '$' + Number(cell.premium).toFixed(2) : '—') +
      ' · 年化 ' + (cell.annualPct != null ? Number(cell.annualPct).toFixed(1) + '%' : '—') +
      (roll ? ' · ' + roll : '') + '</div></div>';
}

/** 把「本期」结论行写进 DOM。 */
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
