import { escapeHtml } from './render.js';

export function freshnessAge(timestamp, now) {
  const ts = Number(timestamp);
  if (!(ts > 0)) return '未更新';
  const minutes = Math.max(0, Math.round(((Number(now) || Date.now()) - ts) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  return Math.round(hours / 24) + ' 天前';
}

export function freshnessHtml(data, now) {
  const d = data || {};
  const clock = Number(now) || Date.now();
  const item = function (label, value, detail, tone) {
    return '<span class="freshness-chip ' + (tone || '') + '" title="' + escapeHtml(detail || '') + '">' +
      '<b>' + escapeHtml(label) + '</b>' + escapeHtml(value) + '</span>';
  };
  return '<div class="freshness-row">' +
    item('现价', freshnessAge(d.quoteUpdated, clock), d.quoteSource ? '来源：' + d.quoteSource : '尚未取得行情', 'is-live') +
    item('日线', freshnessAge(d.regimeUpdated, clock), '50/200 日均线由日线收盘计算') +
    item('期权链', freshnessAge(d.chainUpdated, clock), d.chainSource ? '来源：' + d.chainSource : '尚未取得期权链') +
    item('均线扫描', '每交易日 22:10 UTC', 'Cloudflare Cron；确认状态同步到 D1') +
    '</div>';
}

export function renderFreshness(doc, data, now) {
  const el = doc.getElementById('dataFreshness');
  if (el) el.innerHTML = freshnessHtml(data, now);
}
