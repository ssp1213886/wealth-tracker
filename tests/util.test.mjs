// 纯工具函数单测。搬进 src/app/util.js 之后可以直接 import —— 不再需要从压缩产物里"提取"。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeNum,
  cleanText,
  fmtFull,
  fmtShares,
  fmtPnLFull,
  cashSigned,
  sparklinePath,
  dateOrdinal,
} from '../src/app/util.js';

test('safeNum: 非法值归零，合法值原样返回', () => {
  assert.equal(safeNum(undefined), 0);
  assert.equal(safeNum(null), 0);
  assert.equal(safeNum('abc'), 0);
  assert.equal(safeNum(NaN), 0);
  assert.equal(safeNum(Infinity), 0);
  assert.equal(safeNum(12.5), 12.5);
  assert.equal(safeNum(0), 0);
});

test('cleanText: 清掉控制字符、去空白、按长度截断', () => {
  assert.equal(cleanText('  hello  '), 'hello');
  assert.equal(cleanText('a\u0000b'), 'a b');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText('x'.repeat(200), 5), 'xxxxx');
});

test('fmtFull: 千分位 + 两位小数', () => {
  assert.equal(fmtFull(1234.5), '$1,234.50');
  assert.equal(fmtFull(0), '$0.00');
  assert.equal(fmtFull(-2500), '$-2,500.00');
  assert.equal(fmtFull('abc'), '$0.00');
});

test('fmtShares: 去掉无意义的尾零，最多四位小数', () => {
  assert.equal(fmtShares(1), '1');
  assert.equal(fmtShares(1.0), '1');
  assert.equal(fmtShares(0.5), '0.5');
  assert.equal(fmtShares(9.85), '9.85');
  assert.equal(fmtShares(0.1234), '0.1234');
  assert.equal(fmtShares(0.12345), '0.1235');
  assert.equal(fmtShares(-3.2), '3.2');
  assert.equal(fmtShares(0), '0');
});

test('fmtPnLFull: 正数带 +，非法值显示占位', () => {
  assert.equal(fmtPnLFull(12.5), '+$12.50');
  // 现状：负数沿用 fmtFull 的写法，符号在 $ 之后（$-8.00）。
  // 如果哪天要改成 -$8.00，先改这条断言，再改实现。
  assert.equal(fmtPnLFull(-8), '$-8.00');
  assert.equal(fmtPnLFull(NaN), '-');
});

test('cashSigned: 只有出金与权利金退回算作现金流出', () => {
  assert.equal(cashSigned({ type: '入金', amount: 2000 }), 2000);
  assert.equal(cashSigned({ type: '出金', amount: 500 }), -500);
  assert.equal(cashSigned({ type: '股息', amount: 12.5 }), 12.5);
  assert.equal(cashSigned({ type: '权利金', amount: 86 }), 86);
  assert.equal(cashSigned({ type: '权利金退回-VGT', amount: 86 }), -86);
  assert.equal(cashSigned({}), 0);
});

test('sparklinePath: 少于两点不画，等值画平线，正常点生成路径', () => {
  assert.equal(sparklinePath([]), '');
  assert.equal(sparklinePath([1]), '');
  assert.equal(sparklinePath(null), '');
  assert.equal(sparklinePath(['x', 'y']), '');
  assert.equal(sparklinePath([5, 5, 5]), 'M1 11 H57');
  const path = sparklinePath([1, 2, 3]);
  assert.match(path, /^M1\.0 /);
  assert.ok(path.includes('L'));
  assert.equal(path.split('L').length - 1, 2); // 三个点 → 两段
});

test('dateOrdinal: 把 YYYY-MM-DD 转成天数序号，非法输入返回 NaN', () => {
  assert.equal(dateOrdinal('2026-01-01'), Math.floor(Date.UTC(2026, 0, 1) / 86400000));
  assert.equal(dateOrdinal('2026-01-02') - dateOrdinal('2026-01-01'), 1);
  assert.ok(Number.isNaN(dateOrdinal('2026/01/01')));
  assert.ok(Number.isNaN(dateOrdinal('')));
  assert.ok(Number.isNaN(dateOrdinal(null)));
});
