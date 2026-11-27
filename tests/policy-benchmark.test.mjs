import test from 'node:test';
import assert from 'node:assert/strict';
import { policyBenchmarkSeries, benchmarkComparison } from '../src/app/policy-benchmark.js';

const flatPrices = {
  months: ['2026-01', '2026-02', '2026-03'],
  cashLog: [
    { date: '2026-01-10', type: '入金', amount: 1000 },
    { date: '2026-02-10', type: '入金', amount: 500 },
  ],
  priceByMonth: {
    QQQM: { '2026-01': 100, '2026-02': 100, '2026-03': 100 },
    VGT: { '2026-01': 100, '2026-02': 100, '2026-03': 100 },
    SMH: { '2026-01': 100, '2026-02': 100, '2026-03': 100 },
  },
};

test('policyBenchmarkSeries：同现金流按目标比例投入，价格不变时等于累计入金', () => {
  const out = policyBenchmarkSeries(flatPrices);
  assert.equal(out.ready, true);
  assert.deepEqual(out.points.map((point) => point.value), [1000, 1500, 1500]);
  assert.equal(out.invested, 1500);
});

test('policyBenchmarkSeries：年度 12 月恢复目标比例', () => {
  const out = policyBenchmarkSeries({
    months: ['2026-01', '2026-02', '2026-12'],
    cashLog: [{ date: '2026-01-10', type: '入金', amount: 1000 }],
    priceByMonth: {
      QQQM: { '2026-01': 100, '2026-02': 200, '2026-12': 200 },
      VGT: { '2026-01': 100, '2026-02': 100, '2026-12': 100 },
      SMH: { '2026-01': 100, '2026-02': 100, '2026-12': 100 },
    },
  });
  assert.equal(out.points[1].value, 1500);
  assert.equal(out.points[2].value, 1500);
});

test('policyBenchmarkSeries：出金按比例卖出，缺价后停止推算', () => {
  const paid = policyBenchmarkSeries({
    months: ['2026-01', '2026-02'],
    cashLog: [
      { date: '2026-01-10', type: '入金', amount: 1000 },
      { date: '2026-02-10', type: '出金', amount: 200 },
    ],
    priceByMonth: {
      QQQM: { '2026-01': 100, '2026-02': 100 },
      VGT: { '2026-01': 100, '2026-02': 100 },
      SMH: { '2026-01': 100, '2026-02': 100 },
    },
  });
  assert.equal(paid.points[1].value, 800);

  const gap = policyBenchmarkSeries({
    months: ['2026-01', '2026-02', '2026-03'],
    cashLog: [{ date: '2026-01-10', type: '入金', amount: 1000 }],
    priceByMonth: {
      QQQM: { '2026-01': 100, '2026-03': 100 },
      VGT: { '2026-01': 100, '2026-03': 100 },
      SMH: { '2026-01': 100, '2026-03': 100 },
    },
  });
  assert.equal(gap.points[1].gap, true);
  assert.equal(gap.points[2].gap, true);
});

test('benchmarkComparison：返回实际组合相对目标基准的差额', () => {
  const comparison = benchmarkComparison(
    { last: { value: 1650 } },
    { last: { value: 1500 } },
  );
  assert.equal(comparison.available, true);
  assert.equal(comparison.delta, 150);
  assert.equal(comparison.pct, 0.1);
});
