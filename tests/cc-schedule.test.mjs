// 卖 CALL 固定节奏的单测（v328）：到期日推算、节奏摘要、连续执行轮数、除息日外推。
// 这块决定"提醒哪一天该操作"，算错就是让用户按错的日子下单，所以日期边界要卡死。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CC_RULES, RULE_LABELS, dateMs, isoOf, weekdayOf, daysBetween, thirdFriday,
  nextMonthly3, nextEvery3W, pastExpiries, ruleFor, scheduleRow, complianceStreak,
  estimateNextExDiv,
} from '../src/app/cc-schedule.js';

// 实测自 CBOE：VGT/SMH 的 2026 年剩余月度到期日就是 10-16 / 11-20 / 12-18
const TODAY = '2026-10-08';

test('dateMs / isoOf / weekdayOf / daysBetween：基本换算与非法值', () => {
  assert.equal(isoOf(dateMs('2026-10-08')), '2026-10-08');
  assert.equal(weekdayOf('2026-10-16'), 5, '10-16 是周五');
  assert.equal(weekdayOf('2026-10-08'), 4, '10-08 是周四');
  assert.equal(daysBetween('2026-10-08', '2026-11-20'), 43);
  assert.equal(daysBetween('2026-10-08', '2026-10-08'), 0);
  assert.ok(Number.isNaN(dateMs('2026-13-01')), '13 月非法');
  assert.ok(Number.isNaN(dateMs('2026-02-30')), '2 月 30 日非法');
  assert.ok(Number.isNaN(dateMs('')), );
  assert.equal(weekdayOf('bad'), -1);
});

test('thirdFriday：与实测的 CBOE 月度到期日一致', () => {
  assert.equal(thirdFriday(2026, 10), '2026-10-16');
  assert.equal(thirdFriday(2026, 11), '2026-11-20');
  assert.equal(thirdFriday(2026, 12), '2026-12-18');
  assert.equal(thirdFriday(2027, 1), '2027-01-15');
  assert.equal(weekdayOf(thirdFriday(2026, 11)), 5, '第三个周五必须是周五');
});

test('nextMonthly3：当天就是第三个周五时返回当天，否则返回下一个', () => {
  assert.equal(nextMonthly3('2026-10-08'), '2026-10-16');
  assert.equal(nextMonthly3('2026-10-16'), '2026-10-16', '当天算"就是今天"');
  assert.equal(nextMonthly3('2026-10-17'), '2026-11-20');
  assert.equal(nextMonthly3('2026-12-19'), '2027-01-15', '跨年');
  assert.equal(nextMonthly3('bad'), null);
});

test('nextEvery3W：锚点必须是周五，严格按 21 天递推', () => {
  assert.equal(nextEvery3W('2026-10-30', '2026-10-08'), '2026-10-30');
  assert.equal(nextEvery3W('2026-10-30', '2026-10-30'), '2026-10-30', '当天算今天');
  assert.equal(nextEvery3W('2026-10-30', '2026-10-31'), '2026-11-20');
  assert.equal(nextEvery3W('2026-10-30', '2026-11-20'), '2026-11-20');
  assert.equal(nextEvery3W('2026-10-30', '2026-11-21'), '2026-12-11');
  assert.equal(nextEvery3W('2026-10-30', '2027-01-02'), '2027-01-22', '跨年继续递推');
  assert.equal(nextEvery3W('2026-10-08', '2026-10-08'), null, '锚点不是周五 → null');
  assert.equal(nextEvery3W('', '2026-10-08'), null);
  // 锚点在很久以前也要能算
  assert.equal(nextEvery3W('2004-01-02', '2026-10-08'), '2026-10-09');
});

test('pastExpiries：按月/按 3 周往回列，且都在 fromDate 之前', () => {
  assert.deepEqual(pastExpiries('monthly3', '', TODAY, 3), ['2026-09-18', '2026-08-21', '2026-07-17']);
  const w = pastExpiries('every3w', '2004-01-02', TODAY, 3);
  assert.equal(w.length, 3);
  w.forEach((d) => {
    assert.ok(dateMs(d) < dateMs(TODAY));
    assert.equal(weekdayOf(d), 5, '每 3 周的到期日必须都是周五');
  });
  for (let i = 1; i < w.length; i += 1) assert.equal(daysBetween(w[i], w[i - 1]), 21, '间隔必须是 21 天');
  assert.deepEqual(pastExpiries('every3w', '2026-10-30', TODAY, 3), [], '锚点在未来时没有已过的档');
});

test('ruleFor：非法/缺失值按标的名回落（VGT 月度、SMH 每 3 周）', () => {
  assert.equal(ruleFor('VGT', null), 'monthly3');
  assert.equal(ruleFor('SMH', null), 'every3w');
  assert.equal(ruleFor('VGT', { VGT: { rule: 'every3w' } }), 'every3w', '显式配置优先');
  assert.equal(ruleFor('VGT', { VGT: { rule: 'nonsense' } }), 'monthly3', '非法值回落');
  assert.deepEqual(CC_RULES, ['monthly3', 'every3w']);
  assert.equal(RULE_LABELS.monthly3, '每月第三个周五');
});

