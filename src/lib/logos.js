// 标的图标代理：按股票代码去上游取公司图标，并缓存到 Cloudflare 边缘。
//
// 为什么不让前端直接连上游：
//   ① 隐私 —— 前端只跟自己的域名说话，第三方看不到你在看哪些标的；
//   ② 速度 —— 命中边缘缓存后不再出网；
//   ③ 可控 —— 上游换了、限流了，只改这一处。
//
// 返回的是图片本身（不是 JSON），所以路由里直接 return Response。

const UPSTREAM = 'https://financialmodelingprep.com/image-stock/';
/** 代码白名单：1–5 个字母，可带 . 或 -（BRK-B / BRK.B），拒绝一切其它字符（防注入）。 */
const SYMBOL_RE = /^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/;
/** 边缘缓存 7 天；上游图基本不变。 */
const TTL_SECONDS = 604800;
/** 小于这个字节数的响应多半是占位图/错误图，当成"没有"处理。 */
const MIN_BYTES = 200;

function text(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleLogo(request, url) {
  const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return text({ ok: false, error: 'invalid symbol' }, 400);

  // 用不带查询串以外差异的固定 URL 做缓存键，避免不同来源的等价请求重复回源
  const cacheKey = new Request(new URL('/api/logo?symbol=' + encodeURIComponent(symbol), url.origin).toString(), { method: 'GET' });
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let upstream = null;
  try {
    upstream = await fetch(UPSTREAM + encodeURIComponent(symbol) + '.png', { cf: { cacheTtl: TTL_SECONDS } });
  } catch (e) {
    return text({ ok: false, error: 'upstream unreachable' }, 502);
  }
  if (!upstream.ok) return text({ ok: false, error: 'no logo for ' + symbol }, 404);

  const body = await upstream.arrayBuffer();
  if (body.byteLength < MIN_BYTES) return text({ ok: false, error: 'empty logo for ' + symbol }, 404);

  const res = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'public, max-age=' + TTL_SECONDS,
      'X-Logo-Source': 'fmp',
    },
  });
  if (cache) {
    try { await cache.put(cacheKey, res.clone()); } catch (e) { /* 缓存写失败不影响本次返回 */ }
  }
  return res;
}
