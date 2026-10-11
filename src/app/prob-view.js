// 「被行权概率」板块的视图层：目标概率反解表、活跃持仓概率表、以及「行权价参考」那两行的概率联动。
// 只负责"把算好的数字写进 DOM"（HTML 构造部分是纯函数，可以直接单测），计算全在 prob.js。
import { fmtFull } from './util.js';
import { emptyStateHTML, escapeHtml } from './render.js';
import { DEFAULT_OPTION_SYMBOLS } from './options.js';

/** 概率的颜色分级：越容易被行权越红。 */
export function probColor(prob) {
  if (prob == null || !isFinite(prob)) return 'var(--muted)';
  if (prob >= 0.25) return 'var(--red)';
  if (prob >= 0.10) return 'var(--orange)';
  return 'var(--ok)';
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
    if (ivText.length) parts.push('<span class="note-iv">官方 30 天 IV：' + ivText.join(' · ') + '</span>');
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
  const parts = ['真实挂牌行权价 $' + Number(cell.strike).toFixed(2)];
  /* 主行写"距现价多少"（完整的 OTM）；"你设的目标价"放悬停里当参照，两个口径别混在一行 */
  if (cell.otmPct != null) parts.push('距现价 ' + (cell.otmPct >= 0 ? '+' : '') + (cell.otmPct * 100).toFixed(1) + '%');
  if (cell.pct != null && Number(cell.target) > 0) parts.push('你设的目标 ' + cell.pct + '% = $' + Number(cell.target).toFixed(2));
  if (cell.annualPct != null) parts.push('年化 ' + Number(cell.annualPct).toFixed(1) + '%');
  return parts.join(' · ');
}

