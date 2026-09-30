// 观察列表与 ETF 前十大构成股的行情代理。
// 股票/ETF：Yahoo chart（server 端拉，绕开浏览器 CORS）；加密：CoinGecko 现货；金价：COMEX 黄金期货（GC=F）。
// 只读公开接口：结果只在 isolate 内存里缓存（行情 60 秒、持仓 6 小时），不落库、不影响同步数据。
import { STATIC_HOLDINGS, HOLDINGS_SYMBOLS } from './holdings-static.js';
import { edgeGetJson, edgePutJson } from './edge-cache.js';

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

async function fetchJson(url, timeoutMs, extraHeaders) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/html;q=0.9' }, extraHeaders || {}),
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

  // 边缘缓存：同一批代码 60 秒内直接复用（isolate 内存一回收就全丢，靠它兜住冷启动）
  const quoteKey = 'quotes:' + wanted.slice().sort().join(',');
  const cachedQuotes = await edgeGetJson(url.origin, quoteKey);
  if (cachedQuotes) return { status: 200, body: cachedQuotes };

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

  const body = { ok: true, quotes, missing, invalid, ts: Date.now() };
  // 必须 await：Worker 返回后未完成的异步写入会被取消
  await edgePutJson(url.origin, quoteKey, body, QUOTE_TTL / 1000);
  return { status: 200, body };
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

/** 上游榜单代码 → 我们内部的代码（stockanalysis 用韩股代码 SKHY，我们沿用 Yahoo 的 ADR 代码 SKHYV）。 */
/** 有的站点（stockanalysis）对通用 UA 直接 403，必须报一个像浏览器的 UA。 */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HOLDING_SYM_ALIAS = { SKHY: 'SKHYV' };

/** HTML 实体：上游的公司名里偶有 &amp; 这类字符，进 JSON 前先还原。 */
function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'");
}

/**
 * stockanalysis.com 的 ETF 持仓页（服务端渲染，含完整持仓表）。
 * 样本：<td class="rrpad svelte-x">7</td>…<a href="/stocks/skhy/" >SKHY</a>…
 *       <td class="shr svelte-x">SK hynix Inc.</td>…<td class="svelte-x">4.59%</td>
 * 页面里还有 "as of Sep 26, 2026" 这样的日期，一并带出来给前端显示。
 */
