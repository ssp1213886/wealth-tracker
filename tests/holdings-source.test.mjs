// ETF 前十大来源的守卫（src/lib/quotes.js 的 validHoldingList / agreesWithStatic / handleHoldings）。
//
// 这组用例钉住的是本轮那个真实事故：
// 线上 /api/holdings?symbol=SMH 换成 Yahoo 之后，榜单里**没有 SK Hynix**、
// NVDA 权重还被抬高了 3.5 个点 —— 而它内部完全自洽，普通的"格式校验"根本拦不住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validHoldingList, agreesWithStatic, handleHoldings } from '../src/lib/quotes.js';
import { STATIC_HOLDINGS } from '../src/lib/holdings-static.js';

/** 真实抓到的三份 SMH 榜单（2026-09-30）。 */
const OFFICIAL_SMH = [
  { sym: 'NVDA', weight: 19.14 }, { sym: 'TSM', weight: 9.16 }, { sym: 'AMD', weight: 5.76 },
  { sym: 'AVGO', weight: 5.24 }, { sym: 'MU', weight: 5.01 }, { sym: 'INTC', weight: 4.94 },
  { sym: 'SKHY', weight: 4.59 }, { sym: 'TXN', weight: 4.54 }, { sym: 'MRVL', weight: 4.44 },
  { sym: 'AMAT', weight: 4.42 },
];
const YAHOO_SMH = [
  { sym: 'NVDA', weight: 22.63 }, { sym: 'TSM', weight: 9.65 }, { sym: 'AVGO', weight: 6.11 },
  { sym: 'MU', weight: 5.45 }, { sym: 'AMD', weight: 5.36 }, { sym: 'ASML', weight: 5.1 },
  { sym: 'LRCX', weight: 4.4 }, { sym: 'AMAT', weight: 4.36 }, { sym: 'ADI', weight: 4.32 },
  { sym: 'TXN', weight: 4.3 },
];

function withFetch(impl, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = saved; });
}

const html = (rows) => rows
  .map((r, i) => `<td class="rrpad svelte-1">${i + 1}</td><a href="/stocks/${r.sym.toLowerCase()}/" >${r.sym}</a>`
    + `<td class="shr svelte-1">${r.name || r.sym}</td><td class="svelte-1">${r.weight}%</td>`)
  .join('') + '<p>as of Sep 26, 2026</p>';

test('validHoldingList：合格的榜单放行，错位/重复/离谱的一律拦下', () => {
  assert.equal(validHoldingList(OFFICIAL_SMH), true);
  assert.equal(validHoldingList(YAHOO_SMH), true, 'Yahoo 那份内部是自洽的——所以必须靠第二道防线');

  assert.equal(validHoldingList(null), false);
  assert.equal(validHoldingList(OFFICIAL_SMH.slice(0, 4)), false, '只抄到 4 行不算前十大');
  // 权重回升 = 解析错位
  assert.equal(validHoldingList([{ sym: 'A', weight: 5 }, { sym: 'B', weight: 9 }]), false);
  // 同一代码出现两次
  assert.equal(validHoldingList([{ sym: 'A', weight: 9 }, { sym: 'A', weight: 8 }]), false);
  // 合计过低（残榜单）
  assert.equal(validHoldingList([{ sym: 'A', weight: 3 }, { sym: 'B', weight: 2 }]), false);
});

test('agreesWithStatic：Yahoo 那份 SMH 榜单会被集合比对拦下，stockanalysis 的放行', () => {
  assert.equal(agreesWithStatic(YAHOO_SMH, 'SMH'), false, '只对得上 6 个，不能信');
  assert.equal(agreesWithStatic(OFFICIAL_SMH, 'SMH'), true, '对得上 9 个');
  assert.equal(agreesWithStatic([{ sym: 'NVDA', weight: 1 }], 'SMH'), false);
  assert.equal(agreesWithStatic(OFFICIAL_SMH, 'UNKNOWN'), true, '没有手工榜可比时不拦');
});

