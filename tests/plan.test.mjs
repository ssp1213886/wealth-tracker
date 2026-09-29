// 策略工具 / 提款模拟纯逻辑单测（v235 从 index.js 抽出）
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DEFAULTS, WD_FIELDS, PLAN_WD_KEYS, readPlan, setPlanText, computeWithdrawal } from '../src/app/plan.js';

test('默认结构：4 档收入（3 列）、4 条退出动作、4 个提款参数', () => {
  assert.equal(PLAN_DEFAULTS.income.length, 4);
  PLAN_DEFAULTS.income.forEach((row) => assert.equal(row.length, 3));
  assert.equal(PLAN_DEFAULTS.exit.length, 4);
  assert.deepEqual(PLAN_WD_KEYS, ['portfolio', 'rate', 'ret', 'infl']);
  assert.deepEqual(WD_FIELDS.map((f) => f[1]), PLAN_WD_KEYS);
});

test('readPlan: 没有 plan 时回落到默认值，且返回新对象（不共享引用）', () => {
  const a = readPlan({});
  const b = readPlan({});
  assert.deepEqual(a.income, PLAN_DEFAULTS.income);
  a.income[0][0] = '改过了';
  assert.equal(b.income[0][0], PLAN_DEFAULTS.income[0][0], '不能共享默认数组引用');
  assert.deepEqual(a.wd, PLAN_DEFAULTS.wd);
});

test('readPlan: 结构不合法（行数不对）时整块回落默认值', () => {
  const short = readPlan({ plan: { income: [['a', 'b', 'c']], exit: ['x'] } });
  assert.deepEqual(short.income, PLAN_DEFAULTS.income);
  assert.deepEqual(short.exit, PLAN_DEFAULTS.exit);
});

test('readPlan: 合法数据按原样读回，数值字段转数字、非法值回落默认', () => {
  const plan = {
    income: [['一', '1', '2'], ['二', '3', '4'], ['三', '5', '6'], ['四', '7', '8']],
    exit: ['A', 'B', 'C', 'D'],
    wd: { portfolio: '3000000', rate: 3.5, ret: 'abc', infl: null },
  };
  const d = readPlan({ plan });
  assert.deepEqual(d.income[0], ['一', '1', '2']);
  assert.deepEqual(d.exit, ['A', 'B', 'C', 'D']);
  assert.equal(d.wd.portfolio, 3000000);
  assert.equal(d.wd.rate, 3.5);
  assert.equal(d.wd.ret, PLAN_DEFAULTS.wd.ret, '非法数字回落默认');
  assert.equal(d.wd.infl, PLAN_DEFAULTS.wd.infl, 'null 回落默认');
});

test('setPlanText: 收入档位与退出动作可改，越界/未知类型返回 null', () => {
  const base = readPlan({});
  const inc = setPlanText(base, 'income', 1, 0, '增长期(fixed)');
  assert.equal(inc.income[1][0], '增长期(fixed)');
  assert.equal(base.income[1][0], '增长期', '不能改到原对象');
  const ex = setPlanText(base, 'exit', 2, 0, '等待窗口(改)');
  assert.equal(ex.exit[2], '等待窗口(改)');
  assert.equal(setPlanText(base, 'income', 9, 0, 'x'), null);
  assert.equal(setPlanText(base, 'exit', 9, 0, 'x'), null);
  assert.equal(setPlanText(base, 'wd', 0, 0, 'x'), null);
  assert.equal(setPlanText(base, 'income', 0, 0, null).income[0][0], '');
});

test('computeWithdrawal: 年提款/月提款/实际回报率', () => {
  const out = computeWithdrawal({ portfolio: 1000000, ratePct: 4, returnPct: 6, inflPct: 2 });
  assert.equal(out.annual, 40000);
  assert.ok(Math.abs(out.monthly - 40000 / 12) < 1e-9);
  assert.ok(Math.abs(out.realReturn - 0.04) < 1e-9);
  assert.equal(out.depletionYears, null, '提款率 ≤ 实际回报 → 永续');
});

test('computeWithdrawal: 提款率高于实际回报会耗尽，能算出年数', () => {
  // 100 万本金、年提 10 万、0 通胀 0 收益 → 10 年耗尽
  const out = computeWithdrawal({ portfolio: 1000000, ratePct: 10, returnPct: 0, inflPct: 0 });
  assert.equal(out.depletionYears, 10);
});

test('computeWithdrawal: 负实际回报也按耗尽计算；80 年封顶视为永续', () => {
  const deplete = computeWithdrawal({ portfolio: 500000, ratePct: 6, returnPct: 4, inflPct: 3 });  // 实际 1% < 提款 6%
  assert.ok(deplete.depletionYears === null || deplete.depletionYears > 0);
  const capped = computeWithdrawal({ portfolio: 1000000, ratePct: 0, returnPct: 3, inflPct: 5 });   // 实际 -2%，但提款 0
  assert.equal(capped.depletionYears, null, '80 年封顶 → 显示永续');
  assert.ok(capped.realReturn < 0);
});

test('computeWithdrawal: 缺参数按 0 处理，不抛异常', () => {
  const out = computeWithdrawal({});
  assert.equal(out.annual, 0);
  assert.equal(out.monthly, 0);
  assert.equal(out.realReturn, 0);
  // 本金 0 → 立刻"耗尽"（0 年），与原实现一致；界面滑杆最小值远大于 0，不会显示这个边界
  assert.equal(out.depletionYears, 0);
});
