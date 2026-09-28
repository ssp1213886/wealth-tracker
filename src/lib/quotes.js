// 观察列表与 ETF 前十大构成股的行情代理。
// 股票/ETF：Yahoo chart（server 端拉，绕开浏览器 CORS）；加密：CoinGecko 现货；金价：COMEX 黄金期货（GC=F）。
// 只读公开接口：结果只在 isolate 内存里缓存（行情 60 秒、持仓 6 小时），不落库、不影响同步数据。
import { STATIC_HOLDINGS, HOLDINGS_SYMBOLS } from './holdings-static.js';

// 观察列表(15) + 两张榜单去重后约 28-30 个：上限给到 40，别再把尾部代码丢掉
const MAX_SYMBOLS = 40;
const QUOTE_TTL = 60 * 1000;
const HOLDINGS_TTL = 6 * 60 * 60 * 1000;
const STOCK_RE = /^[A-Z][A-Z0-9.\-=]{0,9}$/;
// 纯代码（字母/数字，不带 . - = 后缀）：按股票查不到时，再用「CODE-USD」当加密现货补查一次
const PLAIN_RE = /^[A-Z0-9]{1,10}$/;
// 用户自己写全的加密交易对（SUI-USD / 1INCH-USD）也当加密现货处理
const CRYPTO_PAIR_RE = /^[A-Z0-9]{1,6}-USD$/;

// 加密：现货代码 → Yahoo 交易对（主源，和股票同一条通路）。
// 关键：这张表里的代码**优先当币**——XRP / LINK / LTC / TRX / ATOM / NEAR 在 Yahoo 上都有同名美股或 ETF，
// 不加 -USD 就会拿到错的标的（XRP 会命中 Bitwise XRP ETF、LTC 会命中 LTC Properties）。
// 只有与知名美股重名的 SUI(太阳社区) / STX(希捷) / DASH(DoorDash) 故意不收录：纯代码仍归股票，要查币写 CODE-USD。
export const CRYPTO_PAIRS = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  BNB: 'BNB-USD',
  HYPE: 'HYPE32196-USD',
  SOL: 'SOL-USD',
  XRP: 'XRP-USD',
  DOGE: 'DOGE-USD',
  ADA: 'ADA-USD',
  AVAX: 'AVAX-USD',
  LINK: 'LINK-USD',
  LTC: 'LTC-USD',
  DOT: 'DOT-USD',
  TRX: 'TRX-USD',
  XLM: 'XLM-USD',
  TON: 'TON-USD',
  BCH: 'BCH-USD',
  ETC: 'ETC-USD',
  UNI: 'UNI-USD',
  ATOM: 'ATOM-USD',
  NEAR: 'NEAR-USD',
  APT: 'APT-USD',
  ARB: 'ARB-USD',
  OP: 'OP-USD',
  FIL: 'FIL-USD',
  HBAR: 'HBAR-USD',
  ICP: 'ICP-USD',
  ALGO: 'ALGO-USD',
  VET: 'VET-USD',
  AAVE: 'AAVE-USD',
  INJ: 'INJ-USD',
  SEI: 'SEI-USD',
  TIA: 'TIA-USD',
  TAO: 'TAO-USD',
  KAS: 'KAS-USD',
  GRT: 'GRT-USD',
  SAND: 'SAND-USD',
  MANA: 'MANA-USD',
  CRV: 'CRV-USD',
  MKR: 'MKR-USD',
  LDO: 'LDO-USD',
  ENS: 'ENS-USD',
  WLD: 'WLD-USD',
  ENA: 'ENA-USD',
  ONDO: 'ONDO-USD',
  JUP: 'JUP-USD',
  BONK: 'BONK-USD',
  WIF: 'WIF-USD',
  PYTH: 'PYTH-USD',
  POL: 'POL-USD',
  RUNE: 'RUNE-USD',
  SHIB: 'SHIB-USD',
  PEPE: 'PEPE-USD',
  CRO: 'CRO-USD',
  ZEC: 'ZEC-USD',
  XMR: 'XMR-USD',
  EOS: 'EOS-USD',
  FLOW: 'FLOW-USD',
  CHZ: 'CHZ-USD',
  GALA: 'GALA-USD',
  IMX: 'IMX-USD',
  AXS: 'AXS-USD',
  THETA: 'THETA-USD',
  RENDER: 'RENDER-USD',
};

