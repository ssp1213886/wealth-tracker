// 「场景脚本算不算失败」的判据（v389）。这些断言看着琐碎，但它们挡的是最贵的一类问题：
// 装置本身失效 —— 断言挂了、常跑入口照样报"全部通过"，烂了 50 多个版本都没人发现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { failureOf } from '../scripts/e2e/verdict.mjs';

test('failureOf：计数式失败（failed > 0）算失败', () => {
  assert.equal(failureOf({ total: 47, passed: 46, failed: 1 }), '脚本自报 1 项失败');
  assert.equal(failureOf({ failed: 0, passed: 47 }), null, 'failed:0 是正常');
  assert.equal(failureOf({ total: 47, passed: 47 }), null, '没有 failed 字段（如同步全链路）不误判');
});

test('failureOf：步骤式失败（log 里 ok:false）算失败，且报出是哪几步', () => {
  const ok = { log: [{ step: 'A', ok: true }, { step: 'B', ok: true }], lastError: null };
  assert.equal(failureOf(ok), null);
  const bad = { log: [{ step: 'A. 记录一张卖 Call', ok: false }, { step: 'B', ok: true }], lastError: null };
  assert.equal(failureOf(bad), '步骤失败 1 项：A. 记录一张卖 Call');
});

test('failureOf：lastError 非空算失败；空值/无返回值/字符串都不误判', () => {
  assert.equal(failureOf({ holding: {}, lastError: 'TypeError: x is not a function' }),
    '运行期有未捕获错误：TypeError: x is not a function');
  assert.equal(failureOf({ lastError: null }), null);
  assert.equal(failureOf(undefined), null, '脚本没有返回值时不当成失败');
  assert.equal(failureOf('✓ 全部正常'), null, '返回字符串的脚本（同步全链路）不受影响');
  assert.equal(failureOf(null), null);
});

test('failureOf：ok:false 但缺 failed/log/lastError 的形状不受影响（如 flows 里的内联 ok）', () => {
  assert.equal(failureOf({ ok: true, syms: ['VGT'] }), null);
  assert.equal(failureOf({ marketcap: { ok: false, why: 'no row' } }), null, '嵌套对象不参与判定');
});
