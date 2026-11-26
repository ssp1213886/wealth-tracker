import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeImpact } from '../src/app/trade-impact.js';

const BASE = {
  symbols: ['VGT', 'SMH', 'IBIT'],
  trades: [
    { symbol: 'VGT', shares: 10, price: 100 },
    { symbol: 'SMH', shares: 10, price: 50 },
    { symbol: 'IBIT', shares: 10, price: 20 },
  ],
  prices: { VGT: 100, SMH: 50, IBIT: 20 },
  targets: { VGT: 0.5, SMH: 0.3, IBIT: 0.2 },
  cash: 300,
};

test('tradeImpact：买入显示交易前后占比、现金变化与目标偏离', () => {
  const p = tradeImpact(Object.assign({}, BASE, { type: 'buy', symbol: 'VGT', shares: 2, price: 100 }));
  assert.equal(p.ready, true);
  assert.equal(p.amount, 200);
  assert.equal(p.cashAfter, 100);
  assert.ok(Math.abs(p.rows[0].beforePct - 1000 / 1700 * 100) < 1e-12);
  assert.ok(Math.abs(p.rows[0].afterPct - 1200 / 1900 * 100) < 1e-12);
  assert.ok(Math.abs(p.rows[0].beforeDeviation - (1000 / 1700 * 100 - 50)) < 1e-12);
  assert.ok(Math.abs(p.rows[0].afterDeviation - (1200 / 1900 * 100 - 50)) < 1e-12);
  assert.equal(p.cashBeforePct, 15);
  assert.equal(p.cashAfterPct, 5);
  assert.equal(Object.hasOwn(p, 'cashBeforeDeviation'), false, '现金不参与目标偏离');
});

test('tradeImpact：卖出显示回收现金与剩余股数', () => {
  const p = tradeImpact(Object.assign({}, BASE, { type: 'sell', symbol: 'SMH', shares: 5, price: 50 }));
  assert.equal(p.amount, 250);
  assert.equal(p.cashAfter, 550);
  assert.equal(p.remainingShares, 5);
  assert.ok(Math.abs(p.rows[1].beforePct - 500 / 1700 * 100) < 1e-12);
  assert.ok(Math.abs(p.rows[1].afterPct - 250 / 1450 * 100) < 1e-12);
  assert.ok(p.rows[1].improvement < 0);
});

test('tradeImpact：空输入仍可展示当前配比，缺价会明确列出', () => {
  const idle = tradeImpact(Object.assign({}, BASE, { type: 'buy', symbol: 'VGT', shares: 0, price: 0 }));
  assert.equal(idle.ready, true);
  assert.equal(idle.hasTrade, false);
  assert.equal(idle.rows[0].beforePct, idle.rows[0].afterPct);
  assert.equal(idle.cashBeforePct, 300 / 2000 * 100);
  const missing = tradeImpact(Object.assign({}, BASE, {
    prices: { VGT: 100 }, type: 'buy', symbol: 'VGT', shares: 1, price: 100,
  }));
  assert.deepEqual(missing.missingPrices, ['SMH', 'IBIT']);
});
