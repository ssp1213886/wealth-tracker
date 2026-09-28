// 观察列表与 ETF 前十大构成股的行情代理。
// 股票/ETF：Yahoo chart（server 端拉，绕开浏览器 CORS）；加密：CoinGecko 现货；金价：COMEX 黄金期货（GC=F）。
// 只读公开接口：结果只在 isolate 内存里缓存（行情 60 秒、持仓 6 小时），不落库、不影响同步数据。
import { STATIC_HOLDINGS, HOLDINGS_SYMBOLS } from './holdings-static.js';

const MAX_SYMBOLS = 20;
const QUOTE_TTL = 60 * 1000;
const HOLDINGS_TTL = 6 * 60 * 60 * 1000;
const STOCK_RE = /^[A-Z][A-Z0-9.\-=]{0,9}$/;

// 加密：用户指定的现货代码 → CoinGecko id
export const CRYPTO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  HYPE: 'hyperliquid',
  SOL: 'solana',
};

// 金价：Yahoo 的 GC=F（COMEX 黄金期货，美元/盎司）最接近"金价"
export const GOLD_QUOTE = 'GC=F';

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
    currency: meta.currency || 'USD',
    marketState: meta.marketState || '',
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

export async function handleQuotes(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const raw = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!raw.length) return { status: 400, body: { error: 'Missing symbols' } };
  const wanted = Array.from(new Set(raw)).slice(0, MAX_SYMBOLS);

  const stocks = [];
  const cryptos = [];
  const invalid = [];
  wanted.forEach((sym) => {
    if (CRYPTO_IDS[sym]) return cryptos.push(sym);
    if (sym === 'GOLD') return stocks.push(GOLD_QUOTE);
    if (STOCK_RE.test(sym)) return stocks.push(sym);
    invalid.push(sym);
  });

  const cryptoIds = cryptos.map((sym) => CRYPTO_IDS[sym]);
  const [stockPairs, cryptoMap] = await Promise.all([
    Promise.all(stocks.map(async (sym) => [sym, await fetchStockQuote(sym)])),
    fetchCryptoQuotes(cryptoIds),
  ]);

  const quotes = {};
  const missing = [];
  stockPairs.forEach(([sym, quote]) => {
    if (quote) quotes[sym] = quote;
    else missing.push(sym);
  });
  cryptos.forEach((sym, index) => {
    const quote = cryptoMap[cryptoIds[index]];
    if (quote) {
      quotes[sym] = { ...quote, name: sym + ' 现货', currency: 'USD', marketState: '24/7' };
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
