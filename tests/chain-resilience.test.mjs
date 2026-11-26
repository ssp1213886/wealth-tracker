import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChain } from '../src/lib/chain.js';

function memoryCaches(seed) {
  const store = new Map(seed || []);
  return {
    store,
    api: {
      async match(request) {
        const hit = store.get(String(request.url));
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        store.set(String(request.url), response.clone());
      },
    },
  };
}

function edgeUrl(key) {
  return 'https://test.local/__edge/' + encodeURIComponent(key);
}

function cboePayload() {
  const expiry = new Date(Date.now() + 60 * 86400000);
  const code = String(expiry.getUTCFullYear()).slice(-2) +
    String(expiry.getUTCMonth() + 1).padStart(2, '0') +
    String(expiry.getUTCDate()).padStart(2, '0');
  return {
    data: {
      close: 120,
      last_trade_time: '2026-11-26T15:59:58',
      iv30: 24.5,
      options: [{
        option: 'VGT' + code + 'C00130000',
        bid: 1.2,
        ask: 1.3,
        last_trade_price: 1.25,
        iv: 0.24,
        open_interest: 100,
        volume: 5,
        delta: 0.42,
      }],
    },
  };
}

test('handleChain：CBOE 短暂失败后自动重试成功', async (t) => {
  const previousCaches = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const memo = memoryCaches();
  globalThis.caches = { default: memo.api };
  let calls = 0;
  globalThis.fetch = async function () {
    calls += 1;
    if (calls === 1) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify(cboePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(function () {
    globalThis.caches = previousCaches;
    globalThis.fetch = previousFetch;
  });
  const url = new URL('https://test.local/api/chain?sym=VGT');
  const result = await handleChain(new Request(url), url);
  assert.equal(result.status, 200);
  assert.equal(result.body.chain.source, 'cboe');
  assert.equal(calls, 2);
  assert.ok(memo.store.has(edgeUrl('chain:v2:VGT')));
  assert.ok(memo.store.has(edgeUrl('chain:stale:v2:VGT')));
});

test('handleChain：两个上游都失败时返回最后成功链并标记 stale', async (t) => {
  const previousCaches = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const staleBody = {
    ok: true,
    cachedAt: 1760000000000,
    chain: { sym: 'VGT', spot: 120, source: 'cboe', updated: '', iv30: 20, expiries: [] },
  };
  const memo = memoryCaches([[edgeUrl('chain:stale:v2:VGT'), new Response(JSON.stringify(staleBody))]]);
  globalThis.caches = { default: memo.api };
  globalThis.fetch = async function () { return new Response('down', { status: 503 }); };
  t.after(function () {
    globalThis.caches = previousCaches;
    globalThis.fetch = previousFetch;
  });
  const url = new URL('https://test.local/api/chain?sym=VGT');
  const result = await handleChain(new Request(url), url);
  assert.equal(result.status, 200);
  assert.equal(result.body.stale, true);
  assert.equal(result.body.staleAt, staleBody.cachedAt);
  assert.match(result.body.staleReason, /cboe/);
  assert.match(result.body.staleReason, /yahoo/);
});
