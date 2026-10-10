// 核心仓配置的纯逻辑单测（v374）：默认值 / 归一化 / 迁移兜底 / 校验 / 派生。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_DEFAULTS, normalizeCore, validateCore, coreSymbols, optionSymbols,
  targetOf, assetOf, otmOf, optScheduleOf, validSym, isFriday, nextFridays,
  MAX_CORE_SYMS, MAX_OPTION_SYMS,
} from '../src/app/core-config.js';

test('默认核心仓 = VGT / SMH / IBIT，比例 50/30/20，IBIT 参与期权且 OTM 10%', () => {
  const core = normalizeCore(null);
  assert.deepEqual(coreSymbols(core), ['VGT', 'SMH', 'IBIT']);
  assert.deepEqual(optionSymbols(core), ['SMH', 'IBIT']);
  assert.equal(targetOf(core, 'VGT'), 0.5);
  assert.equal(targetOf(core, 'IBIT'), 0.2);
  assert.equal(assetOf(core, 'IBIT'), '比特币');
  assert.equal(assetOf(core, 'VGT'), 'VGT');
  assert.equal(otmOf(core, 'IBIT'), 10);
  assert.deepEqual(optScheduleOf(core, 'IBIT'), { rule: 'everyNw', weeks: 3, anchor: CORE_DEFAULTS[2].opt.anchor });
  assert.equal(optScheduleOf(core, 'VGT'), null, 'VGT 默认不卖 CALL');
});

test('迁移兜底：旧 state 的比例与 otmSettings 会被继承（v3→v4 的第一手语义）', () => {
  const core = normalizeCore(null, { vgt: 0.4, smh: 0.35, btc: 0.25, otm: { vgt: 8, smh: 5, ibit: 12 } });
  assert.equal(targetOf(core, 'VGT'), 0.4);
  assert.equal(targetOf(core, 'IBIT'), 0.25);
  assert.equal(otmOf(core, 'SMH'), 5);
  assert.equal(otmOf(core, 'IBIT'), 12);
});

test('归一化：非法代码/重复/越界值都被挡掉，比例与 OTM 落在合法区间', () => {
  const core = normalizeCore([
    { sym: 'vgt', target: 0.6 },
    { sym: 'VGT', target: 0.1 },           // 重复 → 丢
    { sym: '../etc', target: 0.1 },        // 非法 → 丢
    { sym: 'IBIT', target: 5, opt: { on: true, rule: 'everyNw', weeks: 99, anchor: '2026-10-30', otm: 99 } },
  ]);
  assert.deepEqual(coreSymbols(core), ['VGT', 'IBIT']);
  assert.equal(targetOf(core, 'IBIT'), 1, '比例被夹到 0–1');
  assert.equal(otmOf(core, 'IBIT'), 30, 'OTM 被夹到上限');
  assert.equal(optScheduleOf(core, 'IBIT').weeks, 6, '周数被夹到上限');
  assert.equal(optScheduleOf(core, 'IBIT').anchor, '2026-10-30');
});

test('锚点不是周五 → 不落库（宁可回落到默认，也不要一个算不出节奏的锚点）', () => {
  const core = normalizeCore([{ sym: 'SMH', target: 1, opt: { on: true, rule: 'everyNw', weeks: 3, anchor: '2026-10-29' } }]);
  assert.equal(isFriday('2026-10-29'), false);
  assert.equal(optScheduleOf(core, 'SMH').anchor, undefined);
});

test('显式的 on:false 必须能关掉"默认开着卖 CALL"的标的（IBIT 的开关要真的能关）', () => {
  const core = normalizeCore([
    { sym: 'VGT', target: 0.5, opt: { on: false } },
    { sym: 'SMH', target: 0.3, opt: { on: false } },
    { sym: 'IBIT', target: 0.2, opt: { on: false } },
  ]);
  assert.deepEqual(optionSymbols(core), [], '三个都关掉了就不该还有期权标的');
  /* 反过来：不写 on（undefined）时才用默认值 */
  const byDefault = normalizeCore([{ sym: 'IBIT', target: 1 }]);
  assert.deepEqual(optionSymbols(byDefault), ['IBIT'], '没写 on 的 IBIT 仍按默认参与');
});

test('校验：比例合计、重复、期权数量上限', () => {
  assert.equal(validateCore(CORE_DEFAULTS).ok, true);
  const bad = validateCore([
    { sym: 'VGT', target: 0.5 },
    { sym: 'SMH', target: 0.3 },
  ]);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('|'), /合计要等于 100%/);
  const dup = validateCore([{ sym: 'VGT', target: 1 }, { sym: 'vgt', target: 0 }]);
  assert.match(dup.errors.join('|'), /代码重复/);
  const tooManyOpt = validateCore([
    { sym: 'VGT', target: 0.25, opt: { on: true, rule: 'monthly3', otm: 7 } },
    { sym: 'SMH', target: 0.25, opt: { on: true, rule: 'monthly3', otm: 7 } },
    { sym: 'IBIT', target: 0.3, opt: { on: true, rule: 'monthly3', otm: 10 } },
    { sym: 'VOO', target: 0.2, opt: { on: true, rule: 'monthly3', otm: 7 } },
  ]);
  assert.match(tooManyOpt.errors.join('|'), new RegExp('最多 ' + MAX_OPTION_SYMS + ' 只'));
  assert.equal(validateCore([{ sym: 'VGT', target: 1 }]).warnings.length, 1, '一个期权标的都没有 → 给个提醒');
});

test('代码白名单与周五工具', () => {
  assert.equal(validSym('IBIT'), true);
  assert.equal(validSym('BRK-B'), true);
  assert.equal(validSym('aapl'), true);
  assert.equal(validSym('1INCH'), false, '数字开头不收（避免歧义）');
  assert.equal(validSym('BTC-USD'), true);
  assert.equal(validSym('../x'), false);
  assert.equal(isFriday('2026-10-30'), true);
  const fridays = nextFridays('2026-10-10', 3);
  assert.deepEqual(fridays, ['2026-10-16', '2026-10-23', '2026-10-30']);
});

test('标的数量上限：多写了会被截断', () => {
  const many = [];
  for (let i = 0; i < MAX_CORE_SYMS + 3; i += 1) many.push({ sym: 'S' + i, target: 0.1 });
  assert.equal(coreSymbols(many).length, MAX_CORE_SYMS);
});
