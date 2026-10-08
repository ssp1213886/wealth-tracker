// 派息历史代理：Yahoo chart 的 events=div（免费、无需认证）。
//
// 只服务于一件事：**推下一次除息日**。公开接口不提供"未来的除息日"（公告一般提前 2-4 周才出），
// 所以客户端按历史派息频率外推 —— 服务端只负责把干净的历史记录送过去。
import { edgeGetJson, edgePutJson } from './edge-cache.js';

const ALLOWED_SYMBOLS = new Set(['VGT', 'SMH']);
const CACHE_TTL_SECONDS = 12 * 60 * 60;   // 派息记录一天最多变一次，长缓存无风险

/** GET /api/dividends?sym=VGT → { ok, sym, dividends:[{date, amount}] }（按日期升序）。 */
export async function handleDividends(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { ok: false, error: 'Method not allowed' } };
  const sym = String(url.searchParams.get('sym') || '').toUpperCase();
  if (!ALLOWED_SYMBOLS.has(sym)) return { status: 400, body: { ok: false, error: 'Unsupported symbol' } };
  const cacheKey = 'div:' + sym;
  const cached = await edgeGetJson(url.origin, cacheKey);
  if (cached && cached.ok) return { status: 200, body: cached };
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=5y&interval=1d&events=div',
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: controller.signal },
    );
    if (!response.ok) throw new Error('upstream ' + response.status);
    const data = await response.json();
    const root = data && data.chart && data.chart.result && data.chart.result[0];
    if (!root) throw new Error('shape');
    const events = (root.events && root.events.dividends) || {};
    const list = Object.keys(events).map(function (ts) {
      const raw = events[ts] || {};
      return { date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), amount: Number(raw.amount) || 0 };
    }).filter(function (d) { return d.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.date); })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    const body = { ok: true, sym: sym, dividends: list };
    await edgePutJson(url.origin, cacheKey, body, CACHE_TTL_SECONDS);
    return { status: 200, body: body };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'Dividends unavailable', detail: error.name === 'AbortError' ? 'Timeout' : error.message } };
  } finally {
    clearTimeout(timer);
  }
}
