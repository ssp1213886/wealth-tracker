// 公司总市值代理：上游是 Nasdaq 官方行情接口（免费、无需 key，覆盖美股与 ETF）。
//
// 为什么走自己的 Worker（和图标同一条理由）：
//   ① 前端只跟自己的域名说话，第三方看不到你在关注哪些标的；
//   ② 结果在 isolate 内存里缓存 12 小时，翻页/切标签不再出网；
//   ③ 上游换了、限流了，只改这一处。
//
// 币的"市值"由 CoinLore 补（一个请求覆盖前 100 名，含 HYPE）；
// 还是拿不到的（韩股/OTC 的 SKHYV、COMEX 黄金期货 GC=F、债性 ETF）进 missing，
// 前端显示 "—"，绝不编造一个数字出来。
import { CRYPTO_PAIRS } from './quotes.js';

const MAX_SYMBOLS = 40;
const CAP_TTL = 12 * 60 * 60 * 1000;
/** 拿不到市值的代码缩短缓存（1 小时），免得一次上游抖动被钉死一整天。 */
const MISS_TTL = 60 * 60 * 1000;
/** 代码白名单：1–5 个字母，可带 . 或 -（BRK-B / BRK.B），拒绝一切其它字符（防注入）。 */
const SYMBOL_RE = /^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/;
/**
 * 我们这边"不是公司"的代码：绝不能拿同名美股去顶。
 * GOLD 尤其危险——我们要的是金价（GC=F），而 Nasdaq 上的 GOLD 是 Barrick Gold 这家公司。
 */
const NON_COMPANY_SYMBOLS = new Set(['GOLD', 'GC=F']);
const cache = new Map();
/** 币的市值表（一次请求拿前 100 名）单独缓存，避免每只币都去问一次。 */
let cryptoCaps = null;

/** "5,475,761,000,000" → 5475761000000；"N/A" / 空 / 非正数 → null。 */
function parseCap(value) {
  const number = Number(String(value == null ? '' : value).replace(/[,\s]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** 先按股票查，查不到再按 ETF 查（Nasdaq 同一代码在两种 assetclass 下返回的字段不一样）。 */
async function fetchCap(symbol) {
  for (const assetclass of ['stocks', 'etf']) {
    try {
      const response = await fetch(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${assetclass}`,
        {
          headers: {
            // Nasdaq 对不带浏览器 UA 的请求直接 403
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
      );
      if (!response.ok) continue;
      const data = await response.json();
      const marketCap = data && data.data && data.data.summaryData && data.data.summaryData.MarketCap;
      const cap = parseCap(marketCap && marketCap.value);
      if (cap) return cap;
    } catch (error) {
      // 单只失败不影响整批：换下一个 assetclass，再不行就当这只没有市值
    }
  }
  return null;
}

/** 一次拿到前 100 名币的市值（symbol → USD 市值）。上游挂了就沿用上一次的表。 */
async function fetchCryptoCaps() {
  if (cryptoCaps && Date.now() - cryptoCaps.at < CAP_TTL) return cryptoCaps.caps;
  try {
    const response = await fetch('https://api.coinlore.net/api/tickers/?limit=500', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return cryptoCaps ? cryptoCaps.caps : {};
    const data = await response.json();
    const caps = {};
    (data && Array.isArray(data.data) ? data.data : []).forEach((item) => {
      const symbol = String((item && item.symbol) || '').toUpperCase();
      const cap = parseCap(item && item.market_cap_usd);
      if (symbol && cap && caps[symbol] === undefined) caps[symbol] = cap;
    });
    if (!Object.keys(caps).length) return cryptoCaps ? cryptoCaps.caps : {};
    cryptoCaps = { at: Date.now(), caps };
    return caps;
  } catch (error) {
    return cryptoCaps ? cryptoCaps.caps : {};
  }
}

export async function handleMarketCap(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };

  const symbols = [];
  const skipped = [];
  String(url.searchParams.get('symbols') || '')
    .split(',')
    .forEach((raw) => {
      const symbol = raw.trim().toUpperCase();
      if (!SYMBOL_RE.test(symbol) || symbols.includes(symbol) || skipped.includes(symbol)) return;
      // 不是公司的代码（金价 GOLD 等）直接计入 missing，绝不拿同名美股顶
      if (NON_COMPANY_SYMBOLS.has(symbol)) {
        skipped.push(symbol);
        return;
      }
      if (symbols.length < MAX_SYMBOLS) symbols.push(symbol);
    });
  if (!symbols.length && !skipped.length) return { status: 400, body: { error: 'No valid symbols' } };

  const now = Date.now();
  const caps = {};
  const missing = skipped.slice();
  const stale = [];
  symbols.forEach((symbol) => {
    const hit = cache.get(symbol);
    if (hit && now - hit.at < (hit.cap ? CAP_TTL : MISS_TTL)) {
      if (hit.cap) caps[symbol] = hit.cap;
      else missing.push(symbol);
      return;
    }
    stale.push(symbol);
  });

  const fetched = await Promise.all(stale.map(async (symbol) => [symbol, await fetchCap(symbol)]));
  fetched.forEach(([symbol, cap]) => {
    cache.set(symbol, { at: now, cap });
    if (cap) caps[symbol] = cap;
    else missing.push(symbol);
  });

  // Nasdaq 没有的，看是不是币（只认我们自己的加密白名单，避免和同名美股撞车）
  const maybeCrypto = missing.filter((symbol) => CRYPTO_PAIRS[symbol]);
  if (maybeCrypto.length) {
    const crypto = await fetchCryptoCaps();
    maybeCrypto.forEach((symbol) => {
      const cap = crypto[symbol];
      if (!cap) return;
      caps[symbol] = cap;
      cache.set(symbol, { at: now, cap });
      const at = missing.indexOf(symbol);
      if (at >= 0) missing.splice(at, 1);
    });
  }

  return { status: 200, body: { ok: true, caps, missing, ts: now } };
}
