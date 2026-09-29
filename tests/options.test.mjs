// 期权纯计算单测（v238 从 index.js 抽出）：记录校验、到期状态、行内派生值、权利金汇总、OTM 建议价。
// 这块以前完全没有测试，却是"钱 + 到期判定"最集中的地方。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOptions, isActiveOption, optionExpiryState, optionRowStatus, optionTotals,
  otmPercent, stepOtmPercent, suggestedStrike,
} from '../src/app/options.js';

const opt = (over) => Object.assign({
  id: 1, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20',
}, over);
// 2026-09-29 10:00 美东（EDT，UTC-4）→ 盘中；同日 17:00 美东 → 收盘后
const BEFORE_CLOSE = new Date('2026-09-29T14:00:00.000Z');
const AFTER_CLOSE = new Date('2026-09-29T21:00:00.000Z');

test('normalizeOptions：合法记录规整后保留关键字段', () => {
  const list = normalizeOptions([opt({ sym: 'vgt', type: 'call', expiry: '2026/10/3' })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].sym, 'VGT');
  assert.equal(list[0].type, 'CALL');
  assert.equal(list[0].expiry, '2026-10-03', '斜杠日期要归一化');
  assert.equal(list[0].contracts, 1);
  assert.equal(list[0].settled, false);
  assert.equal(list[0].archived, false);
});

test('normalizeOptions：非法记录被剔除（标的不对/类型不对/行权价或权利金非法/缺到期日）', () => {
  const bad = [
    opt({ sym: 'NVDA' }),
    opt({ type: 'SPREAD' }),
    opt({ strike: 0 }),
    opt({ strike: -1 }),
    opt({ premium: -0.01 }),
    opt({ expiry: '' }),
    opt({ expiry: '2026-13-40' }),
    null,
  ];
  assert.deepEqual(normalizeOptions(bad), []);
  assert.deepEqual(normalizeOptions('not-an-array'), []);
});

test('normalizeOptions：张数至少 1，added 缺失时补美东当天', () => {
  const list = normalizeOptions([opt({ contracts: 0, added: '' })]);
  assert.equal(list[0].contracts, 1);
  assert.match(list[0].added, /^\d{4}-\d{2}-\d{2}$/);
});

test('optionExpiryState：到期日当天收盘前不算过期，收盘后算过期', () => {
  const before = optionExpiryState('2026-09-29', BEFORE_CLOSE);
  assert.equal(before.days, 0);
  assert.equal(before.expired, false, '当天 16:00 前仍可操作');
  const after = optionExpiryState('2026-09-29', AFTER_CLOSE);
  assert.equal(after.expired, true, '当天 16:00 后视为到期');
});

test('optionExpiryState：未来/过去/非法日期', () => {
  assert.equal(optionExpiryState('2026-10-16', BEFORE_CLOSE).days, 17);
  assert.equal(optionExpiryState('2026-10-16', BEFORE_CLOSE).expired, false);
  assert.equal(optionExpiryState('2026-09-01', BEFORE_CLOSE).expired, true);
  const bad = optionExpiryState('', BEFORE_CLOSE);
  assert.equal(bad.days, 0);
  assert.equal(bad.expired, true, '日期不合法按已过期处理');
});

test('isActiveOption：已结算/已归档/已过期都不是活跃', () => {
  assert.equal(isActiveOption(opt(), BEFORE_CLOSE), true);
  assert.equal(isActiveOption(opt({ settled: true }), BEFORE_CLOSE), false);
  assert.equal(isActiveOption(opt({ archived: true }), BEFORE_CLOSE), false);
  assert.equal(isActiveOption(opt({ expiry: '2026-09-01' }), BEFORE_CLOSE), false);
  assert.equal(isActiveOption(null, BEFORE_CLOSE), false);
});

