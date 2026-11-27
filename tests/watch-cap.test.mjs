// v443：观察列表「市值」口径 —— 一律美元、保留两位小数、按实时价滚动。
import test from 'node:test';
import assert from 'node:assert/strict';
import { configureWatchUI, capText } from '../src/app/watch-ui.js';
import { configureCurrency } from '../src/app/util.js';

test('capText：美元两位小数，不再舍成整数 B', () => {
  configureWatchUI({ capBasePrice: {}, livePrices: {}, watchQuotes: {}, capsFetchedAt: 0 });
  assert.equal(capText(103.81e9, 'NVDA'), '$103.81B');
  assert.equal(capText(3.57e12, 'NVDA'), '$3.57T');
  assert.equal(capText(undefined), '…');
  assert.equal(capText(null), '—');
});

test('capText：按抓取时的基准价滚动到当前价（市值跟着价格走）', () => {
  configureWatchUI({ capBasePrice: { QQQM: 100 }, livePrices: { QQQM: 110 }, watchQuotes: {}, capsFetchedAt: 0 });
  assert.equal(capText(100e9, 'QQQM'), '$110.00B', '抓取时 100B/100 元，现价 110 → 110B');
  configureWatchUI({ capBasePrice: { QQQM: 100 }, livePrices: {}, watchQuotes: { QQQM: { price: 90 } }, capsFetchedAt: 0 });
  assert.equal(capText(100e9, 'QQQM'), '$90.00B', '没有 livePrices 时用观察行情价');
});

test('capText：有抓取时间就带上"截至 MM/DD"', () => {
  const at = new Date(2026, 10, 28, 9, 30).getTime();
  configureWatchUI({ capBasePrice: {}, livePrices: {}, watchQuotes: {}, capsFetchedAt: at });
  assert.match(capText(100e9, 'NVDA'), /^\$100\.00B · 11\/28$/);
  configureWatchUI({ capBasePrice: {}, livePrices: {}, watchQuotes: {}, capsFetchedAt: 0 });
});

test('capText：人民币视图连前缀一起换（不能数值换算完还挂着 $）', () => {
  configureWatchUI({ capBasePrice: {}, livePrices: {}, watchQuotes: {}, capsFetchedAt: 0 });
  configureCurrency('CNY', 7.12);
  assert.equal(capText(100e9, 'X'), '¥712.00B');
  configureCurrency('USD', 7.12);
  assert.equal(capText(100e9, 'X'), '$100.00B');
});
