import { edgeGetJson, edgePutJson } from './edge-cache.js';

const FX_TTL_SECONDS = 30 * 60;
const FX_HISTORY_TTL_SECONDS = 24 * 60 * 60;

export function extractUsdCnyRate(payload) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const meta = result && result.meta;
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = quote && Array.isArray(quote.close) ? quote.close : [];
  let rate = Number(meta && meta.regularMarketPrice);
  if (!(rate > 0)) {
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      const value = Number(closes[i]);
      if (value > 0) { rate = value; break; }
    }
  }
  if (!(rate > 0)) return null;
  return {
    rate: rate,
    asOf: Number(meta && meta.regularMarketTime) > 0
      ? Number(meta.regularMarketTime) * 1000
      : Date.now(),
  };
}

export function extractUsdCnyHistory(payload) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  const timestamps = result && Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = quote && Array.isArray(quote.close) ? quote.close : [];
  const out = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const rate = Number(closes[i]);
    const ts = Number(timestamps[i]);
    if (!(rate > 0) || !(ts > 0)) continue;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), rate: rate });
  }
  return out;
}

export async function handleFx(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
  const base = String(url.searchParams.get('base') || 'USD').toUpperCase();
  const quote = String(url.searchParams.get('quote') || 'CNY').toUpperCase();
  const range = url.searchParams.get('range') === 'max' ? 'max' : '1d';
  if (base !== 'USD' || quote !== 'CNY') {
    return { status: 400, body: { error: 'Only USD/CNY is supported' } };
  }

  const cacheKey = 'fx:usd-cny:v2:' + range;
  const cached = await edgeGetJson(url.origin, cacheKey);
  if (cached) return { status: 200, body: cached };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/CNY%3DX?interval=1d&range=' + range,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal },
    );
    const data = await response.json();
    const extracted = extractUsdCnyRate(data);
    if (!extracted) return { status: 502, body: { ok: false, error: 'USD/CNY quote unavailable' } };
    const body = { ok: true, base: base, quote: quote, rate: extracted.rate, asOf: extracted.asOf };
    if (range === 'max') body.history = extractUsdCnyHistory(data);
    await edgePutJson(url.origin, cacheKey, body, range === 'max' ? FX_HISTORY_TTL_SECONDS : FX_TTL_SECONDS);
    return { status: 200, body: body };
  } catch (error) {
    return {
      status: 502,
      body: { ok: false, error: error.name === 'AbortError' ? 'Timeout' : error.message },
    };
  } finally {
    clearTimeout(timeout);
  }
}
