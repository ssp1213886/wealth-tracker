const ALLOWED_SYMBOLS = new Set(['VGT', 'SMH', 'BTC', 'SGOV']);
const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);

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
