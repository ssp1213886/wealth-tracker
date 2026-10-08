// 「被行权概率」板块的视图层：目标概率反解表、活跃持仓概率表、以及「行权价参考」那两行的概率联动。
// 只负责"把算好的数字写进 DOM"（HTML 构造部分是纯函数，可以直接单测），计算全在 prob.js。
import { fmtFull } from './util.js';
import { emptyStateHTML, escapeHtml } from './render.js';

/** 目标被行权概率的可选档位（%）。 */
export const TARGET_PROB_CHOICES = [5, 10, 15, 20, 25, 30];
/** 目标期限的可选档位（天）。 */
export const TARGET_DTE_CHOICES = [30, 45, 60];

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
    const hit = Number.isFinite(targetProb) && r.prob != null && Math.abs(r.prob - targetProb) < 0.005;
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
  if (m.updated) parts.push('行情时间 ' + escapeHtml(String(m.updated)));
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
    ' <span style="color:var(--muted)">(' + plan.dte + '天 · IV ' + fmtIv(plan.iv) + ')</span>';
  el.setAttribute('title', '按当前期权链：' + plan.sym + ' $' + Number(plan.strike).toFixed(2) +
    '，年化权利金率 ' + fmtAnnual(plan.annualPct) + '（含主动平仓的完整口径见 CC 增厚分析）');
}
