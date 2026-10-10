// v375：删期权的现金处理单测 —— 核心是"删两次不能退两次现金"（真机实测过的回归）
import test from 'node:test';
import assert from 'node:assert/strict';
import { planOptionDelete } from '../src/app/options.js';

const opt = { id: 77, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1 };

test('planOptionDelete：按 oid 精确撤销那条权利金流水（现金只退这一次）', () => {
  const logs = [
    { id: 1, type: '入金', amount: 2000 },
    { id: 2, oid: 77, type: '权利金+VGT', amount: 120 },
    { id: 3, type: '股息', amount: 5 },
  ];
  const plan = planOptionDelete(opt, logs);
  assert.equal(plan.matched, true);
  assert.deepEqual(plan.removed.map((x) => x.id), [2]);
  assert.deepEqual(plan.kept.map((x) => x.id), [1, 3]);
  assert.equal(plan.cashDelta, -120, '现金退回一次，金额等于那条流水');
});

test('planOptionDelete：删第二次不再动现金（防"删两次退两次"）', () => {
  const logs = [{ id: 1, type: '入金', amount: 2000 }, { id: 2, oid: 77, type: '权利金+VGT', amount: 120 }];
  const first = planOptionDelete(opt, logs);
  const second = planOptionDelete(opt, first.kept);
  assert.equal(second.matched, false);
  assert.equal(second.cashDelta, 0, '第二次必须一分钱都不动');
  assert.deepEqual(second.kept.map((x) => x.id), [1]);
});

test('planOptionDelete：老数据没 oid → 按"同标的 + 金额相同"的最近一条兜底；找不到就不动现金', () => {
  const legacy = [{ id: 9, type: '权利金+VGT', amount: 120 }];
  const p1 = planOptionDelete(opt, legacy);
  assert.equal(p1.matched, true);
  assert.equal(p1.cashDelta, -120);
  const none = planOptionDelete({ id: 99, sym: 'SMH', premium: 50, contracts: 2 }, legacy);
  assert.equal(none.matched, false);
  assert.equal(none.cashDelta, 0, '找不到对应流水时不许凭空虚增/虚减现金');
});
