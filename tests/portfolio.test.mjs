// 持仓/组合纯计算单测（v243 从 index.js 抽出，并统一了 updatePnlSummary 里重复的成本结转）
import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioTotals, dailyChange, goalProgress, drawdownLine, summaryRows } from '../src/app/portfolio.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const trade = (over) => Object.assign({ id: 1, symbol: 'VGT', date: '2026-01-01', time: '10:00', shares: 1, price: 100 }, over);

test('portfolioTotals：浮动 + 已实现 + 权利金，现金占比按总资产算', () => {
  const t = portfolioTotals({
    hasPriced: true, totalValue: 1950, totalCost: 1650, totalInvested: 2200,
    totalRealized: 200, optionPremium: 120, netCash: 1000,
  });
  assert.equal(t.unreal, 300);
  assert.equal(t.total, 620);
  assert.ok(near(t.pct, 620 / 2200));
  assert.equal(t.totalAssets, 2950);
  assert.ok(near(t.cashPct, 1000 / 2950 * 100));
});

test('portfolioTotals：拿不到行情时盈亏为 null（界面显示「-」），现金占比仍可算', () => {
  const t = portfolioTotals({ hasPriced: false, totalValue: 0, totalCost: 0, totalInvested: 100, totalRealized: 5, optionPremium: 3, netCash: 200 });
  assert.equal(t.unreal, null);
  assert.equal(t.total, null);
  assert.equal(t.pct, null);
  assert.equal(t.totalAssets, 200);
  assert.equal(t.cashPct, 100);
  const empty = portfolioTotals({});
  assert.equal(empty.totalAssets, 0);
  assert.equal(empty.cashPct, 0, '总资产为 0 时不能除零');
});

test('dailyChange：只累加有行情的持仓，百分比以「昨日市值」为分母', () => {
  const rows = [
    { sym: 'VGT', shares: 15, priced: true },
    { sym: 'SMH', shares: 2, priced: true },
    { sym: 'BTC', shares: 1, priced: false },
  ];
  const d = dailyChange(rows, { VGT: 2, SMH: -1, BTC: 5 }, 1950);
  assert.equal(d.change, 15 * 2 + 2 * -1, '没行情的行不参与');
  assert.ok(near(d.pct, d.change / (1950 - d.change) * 100));
  const none = dailyChange(rows, {}, 1950);
  assert.equal(none.change, 0);
  assert.equal(none.pct, 0, '没有涨跌数据时百分比为 0（昨日=今日）');
  const noBase = dailyChange(rows, { VGT: 1 }, 0);
  assert.equal(noBase.pct, null, '总市值为 0 时不计算涨跌幅');
});

test('goalProgress：超额封顶 100%、缺口不为负、目标为 0 时兜底', () => {
  assert.equal(goalProgress(2500000, 2500000).pct, 100);
  assert.equal(goalProgress(3000000, 2500000).pct, 100);
  assert.equal(goalProgress(3000000, 2500000).gap, 0);
  assert.ok(near(goalProgress(2950, 2500000).pct, 2950 / 2500000 * 100));
  assert.deepEqual(goalProgress(100, 0), { pct: 0, gap: 0 });
});

test('drawdownLine：峰值取 本地/52周/现价 三者最大，现价创新高时回撤为 0', () => {
  const a = drawdownLine('VGT', 100, 120, 130);
  assert.equal(a.peak, 130);
  assert.ok(near(a.dd, (130 - 100) / 130 * 100));
  const b = drawdownLine('VGT', 100, 0, 0);
  assert.equal(b.peak, 100);
  assert.equal(b.dd, 0);
  const c = drawdownLine('VGT', 150, 100, 140);
  assert.equal(c.peak, 150, '现价创新高时以现价为峰');
  assert.equal(c.dd, 0);
});

test('drawdownLine：脏峰值（超过现价 5 倍）与脏 52 周高点都被丢弃，现价缺失返回 null', () => {
  const dirty = drawdownLine('VGT', 100, 600, 700);
  assert.equal(dirty.peak, 100, '本地峰值 6 倍 → 视为脏数据');
  assert.equal(dirty.dd, 0);
  const dirtyHi = drawdownLine('BTC', 30, 0, 900);
  assert.equal(dirtyHi.peak, 30, '52 周高点 30 倍 → 视为脏数据');
  assert.equal(drawdownLine('VGT', 0, 100, 100), null);
  assert.equal(drawdownLine('VGT', -5, 100, 100), null);
});

test('summaryRows：复用成本结转（部分卖出后的均价与浮盈），只返回有持仓的标的', () => {
  const trades = [
    trade({ id: 1, date: '2026-01-01', shares: 10, price: 100 }),
    trade({ id: 2, date: '2026-01-02', shares: 10, price: 120 }),
    trade({ id: 3, date: '2026-02-01', shares: -5, price: 150 }),
    trade({ id: 4, symbol: 'SMH', date: '2026-01-03', shares: 2, price: 500 }),
  ];
  const rows = summaryRows(trades, { VGT: 130, SMH: 600 }, ['VGT', 'SMH', 'BTC']);
  assert.equal(rows.length, 2, '没持仓的 BTC 不出现');
  const vgt = rows[0];
  assert.equal(vgt.sym, 'VGT');
  assert.equal(vgt.shares, 15);
  assert.ok(near(vgt.value, 15 * 130));
  assert.ok(near(vgt.pnl, 15 * 130 - 1650), '成本按移动加权：1000+1200-5×110=1650');
  assert.ok(near(vgt.pct, (15 * 130 - 1650) / 1650 * 100), 'pct 是百分数');
  const smh = rows[1];
  assert.equal(smh.sym, 'SMH');
  assert.ok(near(smh.pnl, 2 * (600 - 500)));
  const noPrice = summaryRows(trades, {}, ['VGT']);
  assert.equal(noPrice[0].value, 0, '没有行情时市值按 0（界面显示未定价）');
  assert.equal(noPrice[0].pnl, 0);
});