test('optionRowStatus：归档/结算/过期的状态文案与"能否结算/行权"', () => {
  assert.equal(optionRowStatus(opt({ archived: true }), { now: BEFORE_CLOSE }).statusText, '已归档');
  assert.equal(optionRowStatus(opt({ settled: true }), { now: BEFORE_CLOSE }).statusText, '已结算');
  const expired = optionRowStatus(opt({ expiry: '2026-09-01' }), { now: BEFORE_CLOSE });
  assert.equal(expired.statusText, '已过期');
  assert.equal(expired.canSettle, true, '过期未结算 → 显示"结算"');
  assert.equal(expired.canAssign, false);
  assert.equal(expired.distancePct, null, '过期行不显示距现价');
});

test('optionRowStatus：虚值 CALL 显示倒计时与正距现价，实值显示"临近行权"', () => {
  const otm = optionRowStatus(opt(), { now: BEFORE_CLOSE, spot: 100 });
  assert.equal(otm.statusKind, 'live');
  assert.equal(otm.statusText, '17d');
  assert.equal(otm.itm, false);
  assert.ok(otm.distancePct > 0, '行权价高于现价 → 正百分比（虚值）');
  assert.equal(otm.canAssign, true);

  const itm = optionRowStatus(opt(), { now: BEFORE_CLOSE, spot: 140 });
  assert.equal(itm.statusKind, 'warn');
  assert.equal(itm.itm, true);
  assert.ok(itm.distancePct < 0, '现价高于行权价 → 负百分比（实值）');
  assert.ok(itm.statusText.indexOf('临近行权') === 0);
});

test('optionTotals：累计/本月/本年权利金、本月 CALL 张数、活跃数与众数最近到期', () => {
  const list = [
    opt({ id: 1, premium: 100, contracts: 2, added: '2026-09-20', expiry: '2026-11-20' }),   // 本月 200
    opt({ id: 2, premium: 50, contracts: 1, added: '2026-09-25', expiry: '2026-10-16' }),    // 本月 50
    opt({ id: 3, premium: 10, contracts: 3, added: '2026-03-01', expiry: '2026-04-17', type: 'PUT' }), // 本年（非本月）30
    opt({ id: 4, premium: 999, contracts: 1, added: '2025-12-01', expiry: '2026-01-16' }),    // 去年 999
    opt({ id: 5, premium: 7, contracts: 1, added: '2026-09-26', expiry: '2026-09-01', settled: true }), // 已结算，计入汇总但不活跃
  ];
  const t = optionTotals(list, { now: BEFORE_CLOSE, ym: '2026-09', year: '2026' });
  assert.equal(t.total, 200 + 50 + 30 + 999 + 7);
  assert.equal(t.month, 200 + 50 + 7);
  assert.equal(t.year, 200 + 50 + 30 + 7);
  // 本月 CALL 张数：id1(2) + id2(1) + id5(1，已结算但仍是本月 CALL)；PUT 与 3 月的都不计
  assert.equal(t.callsThisMonth, 4);
  // 活跃：id1(11-20)、id2(10-16) 未结算未过期；id3 的 PUT 已于 4 月过期，id4 去年到期，id5 已结算
  assert.equal(t.activeCount, 2);
  assert.equal(t.nearest.expiry, '2026-10-16');
  assert.deepEqual(optionTotals(null, { now: BEFORE_CLOSE }), { total: 0, month: 0, year: 0, callsThisMonth: 0, activeCount: 0, nearest: null });
});

test('OTM 工具：百分比回落默认、加减后钳制 1~20、建议行权价按现价推算', () => {
  assert.equal(otmPercent(0, 7), 7);
  assert.equal(otmPercent('abc', 5), 5);
  assert.equal(otmPercent(9, 7), 9);
  assert.equal(stepOtmPercent(20, 1, 7), 20, '上限 20');
  assert.equal(stepOtmPercent(1, -1, 7), 1, '下限 1');
  assert.equal(stepOtmPercent(7, 1, 7), 8);
  assert.equal(stepOtmPercent('bad', -1, 7), 6);
  assert.equal(suggestedStrike(100, 7), 107);
  assert.equal(suggestedStrike(0, 7), 0, '现价缺失不显示建议价');
  assert.equal(Math.round(suggestedStrike(593.45, 5)), Math.round(593.45 * 1.05));
});
