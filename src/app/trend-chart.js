import { escapeHtml } from './render.js';

const CHART_W = 360;
const CHART_H = 150;
const PLOT = { left: 16, right: 352, top: 12, bottom: 108 };
const HISTORY_TOP = 124;
const HISTORY_H = 12;

function averageAt(values, index, period) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

function regimeAt(price, sma50, sma200) {
  if (!(price > 0) || !(sma50 > 0) || !(sma200 > 0)) return 'unknown';
  if (price > sma200 * 1.02 && sma50 > sma200) return 'bull';
  if (price < sma200 * 0.98 && sma50 < sma200) return 'bear';
  return 'neutral';
}

/** 用日线收盘生成价格、50/200 日均线和逐日状态；最后一年最多 252 个交易日。 */
export function buildTrendData(info) {
  const d = info || {};
  const closes = Array.isArray(d.closes) ? d.closes.map(Number) : [];
  const timestamps = Array.isArray(d.timestamps) ? d.timestamps.map(Number) : [];
  const rows = [];
  closes.forEach(function (price, i) {
    const sma50 = averageAt(closes, i, 50);
    const sma200 = averageAt(closes, i, 200);
    const ts = timestamps[i];
    if (!(price > 0) || !(sma50 > 0) || !(sma200 > 0) || !(ts > 0)) return;
    rows.push({ i: i, ts: ts, price: price, sma50: sma50, sma200: sma200, regime: regimeAt(price, sma50, sma200) });
  });
  const recent = rows.slice(-252);
  const counts = { bull: 0, neutral: 0, bear: 0 };
  recent.forEach(function (row) { if (counts[row.regime] != null) counts[row.regime] += 1; });
  return { rows: recent, counts: counts };
}

function pathFor(rows, valueKey, min, max) {
  const xSpan = PLOT.right - PLOT.left;
  const ySpan = PLOT.bottom - PLOT.top;
  const range = max - min || 1;
  return rows.map(function (row, i) {
    const x = PLOT.left + (rows.length === 1 ? xSpan / 2 : i * xSpan / (rows.length - 1));
    const y = PLOT.bottom - (Number(row[valueKey]) - min) / range * ySpan;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

function dateLabel(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return '';
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0');
}

export function trendChartHtml(info, symbol) {
  const data = buildTrendData(info);
  const rows = data.rows;
  if (rows.length < 2) {
    return '<div class="trend-empty">历史日线不足，暂时无法绘制趋势图</div>';
  }
  let min = Infinity;
  let max = -Infinity;
  rows.forEach(function (row) {
    [row.price, row.sma50, row.sma200].forEach(function (value) {
      if (value < min) min = value;
      if (value > max) max = value;
    });
  });
  const pad = (max - min) * 0.06 || max * 0.05 || 1;
  min -= pad;
  max += pad;
  const pricePath = pathFor(rows, 'price', min, max);
  const sma50Path = pathFor(rows, 'sma50', min, max);
  const sma200Path = pathFor(rows, 'sma200', min, max);
  const stripW = (PLOT.right - PLOT.left) / rows.length;
  const strip = rows.map(function (row, i) {
    const cls = row.regime === 'bull' ? 'is-bull' : row.regime === 'bear' ? 'is-bear' : 'is-neutral';
    return '<rect class="trend-state ' + cls + '" x="' + (PLOT.left + i * stripW).toFixed(2) +
      '" y="' + HISTORY_TOP + '" width="' + Math.max(1, stripW + 0.15).toFixed(2) +
      '" height="' + HISTORY_H + '"></rect>';
  }).join('');
  const symbolText = String(symbol || '').toUpperCase();
  const total = rows.length;
  const aria = symbolText + ' 近 ' + total + ' 个交易日趋势：强势 ' + data.counts.bull +
    ' 天、中性 ' + data.counts.neutral + ' 天、弱势 ' + data.counts.bear + ' 天';
  return '<div class="trend-legend">' +
      '<span><i class="trend-dot is-price"></i>' + escapeHtml(symbolText) + '</span>' +
      '<span><i class="trend-dot is-sma50"></i>50 日均线</span>' +
      '<span><i class="trend-dot is-sma200"></i>200 日均线</span>' +
    '</div>' +
    '<svg class="trend-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" aria-label="' + escapeHtml(aria) + '">' +
      '<line class="trend-grid" x1="' + PLOT.left + '" y1="' + PLOT.top + '" x2="' + PLOT.right + '" y2="' + PLOT.top + '"></line>' +
      '<line class="trend-grid" x1="' + PLOT.left + '" y1="' + ((PLOT.top + PLOT.bottom) / 2).toFixed(1) + '" x2="' + PLOT.right + '" y2="' + ((PLOT.top + PLOT.bottom) / 2).toFixed(1) + '"></line>' +
      '<line class="trend-grid" x1="' + PLOT.left + '" y1="' + PLOT.bottom + '" x2="' + PLOT.right + '" y2="' + PLOT.bottom + '"></line>' +
      '<path class="trend-line is-sma200" d="' + sma200Path + '"></path>' +
      '<path class="trend-line is-sma50" d="' + sma50Path + '"></path>' +
      '<path class="trend-line is-price" d="' + pricePath + '"></path>' +
      strip +
    '</svg>' +
    '<div class="trend-range"><span>' + escapeHtml(dateLabel(rows[0].ts)) + '</span><span>' + escapeHtml(dateLabel(rows[rows.length - 1].ts)) + '</span></div>' +
    '<div class="trend-counts"><span class="is-bull">强势 ' + data.counts.bull + ' 天</span><span class="is-neutral">中性 ' + data.counts.neutral + ' 天</span><span class="is-bear">弱势 ' + data.counts.bear + ' 天</span></div>';
}

export function renderTrendChart(doc, info, symbol) {
  const el = doc.getElementById('trendChart');
  const sym = doc.getElementById('trendSymbol');
  if (sym) sym.textContent = String(symbol || '').toUpperCase();
  if (el) el.innerHTML = trendChartHtml(info, symbol);
}
