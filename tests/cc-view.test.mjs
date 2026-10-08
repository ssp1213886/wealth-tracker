// 「卖 CALL 节奏」视图层单测（v331 起）：节奏表、节奏选择、除息提示的周期门控。
// 除息那条尤其要卡住 —— 它以前是每轮都挂着的，现在只在除息日落在本轮周期内才出现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueText, scheduleRowsHtml, rulePickerHtml, exDivLineHtml } from '../src/app/cc-view.js';

const row = (over) => Object.assign({
  sym: 'VGT', rule: 'monthly3', label: '每月第三个周五', short: '月度',
  nextExpiry: '2026-10-16', daysToGo: 8, isDue: false,
}, over);

test('dueText：0 → 今天、1 → 明天，其余 N 天；非法值给破折号', () => {
  assert.equal(dueText(0), '今天');
  assert.equal(dueText(1), '明天');
  assert.equal(dueText(8), '8 天');
  assert.equal(dueText(NaN), '—');
  assert.equal(dueText(null), '—');
});

test('scheduleRowsHtml：4 列（不再有「节奏」列）、到期日带星期、今天到期的行高亮', () => {
  const html = scheduleRowsHtml([row({}), row({ sym: 'SMH', nextExpiry: '2026-10-30', daysToGo: 0, isDue: true })], {});
  assert.match(html, /<th>标的<\/th><th>下次到期日<\/th><th>距今<\/th><th>连续执行<\/th>/);
  assert.doesNotMatch(html, /<th>节奏<\/th>/, 'v331 去掉了重复的节奏列');
  assert.match(html, /2026-10-16<small class="prob-sub">周五<\/small>/);
  assert.match(html, /class="is-due"/);
  assert.match(html, /10-30|2026-10-30/);
  assert.equal((html.match(/is-due/g) || []).length, 1, '只有今天到期的行高亮');
  assert.match(html, /今天/);
});

test('scheduleRowsHtml：连续执行与漏记的两种文案，没记录给破折号', () => {
  const html = scheduleRowsHtml([row({}), row({ sym: 'SMH' })], {
    streaks: { VGT: { streak: 3, total: 5 }, SMH: { streak: 0, total: 4, missed: '2026-09-18' } },
  });
  assert.match(html, /cc-streak">✓ 3 轮/);
  assert.match(html, /cc-missed">本轮未记/);
  assert.match(scheduleRowsHtml([row({})], { streaks: { VGT: { streak: 0, total: 0 } } }), /—/);
});

test('scheduleRowsHtml：空数组给空态', () => {
  assert.match(scheduleRowsHtml([], { emptyHint: '节奏加载中…' }), /节奏加载中/);
  assert.match(scheduleRowsHtml(null, {}), /prob-empty/);
});

test('rulePickerHtml：VGT 锁月度（没有周期权），SMH 给可点的两个按钮', () => {
  const vgt = rulePickerHtml('VGT', 'monthly3');
  assert.match(vgt, /cc-locked/);
  assert.match(vgt, /没有周期权/);
  assert.doesNotMatch(vgt, /data-ccrule/, 'VGT 不该出现可点按钮');
  const smh = rulePickerHtml('SMH', 'every3w');
  assert.match(smh, /data-ccrule="SMH\|monthly3"/);
  assert.match(smh, /data-ccrule="SMH\|every3w"/);
  assert.equal((smh.match(/is-on/g) || []).length, 1, '只有当前节奏高亮');
});

/* ---------------- 除息提示的周期门控 ---------------- */

test('exDivLineHtml：除息日落在本轮周期内（早于下次到期日）才显示', () => {
  const inCycle = [{ sym: 'VGT', next: { date: '2026-10-14', amount: 0.147, cadence: '季度' } }];
  const rowsIn = [row({ nextExpiry: '2026-10-16' })];
  const html = exDivLineHtml(inCycle, { rows: rowsIn });
  assert.match(html, /本轮周期内含除息/);
  assert.match(html, /VGT 2026-10-14/);
  assert.match(html, /\$0\.147\/股 · 季度/);
});

test('exDivLineHtml：除息日在更远的周期 → 整行不显示（这是 v331 的行为变更）', () => {
  const farDiv = [{ sym: 'VGT', next: { date: '2026-12-23', amount: 0.147, cadence: '季度' } }];
  assert.equal(exDivLineHtml(farDiv, { rows: [row({ nextExpiry: '2026-10-16' })] }), '',
    '12-23 的除息不属于 10-16 这轮，不该提前两个多月挂着');
  // 12-23 落在「12-18 到期之后的下一轮」里：等下次到期日推到 2027-01-15 时它才该显示
  assert.equal(exDivLineHtml(farDiv, { rows: [row({ nextExpiry: '2026-12-18' })] }), '', '12-23 还在 12-18 之后，不属于那一轮');
  assert.match(exDivLineHtml(farDiv, { rows: [row({ nextExpiry: '2027-01-15' })] }), /2026-12-23/);
});

test('exDivLineHtml：同一轮里两个标的都有除息时并排显示', () => {
  const both = [
    { sym: 'VGT', next: { date: '2026-12-23', amount: 0.147, cadence: '季度' } },
    { sym: 'SMH', next: { date: '2026-12-22', amount: 1.105, cadence: '年度' } },
  ];
  const html = exDivLineHtml(both, { rows: [row({ sym: 'VGT', nextExpiry: '2027-01-15' }), row({ sym: 'SMH', nextExpiry: '2026-12-23' })] });
  assert.match(html, /VGT 2026-12-23/);
  assert.match(html, /SMH 2026-12-22/);
  assert.match(html, /提前行权可能/);
});

test('exDivLineHtml：缺 rows（节奏还没算出来）时宁可什么都不显示', () => {
  assert.equal(exDivLineHtml([{ sym: 'VGT', next: { date: '2026-10-14', amount: 0.147, cadence: '季度' } }], {}), '');
  assert.equal(exDivLineHtml([], { rows: [row({})] }), '');
  assert.equal(exDivLineHtml(null, { rows: [row({})] }), '');
});
