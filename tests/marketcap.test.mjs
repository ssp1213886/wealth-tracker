// 市值代理（src/lib/marketcap.js）的单测：解析、回落、缓存、入参白名单。
// 全部用假 fetch，不碰真实 Nasdaq。
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketCap } from '../src/lib/marketcap.js';

function withFetch(impl, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = saved; });
}

/** CoinLore 的返回表：模块内是全局缓存，所有币的用例共用同一份，避免先到先得的顺序耦合。 */
const COINLORE_TABLE = [
  { symbol: 'BTC', market_cap_usd: '1663425017662.20' },
  { symbol: 'ETH', market_cap_usd: '326869319620.04' },
  { symbol: 'HYPE', market_cap_usd: '28615649075.35' },
];

const nasdaq = (summaryData, status = 200) => Promise.resolve(new Response(JSON.stringify({ data: { summaryData } }), { status }));
const call = (symbols) => {
  const url = new URL('https://example.com/api/marketcap?symbols=' + encodeURIComponent(symbols));
  return handleMarketCap(new Request(url), url);
};

test('handleMarketCap：把 Nasdaq 的 "5,475,761,000,000" 解析成数字', async () => {
  await withFetch(() => nasdaq({ MarketCap: { label: 'Market Cap', value: '5,475,761,000,000' } }), async () => {
    const result = await call('TESTA');
    assert.equal(result.status, 200);
    assert.equal(result.body.caps.TESTA, 5475761000000);
    assert.deepEqual(result.body.missing, []);
  });
});

test('handleMarketCap：stocks 查不到时按 etf 再查一次（SMH 这类 ETF 只在 etf 下给市值）', async () => {
  const seen = [];
  const fake = (url) => {
    seen.push(String(url));
    if (String(url).includes('assetclass=stocks')) return nasdaq({});
    return nasdaq({ MarketCap: { value: '78,467,697,147' } });
  };
  await withFetch(fake, async () => {
    const result = await call('TESTB');
    assert.equal(result.body.caps.TESTB, 78467697147);
    assert.equal(seen.length, 2, '应该先 stocks 再 etf');
    assert.match(seen[1], /assetclass=etf/);
  });
});

test('handleMarketCap：N/A / 空 / 上游报错都进 missing，不编数字', async () => {
  await withFetch(() => nasdaq({ MarketCap: { value: 'N/A' } }), async () => {
    const result = await call('TESTC');
    assert.deepEqual(result.body.caps, {});
    assert.deepEqual(result.body.missing, ['TESTC']);
  });
  await withFetch(() => Promise.reject(new Error('boom')), async () => {
    const result = await call('TESTD');
    assert.deepEqual(result.body.missing, ['TESTD']);
  });
});

test('handleMarketCap：命中缓存后不再出网', async () => {
  let hits = 0;
  await withFetch(() => { hits += 1; return nasdaq({ MarketCap: { value: '1,000,000,000' } }); }, async () => {
    await call('TESTE');
    await call('TESTE');
    assert.equal(hits, 1);
  });
});

test('handleMarketCap：Nasdaq 查不到的币，用 CoinLore 的市值补上', async () => {
  const fake = (url) => {
    const target = String(url);
    if (target.includes('api.nasdaq.com')) return nasdaq({});
    if (target.includes('coinlore.net')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: COINLORE_TABLE,
      }), { status: 200 }));
    }
    return Promise.reject(new Error('不该请求 ' + target));
  };
  await withFetch(fake, async () => {
    const result = await call('BTC');
    assert.equal(result.body.caps.BTC, 1663425017662.2);
    assert.deepEqual(result.body.missing, []);
  });
});

test('handleMarketCap：不在加密白名单里的代码不会拿去 CoinLore 乱认（SKHYV 就是这只）', async () => {
  let coinloreHits = 0;
  const fake = (url) => {
    const target = String(url);
    if (target.includes('api.nasdaq.com')) return nasdaq({});
    if (target.includes('coinlore.net')) {
      coinloreHits += 1;
      return Promise.resolve(new Response(JSON.stringify({ data: [{ symbol: 'SKHYV', market_cap_usd: '1' }] }), { status: 200 }));
    }
    return Promise.reject(new Error('不该请求 ' + target));
  };
  await withFetch(fake, async () => {
    const result = await call('SKHYV');
    assert.deepEqual(result.body.missing, ['SKHYV']);
    assert.equal(coinloreHits, 0, 'SKHYV 不是币，不该去查 CoinLore');
  });
});

test('handleMarketCap：GOLD 要的是金价（GC=F），不能被同名美股 Barrick Gold 顶掉', async () => {
  const asked = [];
  const fake = (url) => {
    asked.push(String(url));
    return nasdaq({ MarketCap: { value: '60,000,000,000' } });
  };
  await withFetch(fake, async () => {
    const result = await call('GOLD,NVDA');
    assert.equal(result.body.caps.GOLD, undefined, 'GOLD 不是公司，不该给市值');
    assert.deepEqual(result.body.missing, ['GOLD']);
    assert.ok(result.body.caps.NVDA > 0);
    assert.ok(!asked.some((u) => u.includes('/GOLD/')), '根本不该向上游问 GOLD');
  });
});

test('handleMarketCap：币一律走 CoinLore，绝不先问 Nasdaq（ETH 在 Nasdaq 上是 Ethan Allen 家具公司）', async () => {
  const asked = [];
  const fake = (url) => {
    const target = String(url);
    asked.push(target);
    if (target.includes('api.nasdaq.com')) return nasdaq({ MarketCap: { value: '1,240,847,244' } });
    if (target.includes('coinlore.net')) {
      return Promise.resolve(new Response(JSON.stringify({
        data: COINLORE_TABLE,
      }), { status: 200 }));
    }
    return Promise.reject(new Error('不该请求 ' + target));
  };
  await withFetch(fake, async () => {
    const result = await call('ETH');
    assert.equal(result.body.caps.ETH, 326869319620.04, 'ETH 必须是以太坊，不是 Ethan Allen');
    assert.ok(!asked.some((u) => u.includes('/ETH/')), '根本不该拿 ETH 去问 Nasdaq');
  });
});

test('handleMarketCap：代码白名单过滤注入与非法字符，全非法时 400', async () => {
  await withFetch(() => nasdaq({ MarketCap: { value: '1,000,000,000' } }), async () => {
    const result = await call("TESTF,<script>,'; DROP,../../etc,TESTG");
    assert.deepEqual(Object.keys(result.body.caps), ['TESTF', 'TESTG']);
  });
  const bad = new URL('https://example.com/api/marketcap?symbols=' + encodeURIComponent('<script>,1,..'));
  assert.equal((await handleMarketCap(new Request(bad), bad)).status, 400);
});

test('handleMarketCap：非 GET 返回 405', async () => {
  const url = new URL('https://example.com/api/marketcap?symbols=TESTH');
  assert.equal((await handleMarketCap(new Request(url, { method: 'POST' }), url)).status, 405);
});
