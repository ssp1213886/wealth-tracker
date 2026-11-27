import test from 'node:test';
import assert from 'node:assert/strict';
import { configureCurrency, currencyCode, displayMoney, fmtFull, fmtNativeFull } from '../src/app/util.js';
import { buildTradeRow, buildCashLogRow } from '../src/app/rows.js';

test('money：默认 USD，原始成交金额始终可用美元格式化', () => {
  configureCurrency('USD', 7.12);
  assert.equal(currencyCode(), 'USD');
  assert.equal(displayMoney(100), 100);
  assert.equal(fmtFull(100), '$100.00');
  assert.equal(fmtNativeFull(100), '$100.00');
});

test('money：CNY 模式只转换展示，不改原始美元值', () => {
  configureCurrency('CNY', 7.12);
  assert.equal(currencyCode(), 'CNY');
  assert.equal(displayMoney(100), 712);
  assert.equal(fmtFull(100), '¥712.00');
  assert.equal(fmtNativeFull(100), '$100.00');
});

test('money：CNY 汇率不可用时显示明确占位，不把美元误标成人民币', () => {
  configureCurrency('CNY', 0);
  assert.equal(fmtFull(100), '¥—');
  configureCurrency('USD', 0);
  assert.equal(fmtFull(100), '$100.00');
});

test('money：CNY 模式只换算估值，交易历史金额仍保留美元', () => {
  configureCurrency('CNY', 7.12);
  const trade = buildTradeRow({ id: 1, symbol: 'VGT', date: '2026-11-01', time: '10:00', shares: 2, price: 100 });
  const cash = buildCashLogRow({ id: 2, date: '2026-11-01', type: '入金', amount: 100 });
  assert.match(trade, /\$200\.00/);
  assert.doesNotMatch(trade, /¥/);
  assert.match(cash, /¥712\.00/);
  configureCurrency('USD', 7.12);
});
