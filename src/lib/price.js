const ALLOWED_SYMBOLS = new Set(['VGT', 'SMH', 'BTC', 'SGOV']);
const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);

// 东方财富市场号：107 = NYSE Arca（VGT/SMH 等 ETF），105 = 纳斯达克
const EASTMONEY_SECID = { VGT: '107.VGT', SMH: '105.SMH', BTC: '107.BTC', SGOV: '107.SGOV' };
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal },
    );
    const data = await response.json();
    await ensureHistory(data, quoteSymbol);
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return {
      status: 502,
      body: { ok: false, error: error.name === 'AbortError' ? 'Timeout' : error.message },
    };
  } finally {
    clearTimeout(timeout);
  }
}
