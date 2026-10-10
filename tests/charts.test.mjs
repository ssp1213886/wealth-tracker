// 图表数据整形单测（v245 抽出）：纪律月度、年度矩阵、甜甜圈切片、热力色阶
import test from 'node:test';
import assert from 'node:assert/strict';
import { disciplineMonths, monthlyPnl, portfolioStateAt, annualMatrix, heatColorFor, donutSlices, equitySeries, equityCurveSvg } from '../src/app/charts.js';

const buy = (date, symbol, shares, price) => ({ date, symbol, shares, price, id: date + symbol });

test('portfolioStateAt：组合快照是"值多少钱"的唯一口径（现金 / 买卖累计 / 持股 / 总资产 / 缺价标记）', () => {
  const snap = portfolioStateAt({
    end: '2026-09-30',
    trades: [
      { symbol: 'VGT', date: '2026-08-10', shares: 120, price: 100 },   /* 买 120 → 支出 12000 */
      { symbol: 'VGT', date: '2026-09-10', shares: -20, price: 150 },   /* 卖 20 → 收入 3000 */
    ],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 20000 },
      { type: '股息', date: '2026-09-20', amount: 100 },
      { type: '入金', date: '2026-10-05', amount: 999 },                /* end 之后 → 不计 */
    ],
    priceBySymbol: { VGT: 110 },
  });
  assert.equal(snap.cash, 20100, '入金 20000 + 股息 100；10 月那笔在 end 之后');
  assert.equal(snap.buy, 12000);
  assert.equal(snap.sell, 3000);
  assert.deepEqual(snap.shares, { VGT: 100 });
  assert.equal(snap.value, 20100 + 3000 - 12000 + 100 * 110);
  assert.equal(snap.priced, true);
  const noPrice = portfolioStateAt({
    end: '2026-09-30',
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 1, price: 100 }],
    cashLog: [],
    priceBySymbol: {},
  });
  assert.equal(noPrice.priced, false, '持有中但没价 → priced=false（界面据此显示「—」，不编数字）');
});

/* ---------------- 月度收益（口径 A：当月整个组合，总资产含现金） ---------------- */

/**
 * 一个固定的"世界"，后面几条共用：
 *   8/05 入金 10,000 → 8/10 买 VGT 100 股 @$100（现金刚好花光）
 *   8 月末 VGT $100 → 总资产 10,000
 *   9/05 入金 2,000；9 月末 VGT $101.8 → 总资产 = 持股 10,180 + 现金 2,000 = 12,180
 */
const SEPT_WORLD = {
  months: ['2026-09'],
  trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
  cashLog: [
    { type: '入金', date: '2026-08-05', amount: 10000 },
    { type: '入金', date: '2026-09-05', amount: 2000 },
  ],
  priceByMonth: { VGT: { '2026-08': 100, '2026-09': 101.8 } },
};

test('monthlyPnl：收益额 = 月末总资产 − 月初总资产 − 当月入金（必须减掉入金）', () => {
  const r = monthlyPnl(SEPT_WORLD)['2026-09'];
  // 账面从 10,000 涨到 12,180，但其中 2,000 是当月入金 → 真实收益只有 180
  assert.equal(r.computed, true);
  assert.equal(r.amount, 180, '入金不能算成收益');
});

test('monthlyPnl：总资产要含现金 —— 入金还没买股票的那个月，收益额必须是 0 而不是负数', () => {
  const r = monthlyPnl({
    months: ['2026-09'],
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '入金', date: '2026-09-05', amount: 2000 },   // 只是躺在现金里，没买
    ],
    priceByMonth: { VGT: { '2026-08': 100, '2026-09': 100 } },   // 股价整月没动
  })['2026-09'];
  assert.equal(r.amount, 0, '股没动、钱还在现金里 → 这个月没赚没亏；若把现金排除会错算成 −2000');
});

