import test from 'node:test';
import assert from 'node:assert/strict';
import { freshnessAge, freshnessHtml, renderFreshness } from '../src/app/freshness.js';

test('freshnessAge：刚刚/分钟/小时/天/未更新', () => {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  assert.equal(freshnessAge(now - 10000, now), '刚刚');
  assert.equal(freshnessAge(now - 12 * 60000, now), '12 分钟前');
  assert.equal(freshnessAge(now - 3 * 3600000, now), '3 小时前');
  assert.equal(freshnessAge(now - 2 * 86400000, now), '2 天前');
  assert.equal(freshnessAge(0, now), '未更新');
});

test('freshnessHtml：现价、日线、期权链和 Cron 都有说明', () => {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  const html = freshnessHtml({
    quoteUpdated: now - 5 * 60000, quoteSource: 'Yahoo',
    regimeUpdated: now - 2 * 3600000,
    chainUpdated: now - 20 * 60000, chainSource: 'CBOE',
  }, now);
  assert.match(html, /现价.*5 分钟前/);
  assert.match(html, /日线.*2 小时前/);
  assert.match(html, /期权链.*20 分钟前/);
  assert.match(html, /每交易日 22:10 UTC/);
  assert.match(html, /来源：Yahoo/);
});

test('renderFreshness：只写数据新鲜度容器', () => {
  let html = '';
  const el = { set innerHTML(v) { html = v; } };
  const doc = { getElementById(id) { return id === 'dataFreshness' ? el : null; } };
  renderFreshness(doc, { quoteUpdated: 1, quoteSource: '缓存' }, 60001);
  assert.match(html, /现价/);
});