function parseStockanalysisHoldings(html) {
  const itemRe = /<td class="rrpad [^"]*">(\d+)<\/td>[\s\S]*?<a href="\/stocks\/[^"]*"\s*>([A-Z0-9.\-]+)<\/a>[\s\S]*?<td class="shr [^"]*">([^<]*)<\/td>[\s\S]*?<td[^>]*>([\d.]+)%<\/td>/g;
  const items = [];
  let hit;
  while ((hit = itemRe.exec(html))) {
    const weight = Number(hit[4]);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const raw = String(hit[2]).toUpperCase();
    items.push({ sym: HOLDING_SYM_ALIAS[raw] || raw, name: decodeEntities(hit[3]).trim(), weight });
  }
  if (!items.length) return null;
  // 页面上是 " As of Sep 26, 2026 "（首字母大写）
  const dateMatch = html.match(/as of ([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  return { list: items.sort((a, b) => b.weight - a.weight).slice(0, 10), asOf: dateMatch ? dateMatch[1] : null };
}

/**
 * 第一道防线：内部不变量。拿到的必须"像一份真的前十大"（降序、无重复、合计落在合理区间），
 * 拦的是解析错位、只抄到零星几行这类明显坏掉的情况。
 */
export function validHoldingList(list) {
  if (!Array.isArray(list) || list.length < 5 || list.length > 10) return false;
  const seen = new Set();
  let previous = Infinity;
  let sum = 0;
  for (const item of list) {
    const weight = Number(item && item.weight);
    if (!item || !item.sym || !Number.isFinite(weight) || weight <= 0 || weight >= 100) return false;
    // 榜单本来就按权重降序：出现回升说明解析错位，宁可不显示
    if (weight > previous + 1e-9) return false;
    if (seen.has(item.sym)) return false;
    seen.add(item.sym);
    previous = weight;
    sum += weight;
  }
  // 前十大合计落在 30%~95%：太低＝只抄到零星几行，太高＝把整个组合都塞进来了
  return sum >= 30 && sum <= 95;
}

/**
 * 第二道防线：与手工维护的官方榜做「集合一致性」比对，前十大至少 7 个代码对得上才算可信。
 *
 * 这道才是真正拦住 Yahoo 那份 SMH 榜单的：它内部完全自洽、能过不变量，但和 VanEck 官方榜
 * 只对得上 6 个（缺 INTC/SKHY/TXN/MRVL/KLAC，还把 NVDA 权重抬高了 3.5 个点）。
 * 对了 7 个以上说明只是权重随行情漂移，对不上说明拿到的根本不是同一份名单 —— 宁可用手工榜。
 */
export function agreesWithStatic(list, symbol) {
  const known = STATIC_HOLDINGS[symbol];
  if (!known || !Array.isArray(known.list) || !known.list.length) return true;
  const official = new Set(known.list.map((item) => item.sym));
  const hit = (Array.isArray(list) ? list : []).filter((item) => item && official.has(item.sym)).length;
  return hit >= 7;
}

export async function handleHoldings(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!HOLDINGS_SYMBOLS.includes(symbol)) return { status: 400, body: { error: 'Unsupported symbol' } };

  const cached = holdingsCache.get(symbol);
  if (cached && Date.now() - cached.at < HOLDINGS_TTL) return { status: 200, body: cached.body };

  // 边缘缓存：榜单一天最多变一次，冷启动不该再去抓一遍上游
  const holdingsKey = 'holdings:' + symbol;
  const cachedEdge = await edgeGetJson(url.origin, holdingsKey);
  if (cachedEdge) {
    holdingsCache.set(symbol, { at: Date.now(), body: cachedEdge });
    return { status: 200, body: cachedEdge };
  }

  const fallback = STATIC_HOLDINGS[symbol];
  let list = null;
  let asOf = null;
  let source = 'static';

  // ① 主源：stockanalysis.com。它的前十大和 VanEck/Vanguard 官方榜逐个吻合
  //    （SMH 的 SKHY 4.59%、INTC 4.94% 都在），而 VanEck 官网有 cookie 同意页、
  //    服务端抓取会 302 死循环，只能退而用这份交叉校验过的镜像。
  const remote = await fetchJson(`https://stockanalysis.com/etf/${symbol.toLowerCase()}/holdings/`, 9000, { 'User-Agent': BROWSER_UA });
  if (remote.ok) {
    const parsed = parseStockanalysisHoldings(remote.text);
    if (parsed && validHoldingList(parsed.list) && agreesWithStatic(parsed.list, symbol)) {
      list = parsed.list;
      asOf = parsed.asOf;
      source = 'stockanalysis';
    }
  }

  // ② 兜底：Yahoo 只留给 VGT。SMH 的 Yahoo 榜单实测是错的，宁可回落到手工抄的官方榜。
  if (!list && symbol === 'VGT') {
    const res = await fetchJson(`https://finance.yahoo.com/quote/${symbol}/holdings/`, 8000);
    const parsed = res.ok ? parseYahooHoldings(res.text) : null;
    if (validHoldingList(parsed) && agreesWithStatic(parsed, symbol)) {
      list = parsed;
      source = 'yahoo';
    }
  }

  // ③ 手工维护的官方榜（每季度核对，带 asOf）
  if (!list) {
    list = fallback.list;
    source = 'static';
  }

  const body = {
    ok: true,
    symbol,
    name: fallback.name,
    asOf: source === 'static' ? fallback.asOf : asOf,
    source,
    list,
    ts: Date.now(),
  };
  // 只有拿到外部实时数据才缓存；静态兜底每次都重试外部源
  if (source !== 'static') {
    holdingsCache.set(symbol, { at: Date.now(), body });
    await edgePutJson(url.origin, holdingsKey, body, HOLDINGS_TTL / 1000);
  }
  return { status: 200, body };
}
