// 列表行渲染单测（src/app/rows.js）：排序、过滤、方向标签、金额符号、空态与转义。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectTrades, buildTradeRow, buildTradeRows,
  selectCashLogs, cashTotals, buildCashLogRow, buildCashLogRows,
} from '../src/app/rows.js';

const trade = (over) => Object.assign({ id: 1, symbol: 'VGT', date: '2026-01-02', time: '10:00', shares: 1, price: 100, tag: '' }, over);
const cash = (over) => Object.assign({ id: 1, date: '2026-01-02', time: '10:00', type: '入金', amount: 100 }, over);

test('selectTrades：按日期时间倒序排列', () => {
  const list = selectTrades([
    trade({ id: 1, date: '2026-01-01' }),
    trade({ id: 2, date: '2026-01-03' }),
    trade({ id: 3, date: '2026-01-02' }),
  ], '');
  assert.deepEqual(list.map((t) => t.id), [2, 3, 1]);
});

test('selectTrades：同一天按时间倒序，且不修改原数组', () => {
  const input = [trade({ id: 1, time: '09:00' }), trade({ id: 2, time: '15:00' })];
  const list = selectTrades(input, '');
  assert.deepEqual(list.map((t) => t.id), [2, 1]);
  assert.equal(input[0].id, 1, '原数组顺序不应被改变');
});

test('selectTrades：按标的过滤', () => {
  const list = selectTrades([
    trade({ id: 1, symbol: 'VGT' }),
    trade({ id: 2, symbol: 'SMH' }),
  ], 'SMH');
  assert.deepEqual(list.map((t) => t.id), [2]);
});

test('buildTradeRow：买入显示方向标签与股数', () => {
  const html = buildTradeRow(trade({ shares: 1.25, price: 268.4 }));
  assert.ok(html.includes('trade-dir is-buy'));
  assert.ok(html.includes('买入'));
  assert.ok(html.includes('1.25 股'), '应去掉无意义尾零并带单位');
  assert.ok(html.includes('$268.40'));
  assert.ok(html.includes('$335.50'), '金额 = 1.25 × 268.4');
  assert.ok(html.includes('data-cell="qty"'));
});

test('buildTradeRow：卖出用负股数表示，金额取绝对值', () => {
  const html = buildTradeRow(trade({ shares: -0.5, price: 128 }));
  assert.ok(html.includes('trade-dir is-sell'));
  assert.ok(html.includes('卖出'));
  assert.ok(html.includes('0.5 股'));
  assert.ok(html.includes('$64.00'), '金额按绝对值展示');
});

test('buildTradeRow：行权（assign）用蓝色标的高亮', () => {
  const html = buildTradeRow(trade({ tag: 'assign' }));
  assert.ok(html.includes('var(--blue)'));
});

test('buildTradeRows：空列表渲染空态组件', () => {
  const html = buildTradeRows([]);
  assert.ok(html.includes('ds-empty'));
  assert.ok(html.includes('还没有交易记录'));
  assert.ok(html.includes('colspan="6"'));
});

test('buildTradeRows：多行拼接', () => {
  const html = buildTradeRows([trade({ id: 1 }), trade({ id: 2 })]);
  assert.equal(html.split('<tr>').length - 1, 2);
});

test('selectCashLogs：过滤类型并倒序（最新在前）', () => {
  const logs = [
    cash({ id: 1, type: '入金' }),
    cash({ id: 2, type: '出金' }),
    cash({ id: 3, type: '股息' }),
  ];
  assert.deepEqual(selectCashLogs(logs, '').map((l) => l.id), [3, 2, 1]);
  assert.deepEqual(selectCashLogs(logs, '出金').map((l) => l.id), [2]);
});

test('cashTotals：只累计入金与出金，股息不计入', () => {
  const totals = cashTotals([
    cash({ type: '入金', amount: 2000 }),
    cash({ type: '入金', amount: 500 }),
    cash({ type: '出金', amount: 300 }),
    cash({ type: '股息', amount: 12.5 }),
  ]);
  assert.equal(totals.totalIn, 2500);
  assert.equal(totals.totalOut, 300);
});

test('buildCashLogRow：入金为正号，出金为负号并带语义类', () => {
  const inflow = buildCashLogRow(cash({ type: '入金', amount: 2000 }));
  assert.ok(inflow.includes('cash-pos'));
  assert.ok(inflow.includes('+$2,000.00'));

  const outflow = buildCashLogRow(cash({ type: '出金', amount: 500 }));
  assert.ok(outflow.includes('cash-neg'));
  assert.ok(outflow.includes('-$500.00'));
});

test('buildCashLogRow：类型文本被转义，避免注入', () => {
  const html = buildCashLogRow(cash({ type: '<img src=x>', amount: 1 }));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});

test('buildCashLogRows：空列表渲染空态组件', () => {
  const html = buildCashLogRows([]);
  assert.ok(html.includes('ds-empty'));
  assert.ok(html.includes('暂无资金流水'));
});
