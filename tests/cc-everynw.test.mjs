// v374：节奏"每 N 周的周五"（everyNw）单测 —— N 可配、等价于老的 every3w、N 非法时不乱算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextEveryNw, nextEvery3W, scheduleRow, weeksOf, ruleLabel, CC_RULES } from '../src/app/cc-schedule.js';

test('nextEveryNw：N=3 与老的 nextEvery3W 完全等价（兼容性）', () => {
  for (const from of ['2026-10-10', '2026-11-01', '2026-12-25', '2027-01-01']) {
    assert.equal(nextEveryNw('2026-10-30', 3, from), nextEvery3W('2026-10-30', from));
  }
});

test('nextEveryNw：N=1/2/4 各自落在一周/两周/四周的网格上，且都从锚点相位算起', () => {
  const anchor = '2026-10-30';
  assert.equal(nextEveryNw(anchor, 1, '2026-10-31'), '2026-11-06', '每周五');
  assert.equal(nextEveryNw(anchor, 2, '2026-10-31'), '2026-11-13', '隔周五');
  assert.equal(nextEveryNw(anchor, 4, '2026-10-31'), '2026-11-27', '每 4 周');
  assert.equal(nextEveryNw(anchor, 4, '2026-11-28'), '2026-12-25');
});

test('nextEveryNw：锚点不是周五 / N 非法 → 返回 null（而不是随便给个日期）', () => {
  assert.equal(nextEveryNw('2026-10-29', 3, '2026-10-10'), null, '锚点必须周五');
  assert.equal(nextEveryNw('2026-10-30', 0, '2026-10-10'), null);
  assert.equal(nextEveryNw('2026-10-30', 9, '2026-10-10'), null);
});

test('scheduleRow：读 cfg 里的 weeks，标签也跟着变', () => {
  const cfg = { IBIT: { rule: 'everyNw', weeks: 4, anchor: '2026-10-30' } };
  const row = scheduleRow('IBIT', cfg, '2026-10-31');
  assert.equal(row.rule, 'everyNw');
  assert.equal(row.nextExpiry, '2026-11-27');
  assert.equal(row.label, '每 4 周的周五');
  assert.equal(weeksOf('IBIT', cfg), 4);
  assert.equal(ruleLabel('IBIT', cfg), '每 4 周的周五');
  /* 缺 weeks 时按 3 周（等价于 every3w），不抛错 */
  const bare = scheduleRow('IBIT', { IBIT: { rule: 'everyNw', anchor: '2026-10-30' } }, '2026-10-31');
  assert.equal(bare.nextExpiry, '2026-11-20');
  assert.equal(CC_RULES.indexOf('everyNw') >= 0, true);
});
