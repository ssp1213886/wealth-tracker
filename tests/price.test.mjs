import test from 'node:test';
import assert from 'node:assert/strict';
import { priceHistoryTtlSeconds, priceCacheKey } from '../src/lib/price.js';

test('近期历史行情缓存 15 分钟，远期历史缓存一天', () => {
  assert.equal(priceHistoryTtlSeconds('1y'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('2y'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('ytd'), 15 * 60);
  assert.equal(priceHistoryTtlSeconds('5y'), 24 * 60 * 60);
  assert.equal(priceHistoryTtlSeconds('max'), 24 * 60 * 60);
  assert.equal(priceHistoryTtlSeconds('1d'), 60, '即时区间仍保持 60 秒');
});

test('价格缓存键带版本，部署后立即淘汰旧的 24 小时缓存', () => {
  assert.equal(priceCacheKey('vgt', '2y'), 'price:v2:VGT|2y');
  assert.notEqual(priceCacheKey('VGT', '2y'), 'price:VGT|2y');
});
