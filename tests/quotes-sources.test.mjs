// 加密报价回退链的单测（v324）：Binance.US / Kraken 的解析与"先谁后谁"。
//
// 背景：Cloudflare 出口实测 —— 币安全球站 403（封云厂商 IP）、CoinGecko 429（限流），
// 而 Binance.US / Kraken / Coinbase / Bybit 都是 200。原来只有 Yahoo → CoinGecko，
// Yahoo 一抽风加密报价就没了。
import test from 'node:test';
import assert from 'node:assert/strict';
import { krakenCodeOf, parseBinanceUsTickers, parseKrakenTickers, fetchCryptoAltQuotes } from '../src/lib/quotes.js';

test('krakenCodeOf：X/Z 前后缀与 XBT/XDG 别名都要还原', () => {
  assert.equal(krakenCodeOf('XXBTZUSD'), 'BTC');
  assert.equal(krakenCodeOf('XETHZUSD'), 'ETH');
  assert.equal(krakenCodeOf('XETCZUSD'), 'ETC');
  assert.equal(krakenCodeOf('XDGUSD'), 'DOGE');
  assert.equal(krakenCodeOf('ADAUSD'), 'ADA');
  assert.equal(krakenCodeOf('HYPEUSD'), 'HYPE');
  assert.equal(krakenCodeOf(''), '');
  assert.equal(krakenCodeOf(null), '');
});

test('parseBinanceUsTickers：只收我们要的 USDT 对，字段映射正确，坏输入不抛', () => {
  const rows = [
    { symbol: 'BTCUSDT', lastPrice: '83000.10', prevClosePrice: '82500.00', priceChangePercent: '0.606' },
    { symbol: 'ETHUSDT', lastPrice: '2600.50', prevClosePrice: '2650.00', priceChangePercent: '-1.868' },
    { symbol: 'SOLUSDT', lastPrice: '120.00' },                       // 没要 SOL → 忽略
    { symbol: 'ETHBTC', lastPrice: '0.03' },                          // 非 USDT 对 → 忽略
    { symbol: 'BTCUSDT', lastPrice: 'abc' },                          // 价格不是数 → 忽略
  ];
  const out = parseBinanceUsTickers(JSON.stringify(rows), ['BTC', 'ETH']);
  assert.deepEqual(out.BTC, { price: 83000.1, prevClose: 82500, changePct: 0.606, source: 'binanceus' });
  assert.deepEqual(out.ETH, { price: 2600.5, prevClose: 2650, changePct: -1.868, source: 'binanceus' });
  assert.equal(out.SOL, undefined);

  // 单个对象（不是数组）也要认
  const one = parseBinanceUsTickers(JSON.stringify({ symbol: 'BTCUSDT', lastPrice: '1' }), ['BTC']);
  assert.equal(one.BTC.price, 1);
  assert.deepEqual(parseBinanceUsTickers('not json', ['BTC']), {});
});

test('parseKrakenTickers：用当日开盘价近似昨收算涨跌，坏输入不抛', () => {
  const payload = {
    error: [],
    result: {
      XXBTZUSD: { c: ['83000.00', '0.1'], o: '82000.00' },
      XETHZUSD: { c: ['2600.00', '0.2'], o: '2600.00' },
      XDGUSD: { c: ['0.20', '1'], o: '0.19' },
      NOTWANTED: { c: ['1', '1'], o: '1' },
      NOOPEN: { c: ['5', '1'] },
    },
  };
  const out = parseKrakenTickers(JSON.stringify(payload), ['BTC', 'ETH', 'DOGE']);
  assert.equal(out.BTC.price, 83000);
  assert.equal(out.BTC.prevClose, 82000);
  assert.equal(out.BTC.changePct, 1.22);              // (83000-82000)/82000*100 = 1.2195… → 1.22
  assert.equal(out.BTC.source, 'kraken');
  assert.equal(out.ETH.changePct, 0);
  assert.equal(out.DOGE.price, 0.2);
  assert.equal(out.NOTWANTED, undefined);
  assert.equal(out.NOOPEN, undefined);
  assert.deepEqual(parseKrakenTickers('{', ['BTC']), {});
});

test('fetchCryptoAltQuotes：先 Binance.US，剩的才问 Kraken；拿到的进缓存不再重复请求', async () => {
  const orig = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes('api.binance.us')) {
        return { ok: true, text: async () => JSON.stringify([{ symbol: 'QAAUSDT', lastPrice: '83000', prevClosePrice: '82000', priceChangePercent: '1.22' }]) };
      }
      if (String(url).includes('api.kraken.com')) {
        return { ok: true, text: async () => JSON.stringify({ error: [], result: { QBBUSD: { c: ['120.5', '1'], o: '119' } } }) };
      }
      return { ok: false, status: 404, text: async () => '' };
    };

    // 用"只在本用例出现"的代码，避免模块级缓存被别的用例污染
    const first = await fetchCryptoAltQuotes(['QAA', 'QBB', 'QCC']);
    assert.equal(first.QAA.source, 'binanceus');
    assert.equal(first.QBB.source, 'kraken');
    assert.equal(first.QCC, undefined, '两家都没有的币不编数据');
    assert.equal(calls.filter((u) => u.includes('binance.us')).length, 1);
    // Kraken 只该被问"Binance.US 没给的那两个"
    const krakenCall = calls.find((u) => u.includes('api.kraken.com'));
    assert.ok(krakenCall.includes('QBBUSD') && krakenCall.includes('QCCUSD'));
    assert.ok(!krakenCall.includes('QAAUSD'), 'Binance.US 已经给了 QAA，不该再问 Kraken');

    calls.length = 0;
    const second = await fetchCryptoAltQuotes(['QAA', 'QBB', 'QCC']);
    assert.equal(second.QAA.price, 83000);
    assert.equal(second.QBB.price, 120.5);
    // QAA / QBB 已缓存 → 这一轮只该为"仍然没有的 QCC"再问一次
    assert.ok(!calls.some((u) => u.includes('QAAUSDT')), '缓存命中的代码不该再请求');
    assert.ok(!calls.some((u) => u.includes('QBBUSD')), '缓存命中的代码不该再请求');
  } finally {
    globalThis.fetch = orig;
  }
});

test('fetchCryptoAltQuotes：Binance.US 挂了也不能影响主源，Kraken 顶上', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('api.binance.us')) throw new Error('boom');
      return { ok: true, text: async () => JSON.stringify({ error: [], result: { QQDDUSD: { c: ['83001', '1'], o: '83000' } } }) };
    };
    const out = await fetchCryptoAltQuotes(['QQDD']);
    assert.equal(out.QQDD.source, 'kraken');
    assert.equal(out.QQDD.price, 83001);
  } finally {
    globalThis.fetch = orig;
  }
});