// 加密兜底源：CoinGecko（Cloudflare 出口有时会被限流，所以放在 Yahoo 之后）
export const CRYPTO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  HYPE: 'hyperliquid',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  LTC: 'litecoin',
  DOT: 'polkadot',
  TRX: 'tron',
  XLM: 'stellar',
  TON: 'the-open-network',
  BCH: 'bitcoin-cash',
  ETC: 'ethereum-classic',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  FIL: 'filecoin',
  HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer',
  ALGO: 'algorand',
  VET: 'vechain',
  AAVE: 'aave',
  INJ: 'injective-protocol',
  SEI: 'sei-network',
  TIA: 'celestia',
  TAO: 'bittensor',
  KAS: 'kaspa',
  GRT: 'the-graph',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  CRV: 'curve-dao-token',
  MKR: 'maker',
  LDO: 'lido-dao',
  ENS: 'ethereum-name-service',
  WLD: 'worldcoin-wld',
  ENA: 'ethena',
  ONDO: 'ondo-finance',
  JUP: 'jupiter-exchange-solana',
  BONK: 'bonk',
  WIF: 'dogwifcoin',
  PYTH: 'pyth-network',
  POL: 'polygon-ecosystem-token',
  RUNE: 'thorchain',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  CRO: 'crypto-com-chain',
  ZEC: 'zcash',
  XMR: 'monero',
  EOS: 'eos',
  FLOW: 'flow',
  CHZ: 'chiliz',
  GALA: 'gala',
  IMX: 'immutable-x',
  AXS: 'axie-infinity',
  THETA: 'theta-token',
  RENDER: 'render-token',
};

// 金价：Yahoo 的 GC=F（COMEX 黄金期货，美元/盎司）最接近"金价"
export const GOLD_QUOTE = 'GC=F';

// 别名：用户/榜单用的显示代码 → 行情源里真实存在的代码
// （GOLD 是我们给"金价"起的别名；SKHYV 是 VanEck 榜单里的内部简称，韩交所代码是 000660.KS）
export const QUOTE_ALIAS = {
  GOLD: 'GC=F',
  SKHYV: '000660.KS',
  // BTCETF：用户观察列表里的"BTC ETF"行；Yahoo 上这只 ETF 的代码就是 BTC（Grayscale Bitcoin Mini Trust）
  BTCETF: 'BTC',
};

const stockCache = new Map();
const cryptoCache = new Map();
const holdingsCache = new Map();

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/html;q=0.9' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return { ok: true, text: await response.text() };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'Timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStockQuote(symbol) {
  const cached = stockCache.get(symbol);
  if (cached && Date.now() - cached.at < QUOTE_TTL) return cached.quote;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetchJson(url, 6000);
  if (!res.ok) return null;
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    return null;
  }
  const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
  if (!meta) return null;
  const price = num(meta.regularMarketPrice);
  const prev = num(meta.chartPreviousClose) || num(meta.previousClose);
  if (price === null) return null;
  const quote = {
    price,
    prevClose: prev,
    changePct: prev ? Number((((price - prev) / prev) * 100).toFixed(2)) : null,
    name: meta.shortName || meta.longName || symbol,
    // 52 周高点：观察列表详情要用（Yahoo chart 的 meta 里自带）
    hi52: num(meta.fiftyTwoWeekHigh),
    currency: meta.currency || 'USD',
    marketState: meta.marketState || '',
    // 行情时间戳（Yahoo 给的是秒）——前端按它显示"这笔报价是什么时候的"
    asOf: Number(meta.regularMarketTime) ? Number(meta.regularMarketTime) * 1000 : Date.now(),
    source: 'yahoo',
  };
  stockCache.set(symbol, { at: Date.now(), quote });
  return quote;
}

async function fetchCryptoQuotes(ids) {
  const missing = ids.filter((id) => {
    const hit = cryptoCache.get(id);
    return !(hit && Date.now() - hit.at < QUOTE_TTL);
  });
  if (missing.length) {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${missing.join(',')}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetchJson(url, 7000);
    if (res.ok) {
      try {
        const data = JSON.parse(res.text);
        missing.forEach((id) => {
          const row = data && data[id];
          if (row && Number.isFinite(row.usd)) {
            cryptoCache.set(id, {
              at: Date.now(),
              quote: { price: row.usd, prevClose: null, changePct: num(row.usd_24h_change), source: 'coingecko' },
            });
          }
        });
      } catch {
        /* 解析失败：下面按缺失处理 */
      }
    }
  }
  const out = {};
  ids.forEach((id) => {
    const hit = cryptoCache.get(id);
    if (hit) out[id] = hit.quote;
  });
  return out;
}

// Yahoo 的加密对名字形如 "Dogecoin USD" / "ARbit USD"：去掉尾部 USD 给前端当副标题
function cryptoNameOf(sym, quote) {
  const name = String((quote && quote.name) || '').replace(/\s*USD$/i, '').trim();
  return name || sym;
}

