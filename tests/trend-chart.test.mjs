import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendData, trendChartHtml, renderTrendChart } from '../src/app/trend-chart.js';

function info() {
  const closes = [];
  const timestamps = [];
  for (let i = 0; i < 260; i += 1) {
    closes.push(i < 200 ? 100 : 100 + (i - 199) * 0.8);
    timestamps.push(Date.UTC(2025, 0, 1) + i * 86400000);
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
  assert.match(html, /强势 \d+ 天/);
  assert.match(html, /VGT 近 61 个交易日趋势/);
});

test('renderTrendChart：写入标的和图表容器', () => {
  const nodes = { trendChart: { innerHTML: '' }, trendSymbol: { textContent: '' } };
  const doc = { getElementById(id) { return nodes[id] || null; } };
  renderTrendChart(doc, info(), 'smh');
  assert.equal(nodes.trendSymbol.textContent, 'SMH');
  assert.match(nodes.trendChart.innerHTML, /50 日均线/);
});