/**
 * 概率矩阵。
 *  · 行：未来到期日。行头只给**事实** —— 剩余天数 · 我持有几张（若有）· 年化（按当前选的 OTM 算）。
 *    v389 起**不再标"该卖哪一档"**：系统不替用户决策，每一行都标年化，横向一比自己挑哪一期。
 *  · 列头是**可点的按钮** —— 点一下就把 OTM 设成那一档，不需要 +/- 按钮。
 *  · 每格两行：概率（按风险着色）+ 权利金（灰字）。相邻两列吸到同一张合约时**照常各写一遍**
 *    —— 「同上」这种简称在手机上没有 hover 可解释，看不懂。
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
  const curIdx = otms.findIndex(function (o) { return Number(o) === cur; });
  /* 列头第二行：这一档 OTM 对应的价格＝现价 ×(1+OTM%)，给你一个"距离多少钱"的参照。
     实际下单看的是真实挂牌档（可能差一点），那个写在每格的悬停提示里。 */
  const spot = Number(m.spot) || 0;
  const heldBy = c.holdings || {};
  /* 刻意不加 .prob-table：那套手机端规则是给「到期日历」用的 */
  let html = '<table class="mx-table"><thead><tr><th>到期日</th>' +
    otms.map(function (o) {
      const tgt = spot > 0 ? '<small class="mx-target">$' + (spot * (1 + Number(o) / 100)).toFixed(2) + '</small>' : '';
      return '<th><button type="button" class="mx-col' + (Number(o) === cur ? ' is-on' : '') +
        '" data-probotm="' + o + '" title="把 OTM 设成 ' + o + '%" aria-label="把 OTM 设成 ' + o + '%">' + o + '%</button>' + tgt + '</th>';
    }).join('') + '</tr></thead><tbody>';
  rows.forEach(function (r) {
    /* 按 otms 逐列取值，而不是遍历 r.cells —— 万一某行缺几列，直接 map 会少渲染 td、整行错位 */
    const cells = Array.isArray(r.cells) ? r.cells : [];
    /* 行头悬停：月度/周度 + 相邻行权价间距 —— 「到期日历」卡的两条独有信息挪到这儿，
       免得切来切去才能判断这一行能不能精确挑到目标 OTM。 */
    const rowTitle = (r.monthly ? '月度到期日（第三个周五）' : '周度到期日') +
      (r.gapPct > 0 ? ' · 相邻行权价间距 ' + Number(r.gapPct).toFixed(2) + '%' : '');
    /* v389：不再标"该卖"。行头只放**事实**：剩余天数 · 我持有几张 · 年化（按当前 OTM 算）。
       年化原来是只给"该卖那一档"看的，现在每一行都有 —— 你自己比一比挑哪一期。 */
    const held = Number(heldBy[r.date]) || 0;
    const cell = curIdx >= 0 ? cells[curIdx] : null;
    const ann = cell && cell.annualPct != null ? Number(cell.annualPct) : null;
    /* 拆两行小字，宽度不超"剩余天数"那一列 —— 挤成一行会把表格撑出横向滚动（8% 那列被截）。
       「持有 N 张」挂在**内联 span** 上，而不是直接写在 small 上：手机端有一条
       `.card small{color:var(--muted)!important}`，写在 small 自身的颜色会被它压掉（v387 的橙色小字
       在手机上其实从没显过色）；挂在子元素上就不受这条继承类规则影响 —— 继承永远输给元素自己的声明。 */
    const sub2 = ann != null ? '年化 ' + ann.toFixed(1) + '%' : '';
    const heldTag = held ? ' · <span class="mx-held-tag">持有 ' + held + ' 张</span>' : '';
    html += '<tr' + (held ? ' class="mx-held-row"' : '') + '>' +
      '<td data-cell="expiry" title="' + escapeHtml(rowTitle) + '">' + escapeHtml(r.date) +
        '<small class="prob-sub">' + r.dte + ' 天' + heldTag + '</small>' +
        (sub2 ? '<small class="prob-sub">' + sub2 + '</small>' : '') + '</td>' +
      otms.map(function (o, i) {
        const cellI = cells[i];
        return '<td class="mx-cell' + (Number(o) === cur ? ' mx-on' : '') +
          '" title="' + escapeHtml(cellTitle(cellI)) + '">' + matrixCellHtml(cellI) + '</td>';
      }).join('') +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/** 把概率矩阵写进 DOM。 */
export function renderProbMatrix(doc, matrix, ctx) {
  const el = doc.getElementById('probMatrix');
  if (el) el.innerHTML = probMatrixHtml(matrix, ctx);
}

/**
 * 标的切换（VGT / SMH / IBIT），与到期日历同一种分段控件。
 * 标的列表由调用方传入（index.js 传 OPTION_SYMS）—— 视图层不再写死标的名，
 * 否则加了新标的会出现"概率卡看不到那一档"（v378 踩过）。
 */
export function probTabsHtml(current, symbols) {
  const list = (Array.isArray(symbols) && symbols.length) ? symbols : DEFAULT_OPTION_SYMBOLS;
  return list.map(function (s) {
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
  if (!list.length) {
    return '<div class="prob-empty">' + escapeHtml(c.emptyHint || '期权链加载中…') + '</div>';
  }
  /* 一次只渲染一个标的（由调用方的 VGT/SMH 分页决定）—— 两个标的的到期日结构差太多，
     摆在同一张表里既难比对，也没法各自"只看近几档"。 */
  const rows = list.slice().sort(function (a, b) { return Number(a.dte) - Number(b.dte); });
  let html = '<table class="prob-table cal-table"><thead><tr>' +
    '<th>到期日</th><th>类型</th><th>行权价间距</th><th>我的持仓</th>' +
    '</tr></thead><tbody>';
  rows.forEach(function (e) {
    const mine = holdings[sym + '|' + e.date] || 0;
    /* 这张卡只讲"市场有哪些到期日"。v389 起全站**没有任何"该卖哪一档"的标记**了
       （概率矩阵也只标"我持有这一档"这个事实），所以这里不再有节奏档 ★。 */
    /* 只显示平值附近相邻行权价的中位间距 —— 它决定"能不能精确挑到目标 OTM%"。
       市场挂牌的**个数**不显示：那是市场侧的事实，不是选行权价需要的输入。 */
    const gap = Number(e.gapPct) > 0 ? Number(e.gapPct).toFixed(2) + '%' : '—';
    /* 剩余天数并进到期日格（第二行小字）：4 列在手机上刚好放得下，不用横滑 */
    html += '<tr' + (mine ? ' class="cal-mine"' : '') + '>' +
      '<td data-cell="expiry">' + escapeHtml(e.date) + '<small class="prob-sub">' + e.dte + ' 天</small></td>' +
      '<td data-cell="kind">' + (e.monthly ? '<span class="cal-tag is-monthly">月度</span>' : '<span class="cal-tag">周度</span>') + '</td>' +
      '<td data-cell="strikes">' + gap + '</td>' +
      '<td data-cell="mine">' + (mine ? mine + ' 张' : '—') + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}
