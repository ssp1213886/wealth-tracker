import test from 'node:test';
import assert from 'node:assert/strict';
import { priceHistoryTtlSeconds, priceCacheKey, mergeLatestQuote } from '../src/lib/price.js';

test('近期历史行情缓存 15 分钟，远期历史缓存一天', () => {
  assert.equal(priceHistoryTtlSeconds('1y'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('2y'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('ytd'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('5y'), 24 * 60 * 60);
  assert.equal(priceHistoryTtlSeconds('max'), 24 * 60 * 60);
  assert.equal(priceHistoryTtlSeconds('1d'), 60, '即时区间仍保持 60 秒');
});

test('价格缓存键带版本，部署后立即淘汰旧的 24 小时缓存', () => {
  assert.equal(priceCacheKey('vgt', '2y'), 'price:v3:VGT|2y');
  assert.notEqual(priceCacheKey('VGT', '2y'), 'price:VGT|2y');
});

test('Yahoo 最新日线 close 为空时，用 regularMarketPrice 补齐同日收盘', () => {
  const data = { chart: { result: [{
    meta: { regularMarketPrice: 102.56, regularMarketTime: 1795640400 },
    timestamp: [1795444200, 1795617000],
    indicators: { quote: [{ open: [1, 2], close: [106.41, null], volume: [10, 20] }] },
  }] } };
  mergeLatestQuote(data);
  const row = data.chart.result[0];
  assert.equal(row.timestamp[1], 1795640400);
  assert.equal(row.indicators.quote[0].close[1], 102.56);
});

test('最新行情属于更晚交易日时追加一条日线，否则不污染历史', () => {
  const data = { chart: { result: [{
    meta: { regularMarketPrice: 102.56, regularMarketTime: 1795640400 },
    timestamp: [1795444200],
    indicators: { quote: [{ close: [106.41] }] },
  }] } };
  mergeLatestQuote(data);
  const row = data.chart.result[0];
  assert.deepEqual(row.timestamp, [1795444200, 1795640400]);
  assert.deepEqual(row.indicators.quote[0].close, [106.41, 102.56]);
  assert.equal(mergeLatestQuote(null), null);
});
