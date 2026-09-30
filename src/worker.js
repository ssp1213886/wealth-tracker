import { serveAsset } from './lib/assets.js';
import { corsHeaders, json } from './lib/http.js';
import { handlePrice } from './lib/price.js';
import { handleSyncGet, handleSyncPost } from './lib/sync.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { handleLog } from './lib/logs.js';
import { handleQuotes, handleHoldings } from './lib/quotes.js';
import { handleLogo } from './lib/logos.js';
import { handleMarketCap } from './lib/marketcap.js';
import { readSession, issueSession, sessionCookie, clearSessionCookie, uidCookie, clearUidCookie, passwordMatches, sessionSecret } from './lib/session.js';
import { ensureAccountsTable, countAccounts, findAccountByUsername, listAccounts, createAccount, verifyAccountPassword, normalizeUsername } from './lib/accounts.js';
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
      const username = normalizeUsername(payload && payload.username);
      const password = String((payload && payload.password) || '');

      let account = null;
      let verified = false;
      try {
        await ensureAccountsTable(env);
        account = username ? await findAccountByUsername(env, username) : null;
        if (account && !Number(account.disabled)) {
          verified = await verifyAccountPassword(env, account, password);
        }
        // 首次上线引导：还没有任何账号时，用服务器上现成的密码（老的 token / APP_PASSWORD）
        // 建主账号，用户名就用这次输入的那个；老数据本来就挂在 user_id=1 名下，直接归它。
        if (!verified && !account) {
          const total = await countAccounts(env);
          if (total === 0 && await passwordMatches(password, env)) {
            // 主账号必须正好是 id=1 —— 老数据全挂在 user_id=1 名下
            const created = await createAccount(env, username, password, username, 1);
            if (created.id) {
              account = { id: created.id, username, name: username };
              verified = true;
            }
          }
        }
      } catch (error) {
        return json({ ok: false, error: 'db error' }, 502);
      }
      if (!verified) return json({ ok: false, error: 'invalid credentials' }, 401);

      const userId = Number(account.id);
      const session = await issueSession(env, userId);
      if (!session) return json({ ok: false, error: 'not configured' }, 503);
      const headers = new Headers(corsHeaders());
      headers.append('Set-Cookie', sessionCookie(session.value, session.maxAge));
      // 可读的账号 id：前端要在同步读 localStorage 之前知道该用哪个空间
      headers.append('Set-Cookie', uidCookie(userId, session.maxAge));
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(JSON.stringify({ ok: true, userId, username: account.username, name: account.name || account.username }), { status: 200, headers });
    }
    if (url.pathname === '/api/logout') {
      const headers = new Headers(corsHeaders());
      headers.append('Set-Cookie', clearSessionCookie());
      headers.append('Set-Cookie', clearUidCookie());
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    // 账号管理（需要已有会话）
    if (url.pathname === '/api/accounts') {
      const current = await readSession(request, env);
      if (!current) return json({ error: 'Unauthorized' }, 401);
      try {
        await ensureAccountsTable(env);
        if (request.method === 'GET') {
          const accounts = await listAccounts(env);
          const me = accounts.filter((item) => Number(item.id) === current.userId)[0] || null;
          return json({ ok: true, userId: current.userId, me, accounts });
        }
        if (request.method === 'POST') {
          let body = null;
          try { body = await request.json(); } catch (error) { body = null; }
          const created = await createAccount(env, body && body.username, body && body.password, body && body.name);
          if (created.error) return json({ ok: false, error: created.error }, 400);
          return json({ ok: true, id: created.id, userId: current.userId });
        }
      } catch (error) {
        return json({ ok: false, error: 'db error' }, 502);
      }
      return json({ error: 'Method not allowed' }, 405);
    }
    // 登录页自己的路由。少了这一条，/login 会掉到静态资源查找 → 404（真事故）
    if (url.pathname === '/login') return loginPageResponse('');

    // ---- 门禁：没登录就只给登录页 ----
    if (needsAuth(request, url.pathname)) {
      // 服务器压根没配密钥时不拦人（宁可当作公开站点，也不能把主人锁在门外）
      const gateActive = Boolean(sessionSecret(env));
      const authorized = !gateActive || Boolean(await readSession(request, env));
      if (!authorized) {
        if (url.pathname.indexOf('/api/') === 0) return json({ error: 'Unauthorized' }, 401);
        return loginPageResponse('');
      }
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
      const session = await readSession(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      const result = await handleSyncGet(env, session.userId);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const session = await readSession(request, env);
      if (!session) return json({ error: 'Unauthorized' }, 401);
      const result = await handleSyncPost(request, env, session.userId);
      return json(result.body, result.status);
    }

    // /api/* 绝不落到静态资源查找：未知接口就是 404 JSON
    if (url.pathname.indexOf('/api/') === 0) return json({ error: 'Not Found' }, 404);

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