test('monthlyPnl：收益率用 Modified Dietz —— 按入金的"在场天数"加权', () => {
  const r = monthlyPnl(SEPT_WORLD)['2026-09'];
  // 9/5 入金 → 在场 26 天 → 权重 26/30；分母 = 10,000 + 2,000×26/30 = 11,733.33
  const denom = 10000 + 2000 * (26 / 30);
  assert.ok(Math.abs(r.rate - 180 / denom) < 1e-9, '实际 ' + (r.rate * 100).toFixed(3) + '%');
  assert.ok(r.rate < 180 / 10000 - 1e-6, '必须比"只用月初资产"（1.80%）低');
  assert.ok(r.rate > 180 / 12180 + 1e-6, '必须比"只用月末资产"高');
});

test('monthlyPnl：持有中但缺当月行情 → computed=false（界面显示「—」，不编数字）', () => {
  const r = monthlyPnl({ ...SEPT_WORLD, priceByMonth: { VGT: { '2026-08': 100 } } })['2026-09'];
  assert.equal(r.computed, false);
  assert.equal(r.amount, null);
  assert.equal(r.rate, null);
  assert.equal(r.gap, true);
});

test('monthlyPnl：出金不是亏损（收益额 0、收益率 0%）', () => {
  const r = monthlyPnl({
    months: ['2026-09'],
    trades: [],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '出金', date: '2026-09-10', amount: 500 },
    ],
    priceByMonth: { VGT: { '2026-08': 100, '2026-09': 100 } },
  })['2026-09'];
  assert.equal(r.computed, true);
  assert.equal(r.amount, 0, '纯出金不该被算成亏损');
  assert.equal(r.rate, 0);
});

test('monthlyPnl：分母 ≤ 0 时只给金额、不给收益率（不编一个百分比出来）', () => {
  const r = monthlyPnl({
    months: ['2026-09'],
    trades: [],
    cashLog: [],
    priceByMonth: { VGT: { '2026-08': 100, '2026-09': 100 } },
  })['2026-09'];
  assert.equal(r.computed, true);
  assert.equal(r.amount, 0);
  assert.equal(r.rate, null, '月初没有资产、当月也没有进出 → 收益率没有意义');
});

test('monthlyPnl：现金修正算资本变动，不算收益（首页累计收益 / 年度归因 / 月收益三处口径一致）', () => {
  const r = monthlyPnl({
    months: ['2026-09'],
    trades: [],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '修正', date: '2026-09-10', amount: 500 },   /* 补记 / 改错，不是赚来的钱 */
    ],
    priceByMonth: { VGT: { '2026-08': 100, '2026-09': 100 } },
  })['2026-09'];
  assert.equal(r.amount, 0, '修正不是收益：账面多了 500，但那是资本变动');
  assert.equal(r.rate, 0);
});

test('monthlyPnl：股息算收益、不算注资（跟年度归因同口径）', () => {
  const r = monthlyPnl({
    months: ['2026-09'],
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '股息', date: '2026-09-15', amount: 100 },
    ],
    priceByMonth: { VGT: { '2026-08': 100, '2026-09': 100 } },
  })['2026-09'];
  assert.equal(r.amount, 100, '股息是收益');
  assert.ok(r.rate > 0);
});

test('monthlyPnl：收益额按月可加 —— 两个月的和 = 期末资产 − 期初资产 − 净入金之和', () => {
  const p = monthlyPnl({
    months: ['2026-08', '2026-09'],
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '入金', date: '2026-09-05', amount: 2000 },
    ],
    priceByMonth: { VGT: { '2026-07': 98, '2026-08': 100, '2026-09': 101.8 } },
  });
  assert.equal(p['2026-08'].amount, 0, '8 月：只入金 + 买入，没有涨跌');
  assert.equal(p['2026-09'].amount, 180);
  assert.equal(p['2026-08'].amount + p['2026-09'].amount, 12180 - 0 - 12000,
    '月收益额加起来 = 期末 − 期初 − 净入金（与年度归因同口径）');
});

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

/* ===== v370：资产曲线（月末总资产 + 累计净入金）===== */

/* 8 月末：入金 10,000 → 买 100 股 @$100（现金花光），月末价 $100 → 总资产 10,000 */
const CURVE_WORLD = {
  months: ['2026-08', '2026-09'],
  trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
  cashLog: [
    { type: '入金', date: '2026-08-05', amount: 10000 },
    { type: '入金', date: '2026-09-05', amount: 2000 },
  ],
  priceByMonth: { VGT: { '2026-08': 100, '2026-09': 101.8 } },
};

