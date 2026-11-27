import { edgeGetJson, edgePutJson } from './edge-cache.js';

// IBIT/SGOV 保留一个发布周期，给尚未自动更新的旧客户端宽限；新核心仓只使用 QQQM/VGT/SMH。
const ALLOWED_SYMBOLS = new Set(['QQQM', 'VGT', 'SMH', 'IBIT', 'SGOV']);
const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '3y', '5y', '10y', 'ytd', 'max']);

/** 实时价 60 秒；近期历史必须覆盖最新收盘，远期为控制回源量保留长缓存。 */
const LIVE_TTL_SECONDS = 60;
const SHORT_HISTORY_TTL_SECONDS = 15 * 60;
const LONG_HISTORY_TTL_SECONDS = 24 * 60 * 60;
const HISTORY_RANGES = new Set(['1y', '2y', '3y', '5y', '10y', 'ytd', 'max']);
const SHORT_HISTORY_RANGES = new Set(['1y', '2y', '3y', 'ytd']);
const PRICE_CACHE_VERSION = 'v4';

/** 近期区间的缓存时长；其它历史区间维持一天。 */
export function priceHistoryTtlSeconds(range) {
  if (SHORT_HISTORY_RANGES.has(range)) return SHORT_HISTORY_TTL_SECONDS;
  if (HISTORY_RANGES.has(range)) return LONG_HISTORY_TTL_SECONDS;
  return LIVE_TTL_SECONDS;
}

/** 版本化缓存键：改 TTL 时同时淘汰已经写入的旧缓存。 */
export function priceCacheKey(symbol, range) {
  return 'price:' + PRICE_CACHE_VERSION + ':' + String(symbol).toUpperCase() + '|' + range;
}

/**
 * Yahoo 偶尔会把最新交易日的 close 留空，但同一响应里的 regularMarketPrice
 * 已经是该日收盘价。写入缓存前补齐，避免前端过滤空值时退回上一交易日。
 */
export function mergeLatestQuote(data) {
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const meta = result && result.meta;
  if (!quote || !meta || !Array.isArray(result.timestamp) || !Array.isArray(quote.close)) return data;

  const price = Number(meta.regularMarketPrice);
  const marketTs = Number(meta.regularMarketTime);
  if (!(price > 0) || !(marketTs > 0)) return data;

  let last = result.timestamp.length - 1;
  while (last >= 0 && !(Number(result.timestamp[last]) > 0)) last -= 1;
  if (last < 0) return data;

  const lastTs = Number(result.timestamp[last]);
  const lastDay = new Date(lastTs * 1000).toISOString().slice(0, 10);
  const marketDay = new Date(marketTs * 1000).toISOString().slice(0, 10);
  if (marketDay === lastDay) {
    result.timestamp[last] = marketTs;
    quote.close[last] = price;
    return data;
  }
  if (marketDay < lastDay) return data;

  result.timestamp.push(marketTs);
  Object.keys(quote).forEach(function (key) {
    if (Array.isArray(quote[key])) quote[key].push(key === 'close' ? price : null);
  });
  return data;
}

/**
 * Yahoo 对 range=max 会自动降采样到周线。近期月度/年度计算需要日线精度：
 * 用近 10 年日线覆盖 max 的同日期段，只把更早的周线作为旧历史补充。
 */
export function mergeHistoricalDaily(dailyPayload, legacyPayload) {
  const dailyResult = dailyPayload && dailyPayload.chart && dailyPayload.chart.result && dailyPayload.chart.result[0];
  const legacyResult = legacyPayload && legacyPayload.chart && legacyPayload.chart.result && legacyPayload.chart.result[0];
  if (!dailyResult) return legacyPayload;
  if (!legacyResult) return dailyPayload;
  const dailyTimes = Array.isArray(dailyResult.timestamp) ? dailyResult.timestamp : [];
  /* v442：日线拿不到（或被降采样）时绝不能冒充日线。
     以前这里无条件写 dataGranularity:'1d'，趋势层就会用周线去算 50/200 日均线。 */
  const dailyGranularity = String((dailyResult.meta && dailyResult.meta.dataGranularity) || '');
  const dailyUsable = dailyTimes.length > 0 && (dailyGranularity === '' || dailyGranularity === '1d');
  if (!dailyUsable) return legacyResult;
  const dailyCloses = dailyResult.indicators && dailyResult.indicators.quote && dailyResult.indicators.quote[0]
    ? dailyResult.indicators.quote[0].close || []
    : [];
  const legacyTimes = Array.isArray(legacyResult.timestamp) ? legacyResult.timestamp : [];
  const legacyCloses = legacyResult.indicators && legacyResult.indicators.quote && legacyResult.indicators.quote[0]
    ? legacyResult.indicators.quote[0].close || []
    : [];
  const dailyStart = Number(dailyTimes[0]) || Infinity;
  const timestamp = [];
  const close = [];
  legacyTimes.forEach(function (value, index) {
    const ts = Number(value);
    const price = Number(legacyCloses[index]);
    if (ts > 0 && ts < dailyStart && price > 0) {
      timestamp.push(ts);
      close.push(price);
    }
  });
  dailyTimes.forEach(function (value, index) {
    const ts = Number(value);
    const price = Number(dailyCloses[index]);
    if (ts > 0 && price > 0) {
      timestamp.push(ts);
      close.push(price);
    }
  });
  return {
    chart: {
      result: [{
        meta: Object.assign({}, dailyResult.meta || {}, {
          range: 'max',
          dataGranularity: '1d',
          legacyBeforeDaily: timestamp.length > dailyTimes.length ? '1wk' : '',
        }),
        timestamp: timestamp,
        indicators: { quote: [{ close: close }] },
      }],
      error: null,
    },
  };
}

