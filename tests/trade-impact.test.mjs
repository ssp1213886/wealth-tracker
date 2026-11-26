import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeImpact } from '../src/app/trade-impact.js';

const BASE = {
  symbols: ['QQQM', 'VGT', 'SMH'],
  trades: [
    { symbol: 'VGT', shares: 10, price: 100 },
    { symbol: 'SMH', shares: 10, price: 50 },
    { symbol: 'QQQM', shares: 10, price: 260 },
  ],
  prices: { QQQM: 260, VGT: 100, SMH: 50 },
  targets: { QQQM: 0.5, VGT: 0.3, SMH: 0.2 },
  cash: 300,
};

test('tradeImpact：买入显示交易前后占比与现金金额变化', () => {
  const p = tradeImpact(Object.assign({}, BASE, { type: 'buy', symbol: 'VGT', shares: 2, price: 100 }));
  assert.equal(p.ready, true);
  assert.equal(p.amount, 200);
  assert.equal(p.cashAfter, 100);
  assert.ok(Math.abs(p.rows[1].beforePct - 1000 / 4100 * 100) < 1e-12);
  assert.ok(Math.abs(p.rows[1].afterPct - 1200 / 4300 * 100) < 1e-12);
  assert.equal(p.cashBefore, 300);
  assert.equal(p.cashAfter, 100);
  assert.equal(Object.hasOwn(p.rows[0], 'beforeDeviation'), false, '不再计算目标偏离');
  assert.equal(Object.hasOwn(p, 'cashBeforePct'), false, '现金不显示占比');
});

test('tradeImpact：卖出显示回收现金与剩余股数', () => {
  const p = tradeImpact(Object.assign({}, BASE, { type: 'sell', symbol: 'SMH', shares: 5, price: 50 }));
  assert.equal(p.amount, 250);
  assert.equal(p.cashAfter, 550);
  assert.equal(p.remainingShares, 5);
  assert.ok(Math.abs(p.rows[2].beforePct - 500 / 4100 * 100) < 1e-12);
  assert.ok(Math.abs(p.rows[2].afterPct - 250 / 3850 * 100) < 1e-12);
});

test('tradeImpact：空输入仍可展示当前配比，缺价会明确列出', () => {
  const idle = tradeImpact(Object.assign({}, BASE, { type: 'buy', symbol: 'VGT', shares: 0, price: 0 }));
  assert.equal(idle.ready, true);
  assert.equal(idle.hasTrade, false);
  assert.equal(idle.rows[0].beforePct, idle.rows[0].afterPct);
  assert.equal(idle.cashBefore, 300);
  const missing = tradeImpact(Object.assign({}, BASE, {
    prices: { VGT: 100 }, type: 'buy', symbol: 'VGT', shares: 1, price: 100,
  }));
  assert.deepEqual(missing.missingPrices, ['QQQM', 'SMH']);
});
