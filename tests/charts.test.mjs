// 图表数据整形单测（v245 抽出）：纪律月度、年度矩阵、甜甜圈切片、热力色阶
import test from 'node:test';
import assert from 'node:assert/strict';
import { disciplineMonths, annualMatrix, heatColorFor, donutSlices } from '../src/app/charts.js';

const buy = (date, symbol, shares, price) => ({ date, symbol, shares, price, id: date + symbol });

test('disciplineMonths：12 个月、完成判定（≥目标×0.7）、state 与 icon', () => {
  const trades = [
    buy('2026-07-10', 'VGT', 6, 100),   // 600 < 700 → 未完成
    buy('2026-08-10', 'VGT', 8, 100),   // 800 ≥ 700 且有买入 → 完成
    buy('2026-09-05', 'SMH', 1, 500),   // 当月：有买入但金额不足
  ];
  const pack = disciplineMonths({ trades, ym: '2026-09', dca: 1000 });
  assert.equal(pack.months.length, 12);
  assert.equal(pack.months[11].ym, '2026-09');
  const aug = pack.months.filter((m) => m.ym === '2026-08')[0];
  assert.equal(aug.complete, true);
  assert.equal(aug.state, 'is-done');
  assert.equal(aug.icon, '✓');
  const jul = pack.months.filter((m) => m.ym === '2026-07')[0];
  assert.equal(jul.complete, false);
  assert.equal(jul.state, 'is-partial', '有买入但不足额 → 部分完成');
  assert.equal(jul.icon, '~');
  const jun = pack.months.filter((m) => m.ym === '2026-06')[0];
  assert.equal(jun.hasBuy, false);
  assert.equal(jun.state, 'is-empty');
  assert.equal(jun.icon, '✕');
  assert.equal(pack.months[11].state, 'is-current', '当月单独标记');
  assert.equal(pack.months[11].totalV, 500);
});

test('disciplineMonths：连续月数从最近往回数，当月未完成不算断', () => {
  const trades = [
    buy('2026-06-10', 'VGT', 8, 100),   // 完成
    buy('2026-07-10', 'VGT', 8, 100),   // 完成
    buy('2026-08-10', 'VGT', 8, 100),   // 完成
    buy('2026-09-01', 'VGT', 1, 100),   // 当月只买了 100 → 未完成（跳过，不算断）
    buy('2026-05-10', 'VGT', 1, 100),   // 5 月不足 → 断在这里
  ];
  const pack = disciplineMonths({ trades, ym: '2026-09', dca: 1000 });
  assert.equal(pack.streak, 3);
  const none = disciplineMonths({ trades: [], ym: '2026-09', dca: 1000 });
  assert.equal(none.streak, 0);
  assert.equal(none.months.length, 12);
});

test('annualMatrix：按"第一笔买入/入金"起算，逐年给出权利金贡献率与年末持股', () => {
  const now = new Date('2026-09-29T00:00:00');
  const out = annualMatrix({
    trades: [
      buy('2025-03-01', 'VGT', 10, 100),
      buy('2026-02-01', 'VGT', 5, 120),
      buy('2026-03-01', 'SMH', 2, 500),
    ],
    optionTrades: [{ added: '2026-04-01', premium: 120, contracts: 1 }],
    cashLog: [{ date: '2025-02-01', type: '入金', amount: 5000 }, { date: '2026-05-01', type: '出金', amount: 1000 }],
    prices: { VGT: 130, SMH: 600, BTC: 0 },
    netCash: 2000,
    targetGoal: 2500000,
    symbols: ['VGT', 'SMH', 'BTC'],
    now,
  });
  assert.equal(out.empty, false);
  assert.deepEqual(out.cells.map((c) => c.ym), ['2025', '2026']);
  assert.equal(out.cells[0].dca, 1000);
  assert.equal(out.cells[0].prem, 0);
  assert.equal(out.cells[0].rate, 0);
  assert.equal(out.cells[0].vgt, 10);
  assert.equal(out.cells[1].dca, 1600, '2026 年买入 5×120 + 2×500');
  assert.equal(out.cells[1].prem, 120);
  assert.ok(Math.abs(out.cells[1].rate - 7.5) < 1e-9, '权利金贡献率 = 120/1600');
  assert.equal(out.cells[1].vgt, 15, '年末持股是累计值');
  assert.equal(out.cells[1].smh, 2);
  assert.equal(out.totalInvested, 5000, '只统计入金');
  assert.equal(out.activeYears, 2);
  assert.equal(out.totalMktV, 15 * 130 + 2 * 600);
  assert.equal(out.totalAssets, 15 * 130 + 2 * 600 + 2000);
  assert.ok(Math.abs(out.cagr - (Math.pow(out.totalAssets / 5000, 1 / 2) - 1)) < 1e-12);
  assert.equal(out.targetGap, 2500000 - out.totalAssets);
});

test('annualMatrix：没有任何买入与入金 → empty，并且不超过 20 年', () => {
  const empty = annualMatrix({ trades: [], cashLog: [], now: new Date('2026-09-29T00:00:00') });
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.cells, []);
  const long = annualMatrix({
    trades: [buy('2000-01-01', 'VGT', 1, 100)],
    cashLog: [],
    prices: {},
    now: new Date('2026-09-29T00:00:00'),
  });
  assert.equal(long.cells.length, 20, '最多 20 格');
  // 注意：原实现是从最早那年开始数满 20 格（20 年以上的历史会截掉近端）。
  // 这是长期休眠限制（当前数据只有 2 年），此处按实际行为钉住，避免误以为是回归。
  assert.equal(long.cells[0].ym, '2000');
  assert.equal(long.cells[19].ym, '2019');
});

test('heatColorFor：阈值分档（含无数据与负贡献率）', () => {
  assert.deepEqual(heatColorFor(0, false), ['#f0f0ec', '#888', 'rgba(0,0,0,.3)', 'rgba(0,0,0,.25)']);
  assert.equal(heatColorFor(120, true)[0], '#6c0a1e');
  assert.equal(heatColorFor(60, true)[0], '#922b3e');
  assert.equal(heatColorFor(30, true)[0], '#c0392b');
  assert.equal(heatColorFor(10, true)[0], '#e67e22');
  assert.equal(heatColorFor(9, true)[0], '#f0ad4e');
  assert.equal(heatColorFor(7, true)[0], '#f9e79f');
  assert.equal(heatColorFor(4, true)[0], '#aed6f1');
  assert.equal(heatColorFor(0.5, true)[0], '#d6eaf8');
  assert.equal(heatColorFor(-5, true)[0], '#5b6d8a');
});

test('donutSlices：过滤未定价的持仓，pct 合计为 1；两种空态要分清', () => {
  const ok = donutSlices([
    { sym: 'VGT', priced: true, value: 3000 },
    { sym: 'SMH', priced: true, value: 1000 },
    { sym: 'BTC', priced: false, value: null },
  ]);
  assert.equal(ok.reason, 'ok');
  assert.equal(ok.total, 4000);
  assert.deepEqual(ok.slices.map((s) => s.sym), ['VGT', 'SMH']);
  assert.ok(Math.abs(ok.slices.reduce((n, s) => n + s.pct, 0) - 1) < 1e-12);
  assert.equal(donutSlices([]).reason, 'no-data');
  assert.equal(donutSlices([{ sym: 'VGT', priced: false, value: null }]).reason, 'no-data');
  assert.equal(donutSlices([{ sym: 'VGT', priced: true, value: 0 }]).reason, 'unpriced');
});