// 东方财富市场号：107 = NYSE Arca（VGT/SMH 等 ETF），105 = 纳斯达克
// IBIT 在 NYSE Arca（市场号 107），与 VGT 同市场
const EASTMONEY_SECID = { QQQM: '105.QQQM', VGT: '107.VGT', SMH: '105.SMH', IBIT: '107.IBIT', SGOV: '107.SGOV' };
const EASTMONEY_TTL = 10 * 60 * 1000;
const eastmoneyCache = new Map();

// Yahoo 有时只返回实时快照、不带日线序列，这里用东方财富的日 K 补齐走势
async function fetchEastmoneyCloses(symbol) {
  const secid = EASTMONEY_SECID[symbol];
  if (!secid) return [];
  const cached = eastmoneyCache.get(secid);
  if (cached && Date.now() - cached.at < EASTMONEY_TTL) return cached.closes;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2&fields2=f51,f53&klt=101&fqt=1&lmt=30&end=20500101`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal },
    );
    const data = await response.json();
    const closes = String((data && data.data && (data.data.klines || []).join('|')) || '')
      .split('|')
      .map((line) => Number(line.split(',')[1]))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(-20);
    if (closes.length >= 5) eastmoneyCache.set(secid, { at: Date.now(), closes });
    return closes;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureHistory(data, symbol) {
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) return;
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const existing = (quote && Array.isArray(quote.close) ? quote.close : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (existing.length >= 10) return;
  const closes = await fetchEastmoneyCloses(symbol);
  if (closes.length < 5) return;
  result.indicators = { quote: [{ close: closes }] };
}

export async function handlePrice(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const symbol = url.searchParams.get('symbol');
  if (!symbol) return { status: 400, body: { error: 'Missing symbol' } };
  if (!/^[A-Z0-9.\-^]{1,12}$/i.test(symbol)) return { status: 400, body: { error: 'Invalid symbol' } };

  const quoteSymbol = symbol.toUpperCase();
  if (!ALLOWED_SYMBOLS.has(quoteSymbol)) return { status: 400, body: { error: 'Unsupported symbol' } };

  const range = ALLOWED_RANGES.has(url.searchParams.get('range'))
    ? url.searchParams.get('range')
    : '1d';

  // 这一版以前完全没缓存：实测同一个 URL 连打两次是 1127ms / 1974ms，
  // 而 App 每次打开要打 10~14 次 → 首屏价格全靠现场回源。现在压一层边缘缓存。
  const ttl = priceHistoryTtlSeconds(range);
  const edgeKey = priceCacheKey(quoteSymbol, range);
  const cached = await edgeGetJson(url.origin, edgeKey);
  if (cached) return { status: 200, body: cached };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchRange = async function (nextRange) {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?interval=1d&range=${nextRange}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal },
      );
      if (!response.ok) throw new Error('Yahoo HTTP ' + response.status);
      return response.json();
    };
    let data;
    if (range === 'max') {
      const results = await Promise.all([
        fetchRange('10y').catch(function () { return null; }),
        fetchRange('max').catch(function () { return null; }),
      ]);
      if (!results[0] && !results[1]) throw new Error('Yahoo unavailable');
      data = mergeHistoricalDaily(results[0], results[1]);
    } else {
      data = await fetchRange(range);
    }
    await ensureHistory(data, quoteSymbol);
    mergeLatestQuote(data);
    const body = { ok: true, data };
    // 必须 await：Worker 一旦返回响应，没跑完的异步写入会被取消（缓存就白写了）
    await edgePutJson(url.origin, edgeKey, body, ttl);
    return { status: 200, body };
  } catch (error) {
    return {
      status: 502,
      body: { ok: false, error: error.name === 'AbortError' ? 'Timeout' : error.message },
    };
  } finally {
    clearTimeout(timeout);
  }
}
