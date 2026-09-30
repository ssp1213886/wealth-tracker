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
  fetchWithTimeout,
  FETCH_TIMEOUT_MS,
  SYNC_TIMEOUT_MS,
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
  // v319：负号必须在 $ 前面（手机端累计收益靠"首字符是不是 -"判断盈亏染色）
  assert.equal(fmtFull(-2500), '-$2,500.00');
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
  // v319 起：负数也是"符号在前"（-$8.00），与正数 +$12.50 对称
  // 如果哪天要改成 -$8.00，先改这条断言，再改实现。
  assert.equal(fmtPnLFull(-8), '-$8.00');
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

// v320：客户端网络调用必须有截止时间 —— 链路黑洞时 fetch 可以永远不返回，
// 调用方的"进行中"状态就永久卡住（刷新按钮、骨架微光、账号操作按钮）。
test('fetchWithTimeout：超时必须中断，正常返回要清掉定时器', { timeout: 5000 }, async () => {
  const orig = globalThis.fetch;
  try {
    // ① 永不返回 → 到点必须中断（与 syncFetch 的 15 秒硬超时同一套机制）
    let aborted = false;
    globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
      const sig = opts && opts.signal;
      assert.ok(sig, '必须带 AbortSignal，否则中断不了');
      sig.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    });
    await assert.rejects(() => fetchWithTimeout('https://x/y', {}, 30), (e) => e && e.name === 'AbortError');
    assert.equal(aborted, true, '超时后必须真的把请求中断');

    // ② 正常返回 → 结果透传，且事后不再被中断（定时器已清）
    let abortedOnSuccess = false;
    globalThis.fetch = (url, opts) => {
      opts.signal.addEventListener('abort', () => { abortedOnSuccess = true; });
      return Promise.resolve({ ok: true, status: 200 });
    };
    const res = await fetchWithTimeout('https://x/y');
    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(abortedOnSuccess, false, '成功返回后不该再触发中断');

    // ③ 调用方传的其它选项要保留
    let seenMethod = null;
    globalThis.fetch = (url, opts) => { seenMethod = opts.method; return Promise.resolve({ ok: true }); };
    await fetchWithTimeout('https://x/y', { method: 'POST' });
    assert.equal(seenMethod, 'POST');
  } finally {
    globalThis.fetch = orig;
  }
});

// v321：两套超时常量集中在一处（以前同步那条散在 index.js 里），并保证"同步比普通宽"
test('超时常量：同步(15s) 要宽于普通请求(10s)，且都是正数', () => {
  assert.ok(FETCH_TIMEOUT_MS > 0 && SYNC_TIMEOUT_MS > 0);
  assert.ok(SYNC_TIMEOUT_MS >= FETCH_TIMEOUT_MS, '同步是关键路径，慢网络下不该比普通请求先超时');
  assert.equal(FETCH_TIMEOUT_MS, 10000);
  assert.equal(SYNC_TIMEOUT_MS, 15000);
});
