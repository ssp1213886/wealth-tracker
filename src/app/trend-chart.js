import { escapeHtml } from './render.js';

const CHART_W = 720;
const CHART_H = 300;
const PLOT = { left: 18, right: 676, top: 20, bottom: 222 };
const HISTORY_TOP = 232;
const HISTORY_H = 16;
const RANGE_POINTS = { '6m': 126, '1y': 252, '2y': 504 };
const RANGE_LABELS = { '6m': '6 个月', '1y': '1 年', '2y': '2 年' };

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

/** Yahoo 返回 Unix 秒；同时兼容已经是毫秒的调用方，避免 2026 年被显示成 1970。 */
function timestampMs(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || !(ts > 0)) return NaN;
  return ts < 1e12 ? ts * 1000 : ts;
}

function normalizeRange(value) {
  return RANGE_POINTS[value] ? value : '1y';
}

/** 用日线收盘生成价格、50/200 日均线和逐日状态。 */
export function buildTrendData(info, range) {
  const d = info || {};
  const key = normalizeRange(range);
  const closes = Array.isArray(d.closes) ? d.closes.map(Number) : [];
  const timestamps = Array.isArray(d.timestamps) ? d.timestamps.map(Number) : [];
  const rows = [];
  closes.forEach(function (price, i) {
    const sma50 = averageAt(closes, i, 50);
    const sma200 = averageAt(closes, i, 200);
    const ts = timestampMs(timestamps[i]);
    if (!(price > 0) || !(sma50 > 0) || !(sma200 > 0) || !(ts > 0)) return;
    rows.push({ i: i, ts: ts, price: price, sma50: sma50, sma200: sma200, regime: regimeAt(price, sma50, sma200) });
  });
  const recent = rows.slice(-RANGE_POINTS[key]);
  const counts = { bull: 0, neutral: 0, bear: 0 };
  recent.forEach(function (row) { if (counts[row.regime] != null) counts[row.regime] += 1; });
  return { rows: recent, counts: counts, range: key };
}

function yRange(rows) {
  let min = Infinity;
  let max = -Infinity;
  rows.forEach(function (row) {
    [row.price, row.sma50, row.sma200].forEach(function (value) {
      if (value < min) min = value;
      if (value > max) max = value;
    });
  });
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  return { min: min - pad, max: max + pad };
}

function xAt(index, length) {
  const span = PLOT.right - PLOT.left;
  return PLOT.left + (length <= 1 ? span / 2 : (index / (length - 1)) * span);
}

function yAt(value, min, max) {
  const span = PLOT.bottom - PLOT.top;
  const range = max - min || 1;
  return PLOT.bottom - ((Number(value) - min) / range) * span;
}

function pathFor(rows, valueKey, min, max) {
  return rows.map(function (row, i) {
    return (i ? 'L' : 'M') + xAt(i, rows.length).toFixed(1) + ' ' + yAt(row[valueKey], min, max).toFixed(1);
  }).join(' ');
}

function dateLabel(ms) {
  const d = new Date(timestampMs(ms));
  if (!Number.isFinite(d.getTime())) return '';
  return d.getUTCFullYear() + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0');
}

function priceLabel(value) {
  const n = Number(value);
  if (!(n > 0)) return '—';
  return '$' + (n >= 1000 ? n.toFixed(0) : n >= 100 ? n.toFixed(1) : n.toFixed(2));
}

function regimeBands(rows) {
  const bands = [];
  let start = 0;
  for (let i = 1; i <= rows.length; i += 1) {
    if (i < rows.length && rows[i].regime === rows[start].regime) continue;
    const x0 = start === 0 ? PLOT.left : (xAt(start - 1, rows.length) + xAt(start, rows.length)) / 2;
    const x1 = i === rows.length ? PLOT.right : (xAt(i - 1, rows.length) + xAt(i, rows.length)) / 2;
    bands.push({ regime: rows[start].regime, x: x0, width: Math.max(1, x1 - x0) });
    start = i;
  }
  return bands;
}

function rangeTabsHtml(range) {
  return Object.keys(RANGE_POINTS).map(function (key) {
    return '<button type="button" class="trend-range-chip' + (key === range ? ' is-on' : '') +
      '" data-trendrange="' + key + '">' + RANGE_LABELS[key] + '</button>';
  }).join('');
}

function chartAria(rows, counts, range, symbol) {
  return symbol + ' ' + RANGE_LABELS[range] + '趋势，共 ' + rows.length + ' 个交易日：强势 ' +
    counts.bull + ' 天、中性 ' + counts.neutral + ' 天、弱势 ' + counts.bear + ' 天';
}

