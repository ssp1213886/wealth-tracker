import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUsdCnyRate, extractUsdCnyHistory } from '../src/lib/fx.js';

test('extractUsdCnyRate：优先使用 Yahoo 实时汇率与时间', () => {
  const out = extractUsdCnyRate({
    chart: { result: [{ meta: { regularMarketPrice: 7.1234, regularMarketTime: 1700000000 }, indicators: { quote: [{ close: [7.1] }] } }] },
  });
  assert.equal(out.rate, 7.1234);
  assert.equal(out.asOf, 1700000000000);
});

test('extractUsdCnyRate：实时汇率缺失时使用最后一个有效收盘价', () => {
  const out = extractUsdCnyRate({
    chart: { result: [{ meta: {}, indicators: { quote: [{ close: [null, 7.05, 7.08] }] } }] },
  });
  assert.equal(out.rate, 7.08);
  assert.ok(out.asOf > 0);
});

test('extractUsdCnyRate：没有有效数据时返回 null', () => {
  assert.equal(extractUsdCnyRate({ chart: { result: [{ meta: {}, indicators: { quote: [{ close: [null] }] } }] } }), null);
});

test('extractUsdCnyHistory：保留有效日期和汇率', () => {
  const history = extractUsdCnyHistory({
    chart: { result: [{
      timestamp: [1700000000, 1700086400],
      indicators: { quote: [{ close: [7.1, null] }] },
    }] },
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].date, '2023-11-14');
  assert.equal(history[0].rate, 7.1);
});
