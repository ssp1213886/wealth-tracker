import test from 'node:test';
import assert from 'node:assert/strict';
import { MA_PERIODS, movingAverage, sideOf, planMaCrossScan } from '../src/lib/ma-cross.js';

test('movingAverage / sideOf：均线与均线上下侧', () => {
  assert.deepEqual(MA_PERIODS, [50, 200]);
  assert.equal(movingAverage([1, 2, 3, 4], 2), 3.5);
  assert.equal(movingAverage([1, 2], 3), null);
  assert.equal(movingAverage([1, null, 2, NaN, 3], 2), 2.5);
  assert.equal(sideOf(101, 100), 'ABOVE');
  assert.equal(sideOf(99, 100), 'BELOW');
  assert.equal(sideOf(100, 100), null);
  assert.equal(sideOf(0, 100), null);
});

test('planMaCrossScan：首次只建基线，已有状态发生变化才产生事件', () => {
  const closes = Array.from({ length: 200 }, function () { return 100; });
  const plan = planMaCrossScan({
    accounts: [{ id: 1 }, { id: 2 }],
    series: { VGT: { closes: closes, price: 106 } },
    states: [
      { user_id: 1, symbol: 'VGT', period: 50, side: 'BELOW' },
      { user_id: 1, symbol: 'VGT', period: 200, side: 'BELOW' },
    ],
    now: 123456,
  });
  assert.equal(plan.events.length, 2, '账号 1 的 50/200 都从下方上穿');
  assert.deepEqual(plan.events.map(function (e) { return e.period; }).sort(function (a, b) { return a - b; }), [50, 200]);
  plan.events.forEach(function (e) {
    assert.equal(e.user_id, 1);
    assert.equal(e.from_side, 'BELOW');
    assert.equal(e.to_side, 'ABOVE');
    assert.equal(e.average, 100);
    assert.equal(e.triggered_at, 123456);
  });
  assert.equal(plan.nextStates.length, 4, '两个账号 × 两条均线都写基线');
  assert.equal(plan.events.filter(function (e) { return e.user_id === 2; }).length, 0, '新账号首次不补历史提醒');
});

test('planMaCrossScan：无价格/历史不足/同一侧不产生事件', () => {
  const plan = planMaCrossScan({
    accounts: [{ id: 1 }],
    series: {
      VGT: { closes: Array.from({ length: 200 }, function () { return 100; }), price: 106 },
      SMH: { closes: [1, 2, 3], price: 4 },
      IBIT: { closes: Array.from({ length: 200 }, function () { return 100; }), price: 0 },
    },
    states: [{ user_id: 1, symbol: 'VGT', period: 50, side: 'ABOVE' }],
    now: 1,
  });
  assert.equal(plan.events.length, 0);
  assert.equal(plan.nextStates.length, 2, 'VGT 两条均线仍会刷新状态');
});