function chartMarkup(rows, counts, range, symbol) {
  const bounds = yRange(rows);
  const min = bounds.min;
  const max = bounds.max;
  const pricePath = pathFor(rows, 'price', min, max);
  const sma50Path = pathFor(rows, 'sma50', min, max);
  const sma200Path = pathFor(rows, 'sma200', min, max);
  const firstX = xAt(0, rows.length);
  const lastX = xAt(rows.length - 1, rows.length);
  const areaPath = pricePath + ' L' + lastX.toFixed(1) + ' ' + PLOT.bottom + ' L' + firstX.toFixed(1) + ' ' + PLOT.bottom + ' Z';
  const bands = regimeBands(rows).map(function (band) {
    const cls = band.regime === 'bull' ? 'is-bull' : band.regime === 'bear' ? 'is-bear' : 'is-neutral';
    return '<rect class="trend-regime-band ' + cls + '" x="' + band.x.toFixed(2) + '" y="' + PLOT.top +
      '" width="' + band.width.toFixed(2) + '" height="' + (PLOT.bottom - PLOT.top) + '"></rect>';
  }).join('');
  const stripW = (PLOT.right - PLOT.left) / rows.length;
  const strip = rows.map(function (row, i) {
    const cls = row.regime === 'bull' ? 'is-bull' : row.regime === 'bear' ? 'is-bear' : 'is-neutral';
    return '<rect class="trend-state ' + cls + '" x="' + (PLOT.left + i * stripW).toFixed(2) +
      '" y="' + HISTORY_TOP + '" width="' + Math.max(1, stripW + 0.15).toFixed(2) +
      '" height="' + HISTORY_H + '"></rect>';
  }).join('');
  const yTicks = [0, 1, 2, 3].map(function (i) {
    const value = min + (max - min) * (i / 3);
    const y = yAt(value, min, max);
    return '<line class="trend-grid" x1="' + PLOT.left + '" y1="' + y.toFixed(1) + '" x2="' + PLOT.right + '" y2="' + y.toFixed(1) + '"></line>' +
      '<text class="trend-axis-label" x="' + (CHART_W - 2) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + priceLabel(value) + '</text>';
  }).join('');
  const xTicks = [0, 0.5, 1].map(function (ratio) {
    const x = PLOT.left + (PLOT.right - PLOT.left) * ratio;
    return '<line class="trend-grid is-vertical" x1="' + x.toFixed(1) + '" y1="' + PLOT.top + '" x2="' + x.toFixed(1) + '" y2="' + PLOT.bottom + '"></line>';
  }).join('');
  const currentX = xAt(rows.length - 1, rows.length);
  const currentY = yAt(rows[rows.length - 1].price, min, max);
  const payload = encodeURIComponent(JSON.stringify(rows.map(function (row) {
    return [row.ts, Number(row.price.toFixed(4)), Number(row.sma50.toFixed(4)), Number(row.sma200.toFixed(4)), row.regime];
  })));
  return '<div class="trend-chart-shell" data-trend-points="' + payload + '" data-min="' + min + '" data-max="' + max + '">' +
    '<div class="trend-toolbar"><div class="trend-legend">' +
      '<span><i class="trend-dot is-price"></i>' + escapeHtml(symbol) + '</span>' +
      '<span><i class="trend-dot is-sma50"></i>50 日均线</span>' +
      '<span><i class="trend-dot is-sma200"></i>200 日均线</span>' +
      '<span class="trend-source">Yahoo · 日线</span>' +
    '</div><div class="trend-range-chips">' + rangeTabsHtml(range) + '</div></div>' +
    '<div class="trend-tooltip" role="status" hidden></div>' +
    '<svg class="trend-svg" viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" role="img" aria-label="' + escapeHtml(chartAria(rows, counts, range, symbol)) + '">' +
      '<defs><linearGradient id="trendAreaFill" x1="0" x2="0" y1="0" y2="1">' +
        '<stop class="trend-area-top" offset="0"></stop><stop class="trend-area-bottom" offset="1"></stop>' +
      '</linearGradient></defs>' +
      bands + xTicks + yTicks +
      '<path class="trend-area" d="' + areaPath + '"></path>' +
      '<path class="trend-line is-sma200" d="' + sma200Path + '"></path>' +
      '<path class="trend-line is-sma50" d="' + sma50Path + '"></path>' +
      '<path class="trend-line is-price" d="' + pricePath + '"></path>' +
      '<circle class="trend-current-dot" cx="' + currentX.toFixed(2) + '" cy="' + currentY.toFixed(2) + '" r="4"></circle>' +
      '<circle class="trend-current-halo" cx="' + currentX.toFixed(2) + '" cy="' + currentY.toFixed(2) + '" r="8"></circle>' +
      strip +
      '<g class="trend-hover" visibility="hidden"><line class="trend-crosshair"></line>' +
        '<circle class="trend-hover-dot is-sma200"></circle><circle class="trend-hover-dot is-sma50"></circle>' +
        '<circle class="trend-hover-dot is-price"></circle></g>' +
      '<rect class="trend-hit-area" x="' + PLOT.left + '" y="' + PLOT.top + '" width="' + (PLOT.right - PLOT.left) +
        '" height="' + (PLOT.bottom - PLOT.top) + '"></rect>' +
    '</svg>' +
    '<div class="trend-range"><span>开始 ' + escapeHtml(dateLabel(rows[0].ts)) + '</span><span>截至 ' + escapeHtml(dateLabel(rows[rows.length - 1].ts)) + '</span></div>' +
    '<div class="trend-counts"><span class="is-bull">强势 ' + counts.bull + ' 天</span><span class="is-neutral">中性 ' + counts.neutral + ' 天</span><span class="is-bear">弱势 ' + counts.bear + ' 天</span></div>' +
  '</div>';
}

