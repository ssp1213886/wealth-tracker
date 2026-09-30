// 公司总市值代理：股票/ETF 走 Nasdaq 官方接口（免费、无需 key），币走 CoinLore（一次拿全表）。
//
// ⚠️ 这个文件在 v273 重做过一次，原因是上一版让首屏卡了 20 秒，三条经验写在这里：
//   ① Nasdaq 只能按单个代码查。一次 29 只 = 最多 48 个子请求，而 Cloudflare 单次请求的
//      并发连接与子请求数都有上限，实测整批要 20 秒。现在一次最多真正查 MAX_LOOKUPS 只，
//      超出的代码放进 deferred 交给前端下一轮 —— 请求永远不会挂在天上。
//   ② 缓存必须两层：isolate 内存（毫秒）→ Cloudflare 边缘缓存（跨 isolate、跨冷启动）。
//      只放内存的话，isolate 一被回收就全部回源，等于每次都冷启动。
//   ③ 整批 DEADLINE_MS 硬超时：到点先返回已经拿到的部分，慢的那几只留到下一轮；
//      但它们的任务不取消 —— 完成后照常写缓存，下一轮直接命中。
//
// 拿不到的代码（韩股/OTC 的 SKHYV、金价 GOLD、期货 GC=F）进 missing，前端显示「—」，绝不编数字。
import { CRYPTO_PAIRS } from './quotes.js';

/** 单次请求最多接受多少代码（和 /api/quotes 对齐）。 */
const MAX_SYMBOLS = 40;
/** 单次最多真正向上游查几只：一只最多 2 个子请求，压在 Cloudflare 的上限以内。 */
const MAX_LOOKUPS = 12;

/**
 * 批量主源：stockanalysis 的「市值最大 500 家」榜，**一个请求拿 500 条的市值**。
 *
 * 为什么要它：Nasdaq 只能按代码单查，实测单只 200~850ms，12 只并发要 1.7s 以上，
 * 29 只就是 20 秒。换成这张表之后，我们关注的美股几乎全在里面，一次请求全部搞定；
 * 表里没有的（ETF、小盘、币）再走 Nasdaq / CoinLore 兜底。
 */
const LIST_URL = 'https://stockanalysis.com/list/biggest-companies/';
const LIST_TTL = 24 * 60 * 60 * 1000;
const LIST_TTL_SECONDS = 24 * 60 * 60;
const LIST_RE = /<td class="sym [^"]*">[\s\S]*?<a href="[/]stocks[/][^"]*">([A-Z0-9.\-]+)<\/a>[\s\S]{0,20}?<\/td>[\s\S]*?<td class="slw [^"]*">([^<]*)<\/td>[\s\S]*?<td class="[^"]*">([\d.]+)([TBMK])<\/td>/g;
const LIST_UNITS = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 };
/**
 * ETF 规模（AUM）：stockanalysis 的 ETF 页上写作 "Assets $155.48B"。
 * 为什么不用 Nasdaq：它给 ETF 的 MarketCap 实测是错的（VGT 只报 6.97B，实际约 155B）。
 */
const ETF_PAGE_URL = (symbol) => `https://stockanalysis.com/etf/${symbol.toLowerCase()}/`;
// 实测 "Assets" 到金额之间隔着 132 个字符的属性文本，窗口给足
const ETF_ASSETS_RE = /Assets[\s\S]{0,400}?\$([\d.]+)([TBMK])/;
const CAP_TTL = 24 * 60 * 60 * 1000;
/** 拿不到市值的代码缩短缓存（1 小时），免得一次上游抖动被钉死一整天。 */
const MISS_TTL = 60 * 60 * 1000;
/** 整批的硬超时：到点先返回已有的部分，剩下的进 deferred。 */
const DEADLINE_MS = 5000;
/** 边缘缓存时长（秒）；拿不到市值的条目短一些。 */
const EDGE_TTL_SECONDS = 24 * 60 * 60;
const EDGE_MISS_TTL_SECONDS = 60 * 60;
/** 代码白名单：1–5 个字母，可带 . 或 -（BRK-B / BRK.B），拒绝一切其它字符（防注入）。 */
const SYMBOL_RE = /^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/;
/** Nasdaq 与 stockanalysis 对通用 UA 都会 403，必须报一个像浏览器的 UA。 */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
/**
 * 我们这边"不是公司"的代码：绝不能拿同名美股去顶。
 * GOLD 尤其危险——我们要的是金价（GC=F），而 Nasdaq 上的 GOLD 是 Barrick Gold 这家公司。
 */
