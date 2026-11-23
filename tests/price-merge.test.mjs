// v398：云端 prices 拉取时的"只升不降"规则。
// 线上事故：报价先到（$1,448.51），同步后到，旧价把持仓市值盖回 $2,004.04。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePullPrices } from '../src/app/price-merge.js';

const quote = (price, time) => ({ price, time });

test('云端比实时报价旧：不覆盖（v398 回归）', () => {
  const r = mergePullPrices({
    cloud: { VGT: quote(127.98, 1000) },
    cache: { VGT: quote(127.98, 1000) },
    live: { VGT: quote(97.64, 2000) },
  });
  assert.equal(r.changed, false);
  assert.deepEqual(r.patch, {});
  assert.deepEqual(r.livePrices, {});
});

test('时间戳相等也不覆盖（旧实现用 >= 会覆盖）', () => {
  const r = mergePullPrices({
    cloud: { SMH: quote(603.33, 1000) },
    cache: { SMH: quote(603.33, 1000) },
    live: {},
  });
  assert.equal(r.changed, false);
});

test('云端确实更新时才采用，并同时同步 cache 与 livePrices', () => {
  const r = mergePullPrices({
    cloud: { IBIT: quote(33.02, 3000) },
    cache: { IBIT: quote(46.55, 1000) },
    live: { IBIT: quote(33.05, 2000) },
  });
  assert.equal(r.changed, true);
  assert.equal(r.patch.IBIT.price, 33.02);
  assert.equal(r.livePrices.IBIT, 33.02);
});

test('实时报价比云端新、也比本地缓存新：两边都不动', () => {
  const r = mergePullPrices({
    cloud: { VGT: quote(120, 1500) },
    cache: { VGT: quote(127.98, 1000) },
    live: { VGT: quote(97.64, 2000) },
  });
  assert.equal(r.changed, false);
});

test('云端没有时间戳：本地有任何数据就跳过', () => {
  const withCache = mergePullPrices({ cloud: { VGT: { price: 127.98 } }, cache: { VGT: quote(127.98, 1000) }, live: {} });
  assert.equal(withCache.changed, false);
  const withLive = mergePullPrices({ cloud: { VGT: { price: 127.98 } }, cache: {}, live: { VGT: quote(97.64, 2000) } });
  assert.equal(withLive.changed, false);
});

test('云端没有时间戳、本地也完全没有：采用它（聊胜于无）', () => {
  const r = mergePullPrices({ cloud: { VGT: { price: 127.98 } }, cache: {}, live: {} });
  assert.equal(r.changed, true);
  assert.equal(r.livePrices.VGT, 127.98);
});

test('非法价格 / 坏条目一律忽略，不影响其它标的', () => {
  const r = mergePullPrices({
    cloud: { BAD: { price: 0, time: 9999 }, NULL: null, GOOD: quote(100, 3000) },
    cache: {},
    live: {},
  });
  assert.equal(r.changed, true);
  assert.deepEqual(Object.keys(r.patch), ['GOOD']);
});

test('多个标的各自判定，互不影响', () => {
  const r = mergePullPrices({
    cloud: { VGT: quote(90, 5000), SMH: quote(700, 1000) },
    cache: { VGT: quote(127.98, 1000), SMH: quote(603.33, 1000) },
    live: { VGT: quote(97.64, 2000) },
  });
  assert.deepEqual(Object.keys(r.patch), ['VGT']);
  assert.equal(r.livePrices.VGT, 90);
});