test('equitySeries：月末总资产与 monthlyPnl 的口径一致（含现金），净入金只数入金/出金/修正', () => {
  const s = equitySeries(CURVE_WORLD);
  assert.equal(s.points.length, 2);
  assert.equal(s.points[0].value, 10000, '8 月末：持股 10,000 + 现金 0');
  assert.equal(s.points[1].value, 12180, '9 月末：持股 10,180 + 现金 2,000');
  assert.equal(s.points[0].netInvested, 10000);
  assert.equal(s.points[1].netInvested, 12000, '第二笔入金要累加进去');
  assert.equal(s.ready, true);
  assert.equal(s.first.ym, '2026-08');
  assert.equal(s.last.ym, '2026-09');
  assert.equal(s.gain, 2180, '整条线的涨幅 = 末值 − 首值');
  assert.ok(Math.abs(s.gainPct - 0.218) < 1e-12);
});

test('equitySeries：股息/权利金不算注资（只进总资产，不进净入金）', () => {
  const s = equitySeries({
    months: ['2026-08'],
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
    cashLog: [
      { type: '入金', date: '2026-08-05', amount: 10000 },
      { type: '股息+', date: '2026-08-20', amount: 50 },
      { type: '权利金+VGT', date: '2026-08-21', amount: 120 },
    ],
    priceByMonth: { VGT: { '2026-08': 100 } },
  });
  assert.equal(s.points[0].value, 10170, '股息与权利金是收益，要体现在总资产里');
  assert.equal(s.netInvested, 10000, '但它们不是注资');
});

test('equitySeries：缺行情的月份标 gap、不补 0；可画点不足 2 个时 ready=false', () => {
  const s = equitySeries({
    months: ['2026-08', '2026-09'],
    trades: [{ symbol: 'VGT', date: '2026-08-10', shares: 100, price: 100 }],
    cashLog: [{ type: '入金', date: '2026-08-05', amount: 10000 }],
    priceByMonth: { VGT: { '2026-08': 100 } },      // 9 月没有价
  });
  assert.equal(s.points[1].gap, true, '缺行情 → gap');
  assert.equal(s.points[1].value, 0, '不编数字：缺价时 value 只能是 0（渲染层断线而不是画个坑）');
  assert.equal(s.ready, false, '只剩 1 个可画点 → 不画线');
  assert.equal(equityCurveSvg(s), '', '不 ready 的序列不产出 SVG');
});

test('equityCurveSvg：两条线（净值实线 + 净入金虚线）与淡填充', () => {
  const svg = equityCurveSvg(equitySeries(CURVE_WORLD));
  assert.match(svg, /^<svg class="eq-svg"/);
  assert.ok(svg.includes('class="eq-area"'), '没有断点时画填充');
  assert.ok(svg.includes('class="eq-line"'), '净值线');
  assert.ok(svg.includes('class="eq-invested"'), '净入金参考线');
  assert.ok(svg.includes('vector-effect="non-scaling-stroke"'), '线宽不能被横向拉伸拉粗');
  assert.equal((svg.match(/class="eq-line"/g) || []).length, 1);
});

test('equityCurveSvg：有缺口的月份要断开（多段），且不画填充', () => {
  const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
  const svg = equityCurveSvg(equitySeries({
    months: months,
    trades: [{ symbol: 'VGT', date: '2026-07-10', shares: 100, price: 100 }],
    cashLog: [{ type: '入金', date: '2026-07-05', amount: 10000 }],
    priceByMonth: { VGT: { '2026-07': 100, '2026-10': 110 } },   // 8/9 月缺价
  }));
  const line = /class="eq-line" d="([^"]+)"/.exec(svg);
  assert.ok(line, '应该有净值线');
  assert.equal((line[1].match(/M/g) || []).length, 2, '缺口两侧各起一段（两个 M）');
  assert.ok(!svg.includes('class="eq-area"'), '断开时不填色，免得看起来像数据齐的');
});