const NON_COMPANY_SYMBOLS = new Set(['GOLD', 'GC=F']);
const cache = new Map();
/** 币的市值表（一次请求拿前 100 名）单独缓存，避免每只币都去问一次。 */
let cryptoCaps = null;
/** 边缘缓存：Node（单测）里没有 caches.default，会自动降级成只用内存。 */
let edgeCache = null;
try {
  edgeCache = caches.default;
} catch (error) {
  edgeCache = null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** 市值大表（内存层）。 */
let biggestList = null;

/** "5,475,761,000,000" → 5475761000000；"N/A" / 空 / 非正数 → null。 */
function parseCap(value) {
  if (typeof value === 'string' && /[TBMK]$/i.test(value)) {
    const unit = LIST_UNITS[value.slice(-1).toUpperCase()];
    const size = Number(value.slice(0, -1).replace(/[,\s]/g, ''));
    return Number.isFinite(size) && size > 0 && unit ? size * unit : null;
  }
  const number = Number(String(value == null ? '' : value).replace(/[,\s]/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** 解析「市值最大 500 家」页面：symbol → 市值。 */
function parseBiggestList(html) {
  const caps = {};
  let hit;
  LIST_RE.lastIndex = 0;
  while ((hit = LIST_RE.exec(html))) {
    const symbol = String(hit[1]).toUpperCase();
    const cap = parseCap(hit[3] + hit[4]);
    if (symbol && cap && caps[symbol] === undefined) caps[symbol] = cap;
  }
  return Object.keys(caps).length >= 100 ? caps : null;
}

/**
 * 取市值大表：内存 → 边缘缓存 → 上游。
 * 拿不到就直接放弃（返回空表），绝不让整批请求被它拖死。
 */
async function fetchBiggestList(origin, budgetMs) {
  if (biggestList && Date.now() - biggestList.at < LIST_TTL) return biggestList.caps;
  const key = edgeKey(origin, '__LIST__');
  try {
    const cached = edgeCache ? await edgeCache.match(key) : null;
    if (cached) {
      const caps = JSON.parse(await cached.text());
      if (caps && Object.keys(caps).length >= 100) {
        biggestList = { at: Date.now(), caps };
        return caps;
      }
    }
  } catch (error) {
    // 缓存读失败就当没命中
  }
  try {
    // 不只用 AbortSignal：万一上游把连接吊着不放，这里也必须在预算内脱身
    const response = await Promise.race([
      fetch(LIST_URL, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/json;q=0.9' },
        signal: AbortSignal.timeout(Math.max(2000, budgetMs)),
      }),
      sleep(Math.max(2000, budgetMs)).then(() => null),
    ]);
    if (!response) return biggestList ? biggestList.caps : {};
    if (!response.ok) return {};
    const caps = parseBiggestList(await response.text());
    if (!caps) return {};
    biggestList = { at: Date.now(), caps };
    if (edgeCache) {
      try {
        await edgeCache.put(key, new Response(JSON.stringify(caps), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + LIST_TTL_SECONDS },
        }));
      } catch (error) {
        // 写缓存失败不影响本次返回
      }
    }
    return caps;
  } catch (error) {
    return biggestList ? biggestList.caps : {};
  }
}

/** ETF 规模：抓 ETF 页上的 "Assets $xxx"。不是 ETF（或页面拿不到）就返回 null。 */
async function fetchEtfAssets(symbol) {
  try {
    const response = await fetch(ETF_PAGE_URL(symbol), {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/json;q=0.9' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const match = (await response.text()).match(ETF_ASSETS_RE);
    return match ? parseCap(match[1] + match[2]) : null;
  } catch (error) {
    return null;
  }
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
            'User-Agent': BROWSER_UA,
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          // 单只只给 2 秒：Nasdaq 一旦开始限流会把连接吊着不放，
          // 拖长了整轮就只剩超时，其它代码也跟着一起 deferred。
          signal: AbortSignal.timeout(2000),
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

/** 边缘缓存按「单个代码」存：一次只补缺的那几只，命中就是毫秒级。 */
function edgeKey(origin, symbol) {
  return new Request(new URL('/api/marketcap?symbol=' + encodeURIComponent(symbol), origin).toString(), { method: 'GET' });
}

/** 命中返回数字；缓存里明确记着「没有」返回 null；没缓存返回 undefined。 */
async function edgeGet(origin, symbol) {
  if (!edgeCache) return undefined;
  try {
    const hit = await edgeCache.match(edgeKey(origin, symbol));
    if (!hit) return undefined;
    const text = (await hit.text()).trim();
    if (text === 'null') return null;
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch (error) {
    return undefined;
  }
}

async function edgePut(origin, symbol, cap) {
  if (!edgeCache) return;
  try {
    const ttl = cap ? EDGE_TTL_SECONDS : EDGE_MISS_TTL_SECONDS;
    await edgeCache.put(edgeKey(origin, symbol), new Response(cap ? String(cap) : 'null', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttl },
    }));
  } catch (error) {
    // 写缓存失败不影响本次返回
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

  const origin = url.origin;
  const now = Date.now();
  const caps = {};
  const missing = skipped.slice();
  const deferred = [];
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

  // 第二层：边缘缓存（跨 isolate、跨冷启动都命中）
  const edgeHits = await Promise.all(stale.map((symbol) => edgeGet(origin, symbol)));
  const targets = [];
  stale.forEach((symbol, index) => {
    const cap = edgeHits[index];
    if (cap === undefined) {
      targets.push(symbol);
      return;
    }
    cache.set(symbol, { at: now, cap });
    if (cap) caps[symbol] = cap;
    else missing.push(symbol);
  });

  // ③ 先用「市值最大 500 家」那张大表一次覆盖掉绝大多数美股（一个请求搞定）
  const deadlineAt = Date.now() + DEADLINE_MS;
  const rest = [];
  if (targets.length) {
    const list = await fetchBiggestList(origin, Math.min(3500, Math.max(1500, deadlineAt - Date.now())));
    targets.forEach((symbol) => {
      const cap = list[symbol];
      if (!cap) {
        rest.push(symbol);
        return;
      }
      cache.set(symbol, { at: Date.now(), cap });
      caps[symbol] = cap;
      edgePut(origin, symbol, cap);
    });
  }

  // ④ 大表里没有的（ETF、小盘、币）再按代码查；一次最多 MAX_LOOKUPS 只，多出来的交给前端下一轮
  const lookup = rest.slice(0, MAX_LOOKUPS);
  rest.slice(MAX_LOOKUPS).forEach((symbol) => deferred.push(symbol));

  const settled = new Map();
  if (lookup.length) {
    const remember = async (symbol, cap) => {
      cache.set(symbol, { at: Date.now(), cap });
      await edgePut(origin, symbol, cap);
      settled.set(symbol, cap);
    };
    // 币必须走 CoinLore，绝不能先问 Nasdaq —— ETH 在 Nasdaq 上是 Ethan Allen 家具公司（$1.2B），
    // 会把以太坊的市值显示成一家沙发厂。这和行情模块"白名单里的代码优先当币"是同一条规则。
    const cryptos = lookup.filter((symbol) => CRYPTO_PAIRS[symbol]);
    const tasks = [];
    if (cryptos.length) {
      tasks.push((async () => {
        const table = await fetchCryptoCaps();
        await Promise.all(cryptos.map((symbol) => remember(symbol, table[symbol] || null)));
      })());
    }
    // 其余代码：先试 ETF 页（Nasdaq 对 ETF 给的市值不准），再退到 Nasdaq 单查。
    // 单个任务自己负责把结果写进缓存 —— 就算整批已经超时返回，它跑完的那一份下一轮直接命中。
    lookup
      .filter((symbol) => !CRYPTO_PAIRS[symbol])
      .forEach((symbol) => {
        tasks.push((async () => {
          const etfCap = await fetchEtfAssets(symbol);
          await remember(symbol, etfCap || (await fetchCap(symbol)));
        })());
      });
    // 硬超时：到点就带着"已完成的部分"返回；没跑完的任务继续跑完并写缓存，下一轮直接命中
    await Promise.race([Promise.allSettled(tasks), sleep(Math.max(0, deadlineAt - Date.now()))]);
  }

  lookup.forEach((symbol) => {
    if (!settled.has(symbol)) {
      deferred.push(symbol);
      return;
    }
    const cap = settled.get(symbol);
    if (cap) caps[symbol] = cap;
    else missing.push(symbol);
  });

  return { status: 200, body: { ok: true, caps, missing, deferred, ts: Date.now() } };
}
