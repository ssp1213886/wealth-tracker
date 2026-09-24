// 持仓与盈亏计算单测（src/app/calc.js）—— 这部分是"算错了也不会报错、只会算错钱"的地方
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHoldings, buildPositionRows } from '../src/app/calc.js';

const trade = (id, symbol, shares, price, date) => ({ id, symbol, shares, price, date });

test('computeHoldings: 单次买入', () => {
  const r = computeHoldings([trade(1, 'VGT', 10, 100, '2026-01-02')]);
  assert.equal(r.holdings.VGT.shares, 10);
  assert.equal(r.holdings.VGT.cost, 1000);
  assert.equal(r.holdings.VGT.realized, 0);
  assert.equal(r.totalBuys, 1000);
  assert.equal(r.totalInvested, 1000);
  assert.equal(r.totalRealized, 0);
});

test('computeHoldings: 分批买入按加权平均结转', () => {
  const r = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', 10, 120, '2026-01-03'),
  ]);
  assert.equal(r.holdings.VGT.shares, 20);
  assert.equal(r.holdings.VGT.cost, 2200);
  assert.equal(r.holdings.VGT.cost / r.holdings.VGT.shares, 110);
});

test('computeHoldings: 卖出按当时均价结转成本并记已实现盈亏', () => {
  const r = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', 10, 120, '2026-01-03'),
    trade(3, 'VGT', -5, 150, '2026-01-04'),
  ]);
  // 均价 110 → 卖出 5 股转出成本 550，收入 750，已实现 +200
  assert.equal(r.holdings.VGT.shares, 15);
  assert.equal(r.holdings.VGT.cost, 1650);
  assert.equal(r.holdings.VGT.realized, 200);
  assert.equal(r.totalRealized, 200);
});

test('computeHoldings: 全部清仓后剩余股数为 0、成本归零', () => {
  const r = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', -10, 130, '2026-01-05'),
  ]);
  assert.equal(r.holdings.VGT.shares, 0);
  assert.equal(r.holdings.VGT.cost, 0);
  assert.equal(r.holdings.VGT.realized, 300);
});

test('computeHoldings: 录入顺序打乱也按日期先后计算', () => {
  const sorted = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', -5, 150, '2026-01-04'),
  ]);
  const shuffled = computeHoldings([
    trade(2, 'VGT', -5, 150, '2026-01-04'),
    trade(1, 'VGT', 10, 100, '2026-01-02'),
  ]);
  assert.deepEqual(shuffled.holdings.VGT, sorted.holdings.VGT);
  assert.equal(shuffled.holdings.VGT.realized, 250);
});

test('computeHoldings: 多标的互不影响', () => {
  const r = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'SMH', 4, 250, '2026-01-02'),
    trade(3, 'VGT', -2, 110, '2026-01-03'),
  ]);
  assert.equal(r.holdings.SMH.shares, 4);
  assert.equal(r.holdings.SMH.cost, 1000);
  assert.equal(r.holdings.VGT.shares, 8);
  assert.equal(r.holdings.VGT.cost, 800);
});

test('buildPositionRows: 有价格时算出市值、未实现盈亏、收益率', () => {
  const { holdings } = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', 10, 120, '2026-01-03'),
  ]);
  const r = buildPositionRows(holdings, { VGT: 165 });
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.sym, 'VGT');
  assert.equal(row.shares, 20);
  assert.equal(row.avgCost, 110);
  assert.equal(row.priced, true);
  assert.equal(row.value, 3300);
  assert.equal(row.unrealPnL, 1100);
  assert.equal(row.pnlPct, 0.5);
  assert.equal(r.totalValue, 3300);
  assert.equal(r.totalCost, 2200);
  assert.equal(r.hasPriced, true);
});

test('buildPositionRows: 没有价格时标记未定价并不计入市值', () => {
  const { holdings } = computeHoldings([trade(1, 'VGT', 10, 100, '2026-01-02')]);
  const r = buildPositionRows(holdings, {});
  assert.equal(r.rows.length, 1);
  // 现状：没有报价时 priced 是 undefined（prices[sym] && prices[sym]>0 的结果），
  // 消费方都用真值判断，所以行为上等价于 false。
  assert.ok(!r.rows[0].priced);
  assert.equal(r.rows[0].value, null);
  assert.equal(r.hasPriced, false);
  assert.deepEqual(r.unpriced, ['VGT']);
});

test('buildPositionRows: 已清仓的标的不出现在行里', () => {
  const { holdings } = computeHoldings([
    trade(1, 'VGT', 10, 100, '2026-01-02'),
    trade(2, 'VGT', -10, 130, '2026-01-05'),
    trade(3, 'SMH', 2, 200, '2026-01-06'),
  ]);
  const r = buildPositionRows(holdings, { VGT: 100, SMH: 210 });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].sym, 'SMH');
});
