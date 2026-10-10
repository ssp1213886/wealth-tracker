// 持仓/组合纯计算单测（v243 从 index.js 抽出，并统一了 updatePnlSummary 里重复的成本结转）
import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioTotals, cashPctOf, dailyChange, goalProgress, drawdownLine, summaryRows } from '../src/app/portfolio.js';

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

test('portfolioTotals：股息计入总盈亏（否则和「纪律热力图」的当月收益对不上）', () => {
  const base = { hasPriced: true, totalValue: 1950, totalCost: 1650, totalInvested: 2200, totalRealized: 200, optionPremium: 120, netCash: 1000 };
  assert.equal(portfolioTotals(base).total, 620, '没有股息时不变');
  const withDiv = portfolioTotals({ ...base, dividend: 35 });
  assert.equal(withDiv.total, 655, '股息是真实收益，要加进总盈亏');
  assert.equal(withDiv.dividend, 35, '股息要单独带出去，界面才能标出来');
  assert.equal(portfolioTotals({}).dividend, 0, '缺省为 0');
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
  // v319：占比在总资产 ≤ 0 时没有意义 —— 以前硬返回 0，界面会显示「现金占比 0.00%」，
  // 看着像"现金花光了"，实际是总资产已经为负。现在返回 null，界面显示「—」。
  assert.equal(empty.cashPct, null, '总资产 ≤ 0 时占比为 null（且不能除零）');
  const negative = portfolioTotals({ hasPriced: true, totalValue: 0, totalCost: 0, totalInvested: 100, totalRealized: 0, optionPremium: 0, netCash: -500 });
  assert.equal(negative.totalAssets, -500);
  assert.equal(negative.cashPct, null, '总资产为负时同样不给百分比');
});

// v319：现金占比的口径只有一份 —— 两处写 DOM 的地方（renderMetricsTop / updateMobStatusBar）都走它
test('cashPctOf：唯一的占比口径（≤0 给 null，脏输入不抛）', () => {
  assert.equal(cashPctOf(34000, 1000), 1000 / 34000 * 100);
  assert.equal(cashPctOf(0, 0), null, '总资产 0：不能除零，也不该显示 0%');
  assert.equal(cashPctOf(0, 500), null);
  assert.equal(cashPctOf(-500, -100), null, '总资产为负：占比无意义');
  assert.equal(cashPctOf(undefined, undefined), null);
  assert.equal(cashPctOf(1000, 'abc'), 0, '脏现金当 0，但不抛');
});

test('dailyChange：昨天持有的吃「昨收→现价」，今天才买的只吃「买入价→现价」', () => {
  const DAY = '2026-09-30';
  const rows = [{ sym: 'VGT', shares: 15, priced: true }];
  const quotes = { VGT: { price: 100, prevClose: 98, change: 2 } };

  // 昨天就持有 15 股 → 15 × (100 − 98)
  const held = dailyChange(rows, quotes, [{ symbol: 'VGT', shares: 15, price: 90, date: '2026-09-01' }], DAY);
  assert.equal(held.change, 30);
  assert.ok(near(held.pct, 30 / (15 * 98) * 100));

  // v306 回归：今天才按现价买入 → 今日收益必须是 0
  const fresh = dailyChange(rows, quotes, [{ symbol: 'VGT', shares: 15, price: 100, date: DAY }], DAY);
  assert.equal(fresh.change, 0, '按现价买入当天不该有收益');
  assert.equal(fresh.pct, 0, '分母含今日买入成本，收益率也应是 0');

  // 今天买的、但成交后到收盘涨了 → 只算「买入价→现价」
  const quotes2 = { VGT: { price: 105, prevClose: 100, change: 5 } };
  const bought = dailyChange(rows, quotes2, [{ symbol: 'VGT', shares: 15, price: 100, date: DAY }], DAY);
  assert.equal(bought.change, 15 * 5);

  // 今天卖出的部分：吃「昨收→卖价」
  const soldRows = [{ sym: 'VGT', shares: 5, priced: true }];
  const sold = dailyChange(soldRows, { VGT: { price: 100, prevClose: 98, change: 2 } }, [
    { symbol: 'VGT', shares: 15, price: 90, date: '2026-09-01' },
    { symbol: 'VGT', shares: -10, price: 101, date: DAY },
  ], DAY);
  assert.equal(sold.change, 5 * 2 + 10 * 3, '留下的 5 股吃昨收→现价，卖掉的 10 股吃昨收→卖价');

  // 没行情的行不参与；缺行情时百分比给 null（界面显示 —）
  assert.equal(dailyChange([{ sym: 'BTC', shares: 1, priced: false }], quotes, [], DAY).change, 0);
  assert.equal(dailyChange(rows, {}, [], DAY).change, 0);
  assert.equal(dailyChange([{ sym: 'VGT', shares: 1, priced: true }], {}, [], DAY).pct, null);
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
  const rows = summaryRows(trades, { VGT: 130, SMH: 600 }, ['VGT', 'SMH', 'IBIT']);
  assert.equal(rows.length, 2, '没持仓的 IBIT 不出现');
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
