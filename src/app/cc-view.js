// 「卖 CALL 节奏」板块的视图层：下次到期/卖出日、节奏选择、连续执行轮数、除息日一行。
// 只负责把算好的数字写进 DOM（HTML 构造是纯函数，可直接单测），计算全在 cc-schedule.js。
import { escapeHtml } from './render.js';
import { CC_RULES, RULE_LABELS, RULE_SHORT } from './cc-schedule.js';

const WD = '日一二三四五六';

/** 距今文案：0 → 「今天」（高亮提醒该操作了）。 */
export function dueText(daysToGo) {
  const d = Number(daysToGo);
  if (!Number.isFinite(d)) return '—';
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  return d + ' 天';
}

function weekdayOfIso(iso) {
  const ms = Date.parse(String(iso) + 'T00:00:00Z');
  return Number.isFinite(ms) ? WD[new Date(ms).getUTCDay()] : '';
}

/**
 * VGT 在 CBOE 上只有月度到期日（实测 13 个全是第三个周五），所以它的节奏不是"可选项"。
 * 直接锁成月度并写明原因 —— 摆一个选不了的按钮只会让人误以为能做每三周。
 */
const LOCKED_RULE = { VGT: 'monthly3' };

/**
 * 节奏表：一行一个标的。
 * 到期日既是旧档到期、也是新档开仓日（口径是"到期日当天就卖下一档"），所以只列一列。
 * 今天到期的行整行高亮。节奏本身不放表里 —— 下面的按钮/锁定说明已经表达了，重复列一遍是冗余。
 */
export function scheduleRowsHtml(rows, ctx) {
  const c = ctx || {};
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) {
    return '<div class="prob-empty">' + escapeHtml(c.emptyHint || '节奏加载中…') + '</div>';
  }
  let html = '<table class="prob-table cc-table"><thead><tr>' +
    '<th>标的</th><th>下次到期日</th><th>距今</th><th>连续执行</th>' +
    '</tr></thead><tbody>';
  list.forEach(function (r) {
    const streak = c.streaks ? c.streaks[r.sym] : null;
    const n = streak && streak.streak > 0 ? streak.streak : 0;
    const streakText = n > 0
      ? '<span class="cc-streak">✓ ' + n + ' 轮</span>'
      : (streak && streak.total > 0 ? '<span class="cc-missed">本轮未记</span>' : '—');
    html += '<tr' + (r.isDue ? ' class="is-due"' : '') + '>' +
      '<td data-cell="sym"><strong>' + escapeHtml(r.sym) + '</strong></td>' +
      '<td data-cell="expiry">' + escapeHtml(r.nextExpiry) +
        '<small class="prob-sub">周' + escapeHtml(weekdayOfIso(r.nextExpiry)) + '</small></td>' +
      '<td data-cell="days"' + (r.isDue ? ' class="cc-due"' : '') + '>' + escapeHtml(dueText(r.daysToGo)) + '</td>' +
      '<td data-cell="streak">' + streakText + '</td>' +
      '</tr>';
  });
  return html + '</tbody></table>';
}

/** 节奏选择：可选的给按钮；VGT 只有月度，直接给锁定说明。 */
export function rulePickerHtml(sym, current) {
  if (LOCKED_RULE[sym]) {
    return '<span class="cc-locked">' + escapeHtml(RULE_SHORT[LOCKED_RULE[sym]]) + '（VGT 没有周期权）</span>';
  }
  return CC_RULES.map(function (rule) {
    return '<button type="button" class="prob-chip' + (rule === current ? ' is-on' : '') +
      '" data-ccrule="' + escapeHtml(sym) + '|' + rule + '" title="' + escapeHtml(RULE_LABELS[rule]) + '">' +
      escapeHtml(RULE_SHORT[rule]) + '</button>';
  }).join('');
}

/**
 * 除息日一行。只做提示，不做提前行权概率计算 —— 这两个标的股息都很小，
 * 提前行权只在临到期、且已实值、且时间价值被压薄的窄窗口才可能发生，
 * 算概率的复杂度远大于实际价值。
 */
export function exDivLineHtml(items) {
  const list = (Array.isArray(items) ? items : []).filter(function (x) { return x && x.next && x.next.date; });
  if (!list.length) return '';
  const body = list.map(function (x) {
    return escapeHtml(x.sym) + ' 约 ' + escapeHtml(x.next.date) +
      '（$' + Number(x.next.amount).toFixed(3) + '/股 · ' + escapeHtml(x.next.cadence) + '）';
  }).join(' · ');
  return '💰 下次除息（按历史规律推算）：' + body +
    ' —— 若届时股价高于行权价且时间价值被压薄，存在提前行权可能';
}

/** 把节奏表写进 DOM。 */
export function renderSchedule(doc, rows, ctx) {
  const el = doc.getElementById('ccScheduleBody');
  if (el) el.innerHTML = scheduleRowsHtml(rows, ctx);
  const pickers = doc.getElementById('ccRulePickers');
  if (pickers) {
    pickers.innerHTML = ['VGT', 'SMH'].map(function (sym) {
      const cur = (ctx && ctx.rules && ctx.rules[sym]) || '';
      return '<div class="prob-control"><span>' + escapeHtml(sym) + '</span>' +
        '<div class="prob-chips">' + rulePickerHtml(sym, cur) + '</div></div>';
    }).join('');
  }
  const div = doc.getElementById('ccExDiv');
  if (div) div.innerHTML = exDivLineHtml(ctx && ctx.dividends);
}
