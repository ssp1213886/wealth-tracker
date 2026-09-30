import { authRequired, isAuthorized } from './lib/auth.js';
import { serveAsset } from './lib/assets.js';
import { corsHeaders, json } from './lib/http.js';
import { handlePrice } from './lib/price.js';
import { handleSyncGet, handleSyncPost } from './lib/sync.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { handleLog } from './lib/logs.js';
import { handleQuotes, handleHoldings } from './lib/quotes.js';
import { handleLogo } from './lib/logos.js';
import { handleMarketCap } from './lib/marketcap.js';
import { hasValidSession, issueSession, sessionCookie, clearSessionCookie, passwordMatches, sessionSecret, loginPassword } from './lib/session.js';
import { loginPageResponse, notFoundPage } from './lib/login-page.js';

const rateLimiter = createRateLimiter();
/** 登录接口单独限流：10 分钟内最多 12 次尝试（比全站的 240/分钟严得多）。 */
const loginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 12 });

/** 不需要登录就能碰的路径：登录页本体、登录/登出接口、SW、清单、图标与启动图。 */
function isOpenPath(pathname) {
  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/logout') return true;
  if (pathname === '/sw.js' || pathname === '/manifest.json') return true;
  return /^\/(icon[\w.-]*\.png|splash\/)/.test(pathname);
}

/**
 * 判断一个请求要不要过登录门禁。
 *
 * 关键：**只拦"要 HTML 的导航请求"和所有 /api/**，静态资源（js/css）放行。
 * 原因是 Service Worker 预缓存 '/' 用的是普通 fetch（不是导航请求）——
 * 要是连它一起拦，SW 会把**登录页**当成 App 壳子缓存下来，用户登出后就再也回不去了。
 * 界面代码本身不是秘密（真正要护的是数据），这样才能既挡人又不把自己锁在门外。
 */
function needsAuth(request, pathname) {
  if (isOpenPath(pathname)) return false;
  if (pathname.indexOf('/api/') === 0) return true;
  const accept = request.headers.get('Accept') || '';
  const dest = request.headers.get('Sec-Fetch-Dest') || '';
  const mode = request.headers.get('Sec-Fetch-Mode') || '';
  return mode === 'navigate' || dest === 'document' || accept.indexOf('text/html') >= 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (!rateLimiter.check(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...corsHeaders(), 'Retry-After': '60' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Auth-Token',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ---- 登录 / 登出 ----
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!sessionSecret(env)) return json({ ok: false, error: 'not configured' }, 503);
      if (!loginLimiter.check(ip)) {
        return new Response(JSON.stringify({ ok: false, error: 'too many attempts' }), {
          status: 429,
          headers: { ...corsHeaders(), 'Retry-After': '600', 'Cache-Control': 'no-store' },
        });
      }
      let payload = null;
      try { payload = await request.json(); } catch (error) { payload = null; }
      const matched = await passwordMatches(payload && payload.password, env);
      if (!matched) return json({ ok: false, error: 'invalid token' }, 401);
      const session = await issueSession(env);
      if (!session) return json({ ok: false, error: 'not configured' }, 503);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...corsHeaders(),
          'Set-Cookie': sessionCookie(session.value, session.maxAge),
          'Cache-Control': 'no-store, max-age=0',
        },
      });
    }
    if (url.pathname === '/api/logout') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...corsHeaders(),
          'Set-Cookie': clearSessionCookie(),
          'Cache-Control': 'no-store, max-age=0',
        },
      });
    }
    // 登录页自己的路由。少了这一条，/login 会掉到静态资源查找 → 404（真事故）
    if (url.pathname === '/login') return loginPageResponse('');

    // ---- 门禁：没登录就只给登录页 ----
    if (needsAuth(request, url.pathname)) {
      // 服务器压根没配密码时不拦人（宁可当作公开站点，也不能把主人锁在门外）
      const gateActive = Boolean(loginPassword(env));
      // 会话 cookie 和旧的 X-Auth-Token 两种凭证都认（老设备不受影响）
      const authorized = !gateActive || isAuthorized(request, env) || await hasValidSession(request, env);
      if (!authorized) {
        if (url.pathname.indexOf('/api/') === 0) return json({ error: 'Unauthorized' }, 401);
        return loginPageResponse('');
      }
    }

    // /api/sync 两种凭证都认：会话 cookie（新）或 X-Auth-Token（老客户端）
    if (authRequired(url) && !isAuthorized(request, env) && !await hasValidSession(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    if (url.pathname === '/api/price') {
      const result = await handlePrice(request, url);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/log') {
      const result = await handleLog(request, env);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/quotes') {
      const result = await handleQuotes(request, url);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/holdings') {
      const result = await handleHoldings(request, url);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/marketcap') {
      const result = await handleMarketCap(request, url);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/logo') {
      // 注意：返回的是图片，不走 json()
      return await handleLogo(request, url);
    }
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      const result = await handleSyncGet(env);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const result = await handleSyncPost(request, env);
      return json(result.body, result.status);
    }

    const asset = await serveAsset(request, url, env);
    if (asset) {
      // 给真正的 App 壳子打标记：Service Worker 只缓存带这个标记的导航响应，
      // 免得登录页被当成壳子缓存下来。
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const headers = new Headers(asset.headers);
        headers.set('X-WT-Shell', '1');
        return new Response(asset.body, { status: asset.status, headers });
      }
      return asset;
    }
    // 人看的页面永远别吐裸 JSON：浏览器里出现 {"error":"Not Found"} 根本没法自查
    if (url.pathname.indexOf('/api/') === 0) return json({ error: 'Not Found' }, 404);
    return notFoundPage();
  },
};
