import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTrendData, trendChartHtml, trendTabsHtml, renderTrendChart } from '../src/app/trend-chart.js';

function info(unit) {
  const closes = [];
  const timestamps = [];
  const divisor = unit === 'seconds' ? 1000 : 1;
  for (let i = 0; i < 260; i += 1) {
    closes.push(i < 200 ? 100 : 100 + (i - 199) * 0.8);
    timestamps.push((Date.UTC(2025, 0, 1) + i * 86400000) / divisor);
  }
  return { closes, timestamps };
}

test('buildTrendData：预热 200 日后生成逐日价格、均线和状态', () => {
  const data = buildTrendData(info());
  assert.equal(data.rows.length, 61);
  assert.ok(data.rows[data.rows.length - 1].price > data.rows[0].price);
  assert.equal(data.counts.bull + data.counts.neutral + data.counts.bear, data.rows.length);
  assert.deepEqual(buildTrendData({ closes: [1, 2], timestamps: [1, 2] }).rows, []);
});

test('trendChartHtml：输出三条线、状态条与近一年统计', () => {
  const html = trendChartHtml(info(), 'VGT');
  assert.match(html, /class="trend-svg"/);
  assert.match(html, /trend-line is-price/);
  assert.match(html, /trend-line is-sma50/);
  assert.match(html, /trend-line is-sma200/);
  assert.match(html, /trend-state is-/);
  assert.match(html, /trend-regime-band is-/);
  assert.match(html, /trend-axis-label/);
  assert.match(html, /trend-current-dot/);
  assert.match(html, /trend-current-price/);
  assert.match(html, /trend-mobile-readout/);
  assert.match(html, /trend-tooltip/);
  assert.match(html, /data-trend-points=/);
  assert.match(html, /data-trendrange="6m"/);
  assert.match(html, /强势 \d+ 天/);
  assert.match(html, /VGT 1 年趋势，共 61 个交易日/);
});

test('趋势图加载与错误状态使用统一组件', () => {
  assert.match(trendChartHtml(null, 'VGT', '1y', { loading: true }), /ds-empty.*is-loading.*正在读取趋势数据/);
  assert.match(trendChartHtml(null, 'VGT', '1y', { error: 'HTTP 503' }), /ds-empty.*is-error.*行情源暂不可用/);
});

test('趋势图禁止长按选择、复制与移动端 callout', () => {
  const css = readFileSync('public/assets/main.css', 'utf8');
  assert.match(css, /\.trend-chart-shell,\.trend-chart-shell \*\{[^}]*-webkit-user-select:none;user-select:none;-webkit-touch-callout:none/);
  assert.match(css, /\.trend-line\.is-sma50\{stroke:var\(--chart-sma50\)[^}]*stroke-dasharray:6 4/);
  assert.match(css, /\.trend-line\.is-sma200\{stroke:var\(--chart-sma200\)[^}]*stroke-dasharray:2 4/);
  assert.match(css, /\.trend-state\.is-bull\{fill:var\(--chart-bull\)\}/);
  assert.match(css, /\.trend-state\.is-bear\{fill:var\(--chart-bear\)\}/);
});

test('趋势图支持 6 个月 / 1 年 / 2 年窗口', () => {
  const closes = [];
  const timestamps = [];
  for (let i = 0; i < 780; i += 1) {
    closes.push(100 + i * 0.1);
    timestamps.push((Date.UTC(2024, 0, 1) + i * 86400000) / 1000);
  }
  const data = { closes, timestamps };
  assert.equal(buildTrendData(data, '6m').rows.length, 126);
  assert.equal(buildTrendData(data, '1y').rows.length, 252);
  assert.equal(buildTrendData(data, '2y').rows.length, 504);
  assert.equal(buildTrendData(data, 'bad').range, '1y');
  const html = trendChartHtml(data, 'IBIT', '2y');
  assert.match(html, /data-trendrange="2y">2 年<\/button>/);
  assert.match(html, /class="trend-range-chip is-on" data-trendrange="2y"/);
});

test('时间戳：Unix 秒与毫秒都显示真实月份，不会落到 1970 年 01/21', () => {
  const secondsData = buildTrendData(info('seconds'));
  assert.ok(secondsData.rows[0].ts >= 1e12, '秒级时间戳应归一化为毫秒');
  const secondsHtml = trendChartHtml(info('seconds'), 'VGT');
  const msHtml = trendChartHtml(info(), 'VGT');
  assert.match(secondsHtml, />开始 2025\/07\/19<\/span><span>截至 2025\/09\/17<\/span>/);
  assert.match(msHtml, />开始 2025\/07\/19<\/span><span>截至 2025\/09\/17<\/span>/);
  assert.doesNotMatch(secondsHtml, /01\/21/);
  assert.doesNotMatch(msHtml, /01\/21/);
});

test('renderTrendChart：写入标的和图表容器', () => {
  const nodes = {
    trendChart: { innerHTML: '' },
    trendSymbol: { textContent: '' },
    trendRangeLabel: { textContent: '' },
    trendAsOf: { textContent: '' },
    trendTabs: { innerHTML: '' },
  };
  const doc = { getElementById(id) { return nodes[id] || null; } };
  renderTrendChart(doc, info(), 'smh', ['VGT', 'SMH', 'IBIT'], '6m');
  assert.equal(nodes.trendSymbol.textContent, 'SMH');
  assert.equal(nodes.trendRangeLabel.textContent, '6 个月');
  assert.match(nodes.trendAsOf.textContent, /^\d{4}\/\d{2}\/\d{2}$/);
  assert.match(nodes.trendChart.innerHTML, /50 日均线/);
  assert.match(nodes.trendChart.innerHTML, /data-trendrange="6m"/);
  assert.match(nodes.trendTabs.innerHTML, /data-trendtab="SMH"/);
  assert.match(nodes.trendTabs.innerHTML, /class="prob-chip is-on" data-trendtab="SMH"/);
  assert.equal(trendTabsHtml('IBIT', ['VGT', 'SMH', 'IBIT']).match(/is-on/g).length, 1);
});