export function trendChartHtml(info, symbol, range) {
  const data = buildTrendData(info, range);
  const rows = data.rows;
  if (rows.length < 2) return '<div class="trend-empty">历史日线不足，暂时无法绘制趋势图</div>';
  return chartMarkup(rows, data.counts, data.range, String(symbol || '').toUpperCase());
}

export function trendTabsHtml(current, symbols) {
  const list = Array.isArray(symbols) && symbols.length ? symbols : ['VGT', 'SMH', 'IBIT'];
  const active = String(current || '').toUpperCase();
  return list.map(function (symbol) {
    const sym = String(symbol || '').toUpperCase();
    return '<button type="button" class="prob-chip' + (sym === active ? ' is-on' : '') +
      '" data-trendtab="' + escapeHtml(sym) + '">' + escapeHtml(sym) + '</button>';
  }).join('');
}

function bindTrendChart(el) {
  if (!el || typeof el.querySelector !== 'function') return;
  const shell = el.querySelector('.trend-chart-shell');
  const svg = shell && shell.querySelector('.trend-svg');
  const hover = shell && shell.querySelector('.trend-hover');
  const tooltip = shell && shell.querySelector('.trend-tooltip');
  if (!shell || !svg || !hover || !tooltip) return;
  let points;
  try {
    points = JSON.parse(decodeURIComponent(shell.getAttribute('data-trend-points') || ''));
  } catch (e) {
    return;
  }
  if (!Array.isArray(points) || points.length < 2) return;
  const min = Number(shell.getAttribute('data-min'));
  const max = Number(shell.getAttribute('data-max'));
  const cross = hover.querySelector('.trend-crosshair');
  const dot200 = hover.querySelector('.is-sma200');
  const dot50 = hover.querySelector('.is-sma50');
  const dotPrice = hover.querySelector('.is-price');
  const symbolText = (shell.querySelector('.trend-legend span') || {}).textContent || '';
  function hide() {
    hover.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  }
  function blockNativeSelection(event) {
    event.preventDefault();
  }
  function show(event) {
    const rect = svg.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const chartX = ((event.clientX - rect.left) / rect.width) * CHART_W;
    const ratio = Math.max(0, Math.min(1, (chartX - PLOT.left) / (PLOT.right - PLOT.left)));
    const index = Math.round(ratio * (points.length - 1));
    const point = points[index];
    const x = xAt(index, points.length);
    const yPrice = yAt(point[1], min, max);
    const y50 = yAt(point[2], min, max);
    const y200 = yAt(point[3], min, max);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.setAttribute('y1', PLOT.top);
    cross.setAttribute('y2', PLOT.bottom);
    dotPrice.setAttribute('cx', x);
    dotPrice.setAttribute('cy', yPrice);
    dot50.setAttribute('cx', x);
    dot50.setAttribute('cy', y50);
    dot200.setAttribute('cx', x);
    dot200.setAttribute('cy', y200);
    const regime = point[4] === 'bull' ? '强势' : point[4] === 'bear' ? '弱势' : '中性';
    tooltip.innerHTML = '<strong>' + dateLabel(point[0]) + '</strong><span>' +
      escapeHtml(symbolText) + ' <b>' + priceLabel(point[1]) + '</b></span><span>50 日 <b>' + priceLabel(point[2]) +
      '</b></span><span>200 日 <b>' + priceLabel(point[3]) + '</b></span><em>' + regime + '</em>';
    tooltip.style.left = Math.max(8, Math.min(rect.width - 154, chartX / CHART_W * rect.width)) + 'px';
    tooltip.hidden = false;
    hover.setAttribute('visibility', 'visible');
  }
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', function (event) {
    try { svg.setPointerCapture(event.pointerId); } catch (e) {}
    show(event);
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
  shell.addEventListener('selectstart', blockNativeSelection);
  shell.addEventListener('contextmenu', blockNativeSelection);
  shell.addEventListener('dragstart', blockNativeSelection);
}

export function renderTrendChart(doc, info, symbol, symbols, range) {
  const el = doc.getElementById('trendChart');
  const sym = doc.getElementById('trendSymbol');
  const tabs = doc.getElementById('trendTabs');
  if (sym) sym.textContent = String(symbol || '').toUpperCase();
  if (tabs) tabs.innerHTML = trendTabsHtml(symbol, symbols);
  if (el) {
    el.innerHTML = trendChartHtml(info, symbol, range);
    bindTrendChart(el);
  }
}