export async function handleQuotes(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const raw = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!raw.length) return { status: 400, body: { error: 'Missing symbols' } };
  const wanted = Array.from(new Set(raw)).slice(0, MAX_SYMBOLS);

  // 关键：**按请求的代码回键**。以前 GOLD 会以 GC=F 为键返回，前端按 GOLD 取不到 → 永久显示"—"。
  const stocks = []; // [请求代码, 行情源代码]
  const cryptos = [];
  const plain = []; // 纯代码：先按股票查，查不到再按 CODE-USD 当加密现货补查
  const invalid = [];
  wanted.forEach((sym) => {
    if (CRYPTO_PAIRS[sym]) return cryptos.push(sym);
    const alias = QUOTE_ALIAS[sym];
    // 别名表是我们自己维护的可信映射（如 000660.KS），不套用"股票代码"格式校验
    if (alias) return stocks.push([sym, alias]);
    // 直接写 CODE-USD 也照收（含数字开头的 1INCH-USD）
    if (STOCK_RE.test(sym) || CRYPTO_PAIR_RE.test(sym)) return stocks.push([sym, sym]);
    // 数字开头的纯代码（如 1INCH）不按股票查，但仍允许按加密对补查一次
    if (PLAIN_RE.test(sym)) return plain.push(sym);
    invalid.push(sym);
  });

  // 加密先走 Yahoo 交易对，失败的再走 CoinGecko
  const cryptoPairs = cryptos.map((sym) => [sym, CRYPTO_PAIRS[sym] || null]);
  const [stockPairs, cryptoMap] = await Promise.all([
    Promise.all(stocks.map(async ([sym, lookup]) => [sym, await fetchStockQuote(lookup)])),
    (async () => {
      const viaYahoo = {};
      await Promise.all(cryptoPairs.map(async ([sym, pair]) => {
        if (!pair) return;
        const quote = await fetchStockQuote(pair);
        if (quote) viaYahoo[sym] = quote;
      }));
      const fallbackIds = cryptoPairs.filter(([sym]) => !viaYahoo[sym] && CRYPTO_IDS[sym]).map(([sym]) => CRYPTO_IDS[sym]);
      const viaGecko = fallbackIds.length ? await fetchCryptoQuotes(fallbackIds) : {};
      const out = {};
      cryptoPairs.forEach(([sym]) => {
        if (viaYahoo[sym]) out[sym] = viaYahoo[sym];
        else if (CRYPTO_IDS[sym] && viaGecko[CRYPTO_IDS[sym]]) out[sym] = viaGecko[CRYPTO_IDS[sym]];
      });
      return out;
    })(),
  ]);

  const quotes = {};
  const missing = [];
  // 股票查不到的纯代码，统一按「加密现货」补查一次：用户直接写 XRP / BONK 就行，不需要自己加 -USD
  const retryLater = [];
  const asCrypto = (sym, quote) => ({ ...quote, name: cryptoNameOf(sym, quote), currency: 'USD', marketState: '24/7', crypto: true });
  stockPairs.forEach(([sym, quote]) => {
    if (quote) quotes[sym] = CRYPTO_PAIR_RE.test(sym) ? asCrypto(sym, quote) : quote;
    else if (PLAIN_RE.test(sym)) retryLater.push(sym);
    else missing.push(sym);
  });
  const retried = await Promise.all(plain.concat(retryLater).map(async (sym) => [sym, await fetchStockQuote(sym + '-USD')]));
  retried.forEach(([sym, quote]) => {
    if (quote) quotes[sym] = asCrypto(sym, quote);
    else missing.push(sym);
  });
  cryptos.forEach((sym) => {
    const quote = cryptoMap[sym];
    if (quote) {
      quotes[sym] = asCrypto(sym, quote);
    } else {
      missing.push(sym);
    }
  });

  return {
    status: 200,
    body: { ok: true, quotes, missing, invalid, ts: Date.now() },
  };
}

function parseYahooHoldings(html) {
  const match = html.match(/\\"holdings\\":\[(.*?)\]/);
  if (!match) return null;
  const raw = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const items = [];
  const itemRe = /\{"symbol":"([^"]+)","holdingName":"([^"]*)"[^}]*?"holdingPercent":\{"raw":([\d.eE+-]+)/g;
  let hit;
  while ((hit = itemRe.exec(raw))) {
    const weight = Number(hit[3]);
    if (!Number.isFinite(weight)) continue;
    items.push({ sym: hit[1], name: hit[2], weight: Number((weight * 100).toFixed(2)) });
  }
  if (!items.length) return null;
  return items.sort((a, b) => b.weight - a.weight).slice(0, 10);
}

export async function handleHoldings(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!HOLDINGS_SYMBOLS.includes(symbol)) return { status: 400, body: { error: 'Unsupported symbol' } };

  const cached = holdingsCache.get(symbol);
  if (cached && Date.now() - cached.at < HOLDINGS_TTL) return { status: 200, body: cached.body };

  const fallback = STATIC_HOLDINGS[symbol];
  let list = null;
  const res = await fetchJson(`https://finance.yahoo.com/quote/${symbol}/holdings/`, 8000);
  if (res.ok) list = parseYahooHoldings(res.text);

  const body = {
    ok: true,
    symbol,
    name: fallback.name,
    asOf: list ? null : fallback.asOf,
    source: list ? 'yahoo' : 'static',
    list: list || fallback.list,
    ts: Date.now(),
  };
  // 只有拿到实时数据才缓存；静态兜底每次都重试外部源
  if (list) holdingsCache.set(symbol, { at: Date.now(), body });
  return { status: 200, body };
}