test('手工兜底榜里必须有 SK Hynix（SKHYV）——这是它"消失"事故的回归点', () => {
  const symbols = STATIC_HOLDINGS.SMH.list.map((item) => item.sym);
  assert.ok(symbols.includes('SKHYV'), 'SKHYV 一旦从手工榜里被删掉，回落到 static 时又会消失');
  assert.ok(symbols.includes('INTC'));
});

test('handleHoldings(SMH)：走 stockanalysis，并把上游的 SKHY 归一成我们内部的 SKHYV', async () => {
  const fake = (url) => {
    if (String(url).includes('stockanalysis.com/etf/smh/holdings')) {
      return Promise.resolve(new Response(html(OFFICIAL_SMH.map((r, i) => ({ ...r, name: i === 6 ? 'SK hynix Inc.' : r.sym }))), { status: 200 }));
    }
    return Promise.reject(new Error('不该请求 ' + url));
  };
  await withFetch(fake, async () => {
    const url = new URL('https://example.com/api/holdings?symbol=SMH');
    const result = await handleHoldings(new Request(url), url);
    assert.equal(result.status, 200);
    assert.equal(result.body.source, 'stockanalysis');
    assert.equal(result.body.asOf, 'Sep 26, 2026');
    assert.equal(result.body.list.length, 10);
    assert.deepEqual(result.body.list.map((item) => item.sym).slice(0, 8), ['NVDA', 'TSM', 'AMD', 'AVGO', 'MU', 'INTC', 'SKHYV', 'TXN']);
    assert.equal(result.body.list[6].name, 'SK hynix Inc.');
  });
});

test('handleHoldings(VGT)：主源抓失败时回落到 Yahoo，绝不返回空榜', async () => {
  // Yahoo 的持仓是嵌在页面 JSON 里的转义串：\"holdings\":[{\"symbol\":\"NVDA\",…}]
  const rows = [['NVDA', 'NVIDIA Corp', 0.1774], ['AAPL', 'Apple Inc', 0.158], ['MSFT', 'Microsoft Corp', 0.1152],
    ['AVGO', 'Broadcom Inc', 0.0452], ['MU', 'Micron Technology', 0.0418], ['AMD', 'Advanced Micro Devices', 0.0295],
    ['CSCO', 'Cisco Systems', 0.0171], ['PLTR', 'Palantir Technologies', 0.0161], ['INTC', 'Intel Corp', 0.0154],
    ['LRCX', 'Lam Research', 0.0149]]
    .map(([symbol, holdingName, raw]) => ({ symbol, holdingName, holdingPercent: { raw } }));
  const yahoo = '{"page":"\\"holdings\\":' + JSON.stringify(rows).replace(/"/g, '\\"') + '"}';
  const fake = (url) => {
    if (String(url).includes('stockanalysis.com/etf/vgt/holdings')) return Promise.resolve(new Response('', { status: 500 }));
    if (String(url).includes('finance.yahoo.com')) return Promise.resolve(new Response(yahoo, { status: 200 }));
    return Promise.reject(new Error('不该请求 ' + url));
  };
  await withFetch(fake, async () => {
    const url = new URL('https://example.com/api/holdings?symbol=VGT');
    const result = await handleHoldings(new Request(url), url);
    assert.equal(result.body.source, 'yahoo');
    assert.equal(result.body.list[0].sym, 'NVDA');
    assert.equal(result.body.list[0].weight, 17.74);
  });
});

test('handleHoldings：非法 symbol / 方法一律拒掉', async () => {
  const url = new URL('https://example.com/api/holdings?symbol=AAPL');
  assert.equal((await handleHoldings(new Request(url), url)).status, 400);
  const post = new URL('https://example.com/api/holdings?symbol=SMH');
  assert.equal((await handleHoldings(new Request(post, { method: 'POST' }), post)).status, 405);
});