test('scheduleRow：下次到期日 = 下次卖出日（到期日当天卖下一档）', () => {
  const cfg = { VGT: { rule: 'monthly3' }, SMH: { rule: 'every3w', anchor: '2026-10-30' } };
  const v = scheduleRow('VGT', cfg, TODAY);
  assert.equal(v.nextExpiry, '2026-10-16');
  assert.equal(v.daysToGo, 8);
  assert.equal(v.isDue, false);
  assert.equal(v.label, '每月第三个周五');
  const s = scheduleRow('SMH', cfg, TODAY);
  assert.equal(s.nextExpiry, '2026-10-30');
  assert.equal(s.daysToGo, 22);
  assert.equal(s.label, '每 3 周的周五');
  assert.equal(s.anchor, '2026-10-30');
  // 当天 = 该操作
  assert.equal(scheduleRow('VGT', cfg, '2026-10-16').isDue, true);
  assert.equal(scheduleRow('VGT', cfg, '2026-10-16').daysToGo, 0);
  assert.equal(scheduleRow('VGT', cfg, 'bad'), null);
});

test('complianceStreak：按节奏日历往回数连续执行的轮数，遇到漏的立刻停', () => {
  const cfg = { VGT: { rule: 'monthly3' } };
  // 过去的三个月度到期日：09-18 / 08-21 / 07-17
  assert.deepEqual(pastExpiries('monthly3', '', TODAY, 3), ['2026-09-18', '2026-08-21', '2026-07-17']);
  const call = (added) => ({ id: added, sym: 'VGT', type: 'CALL', strike: 140, premium: 1, contracts: 1, expiry: '2026-12-18', added: added });
  // 三轮都做了（卖出日记在到期日 ±5 天内）
  let r = complianceStreak([call('2026-09-18'), call('2026-08-21'), call('2026-07-17')], 'VGT', cfg, TODAY);
  assert.equal(r.streak, 3);
  // 最近一轮漏了 → streak 归零
  r = complianceStreak([call('2026-08-21'), call('2026-07-17')], 'VGT', cfg, TODAY);
  assert.equal(r.streak, 0);
  assert.equal(r.missed, '2026-09-18');
  // 中间漏一轮 → 只数到漏之前
  r = complianceStreak([call('2026-09-18'), call('2026-07-17')], 'VGT', cfg, TODAY);
  assert.equal(r.streak, 1);
  assert.equal(r.missed, '2026-08-21');
  // 卖出日次日才记也算（窗口 ±5 天）
  r = complianceStreak([call('2026-09-22'), call('2026-08-24')], 'VGT', cfg, TODAY);
  assert.equal(r.streak, 2);
  // 没有记录
  assert.equal(complianceStreak([], 'VGT', cfg, TODAY).streak, 0);
  // 只认 CALL、只认本标的
  r = complianceStreak([
    { sym: 'VGT', type: 'PUT', added: '2026-09-18' },
    { sym: 'SMH', type: 'CALL', added: '2026-09-18' },
  ], 'VGT', cfg, TODAY);
  assert.equal(r.streak, 0);
});

test('estimateNextExDiv：季度派息（VGT 式）往后推一个季度', () => {
  const divs = [
    { date: '2025-03-25', amount: 0.13 },
    { date: '2025-06-26', amount: 0.14 },
    { date: '2025-09-24', amount: 0.145 },
    { date: '2025-12-17', amount: 0.148 },
    { date: '2026-03-24', amount: 0.146 },
    { date: '2026-06-24', amount: 0.147 },
    { date: '2026-09-23', amount: 0.147 },
  ];
  const next = estimateNextExDiv(divs, TODAY);
  assert.equal(next.cadence, '季度');
  assert.equal(next.date, '2026-12-23');
  assert.equal(next.amount, 0.147);
  assert.equal(next.estimated, true);
});

test('estimateNextExDiv：年度派息（SMH 式）往后推一年', () => {
  const divs = [
    { date: '2022-12-19', amount: 1.02 },
    { date: '2023-12-18', amount: 1.05 },
    { date: '2024-12-23', amount: 1.08 },
    { date: '2025-12-22', amount: 1.105 },
  ];
  const next = estimateNextExDiv(divs, TODAY);
  assert.equal(next.cadence, '年度');
  assert.equal(next.date, '2026-12-22');
  assert.equal(next.amount, 1.105);
});

test('estimateNextExDiv：数据不足或非法时返回 null（界面据此不显示）', () => {
  assert.equal(estimateNextExDiv([], TODAY), null);
  assert.equal(estimateNextExDiv([{ date: '2026-09-23', amount: 0.147 }], TODAY), null, '只有一条推不出周期');
  assert.equal(estimateNextExDiv([{ date: 'bad', amount: 1 }, { date: '2026-09-23', amount: 1 }], TODAY), null);
  assert.equal(estimateNextExDiv([{ date: '2025-09-23', amount: 0 }, { date: '2026-09-23', amount: 0.1 }], TODAY), null);
});
