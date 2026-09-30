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
import { ensureAccountsTable, countAccounts, findAccountByUsername, findAccountById, listAccounts, dataRowCounts, touchLastSeen, setAccountPassword, setAccountDisabled, deleteAccount, createAccount, verifyAccountPassword, normalizeUsername } from './lib/accounts.js';
import { loginPageResponse, notFoundPage } from './lib/login-page.js';
import { logEvent, logEventThrottled, recentEvents, pruneEvents } from './lib/events.js';

const rateLimiter = createRateLimiter();
/** 登录接口单独限流：10 分钟内最多 12 次尝试（比全站的 240/分钟严得多）。 */
const loginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 12 });

/**
 * 取"当前登录且仍然有效"的账号。
 * 三层校验：会话签名有效 → 账号还在且没被禁用 → 会话版本一致（管理员重置密码会 +1，旧设备立刻失效）。
 * 代价是每次要查一次库（~1ms），所以只用在对数据敏感的路径（同步、账号管理）上。
 */
async function activeAccount(request, env) {
  const session = await readSession(request, env);
  if (!session) return null;
  try {
    const account = await findAccountById(env, session.userId);
    if (!account || Number(account.disabled)) return null;
    if (Number(account.token_version || 0) !== Number(session.tokenVersion || 0)) return null;
    return account;
  } catch (error) {
    return null;
  }
}

/** 把 UA 归成一句人话，写进活动记录（"iPhone · Safari" 这种）。 */
function uaHint(request) {
  const ua = request.headers.get('User-Agent') || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return /CriOS/i.test(ua) ? 'iPhone · Chrome' : 'iPhone · Safari';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return /Edg\//.test(ua) ? 'Mac · Edge' : (/Chrome\//.test(ua) ? 'Mac · Chrome' : 'Mac · Safari');
  if (/Windows/i.test(ua)) return /Edg\//.test(ua) ? 'Windows · Edge' : (/Chrome\//.test(ua) ? 'Windows · Chrome' : 'Windows');
  return ua ? ua.slice(0, 24) : '未知设备';
}

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
  async fetch(request, env, ctx) {
    /**
     * 把"记日志 / 更新时间"这类不该阻塞响应的写入挂到 waitUntil 上。
     * ⚠️ 不能直接 fire-and-forget：Worker 一返回响应，没 await 的异步写入会被取消
     * —— 活动记录表一开始全是空的，就是这个原因。
     */
    const bg = (promise) => {
      const safe = Promise.resolve(promise).catch(() => {});
      try { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(safe); } catch (error) { /* 忽略 */ }
    };
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
            const created = await createAccount(env, username, password, { id: 1, role: 'owner' });
            if (created.id) {
              account = { id: created.id, username, role: 'owner', token_version: 0 };
              verified = true;
            }
          }
        }
      } catch (error) {
        return json({ ok: false, error: 'db error' }, 502);
      }
      if (!verified) {
        // 只有**失败**才计入限流：正常登录不该消耗配额（否则一家人共用一个出口 IP，
        // 谁多登几次就把全家锁在门外 10 分钟）。
        if (!loginLimiter.check(ip)) {
          return new Response(JSON.stringify({ ok: false, error: 'too many attempts' }), {
            status: 429,
            headers: { ...corsHeaders(), 'Retry-After': '600', 'Cache-Control': 'no-store' },
          });
        }
        return json({ ok: false, error: 'invalid credentials' }, 401);
      }

      const userId = Number(account.id);
      const session = await issueSession(env, userId, Number(account.token_version || 0));
      if (!session) return json({ ok: false, error: 'not configured' }, 503);
      bg(touchLastSeen(env, userId));
      bg(logEvent(env, userId, 'login', uaHint(request)));
      bg(pruneEvents(env));
      const headers = new Headers(corsHeaders());
      headers.append('Set-Cookie', sessionCookie(session.value, session.maxAge));
      // 可读的账号 id：前端要在同步读 localStorage 之前知道该用哪个空间
      headers.append('Set-Cookie', uidCookie(userId, session.maxAge));
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(JSON.stringify({ ok: true, userId, username: account.username, role: account.role || 'member' }), { status: 200, headers });
    }
    if (url.pathname === '/api/logout') {
      const headers = new Headers(corsHeaders());
      headers.append('Set-Cookie', clearSessionCookie());
      headers.append('Set-Cookie', clearUidCookie());
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }
    // 账号：查看 / 新增 / 管理（数据敏感，所以走 activeAccount 的三层校验）
    if (url.pathname === '/api/accounts' || url.pathname.indexOf('/api/accounts/') === 0) {
      const me = await activeAccount(request, env);
      if (!me) return json({ error: 'Unauthorized' }, 401);
      const isOwner = me.role === 'owner';
      const decorate = (row, counts) => ({
        id: Number(row.id),
        username: row.username,
        role: row.role || 'member',
        disabled: Number(row.disabled) ? 1 : 0,
        createdAt: Number(row.created_at) || 0,
        lastSeenAt: Number(row.last_seen_at) || 0,
        keys: counts[Number(row.id)] || 0,
      });
      try {
        await ensureAccountsTable(env);
        const counts = await dataRowCounts(env);

        if (url.pathname === '/api/accounts' && request.method === 'GET') {
          const mine = decorate(me, counts);
          // 普通成员只看得到自己；主账号能看到全部（含数据量与最近登录）
          const all = isOwner ? (await listAccounts(env)).map((row) => decorate(row, counts)) : [mine];
          return json({ ok: true, userId: Number(me.id), me: mine, accounts: all });
        }

        if (url.pathname === '/api/accounts' && request.method === 'POST') {
          if (!isOwner) return json({ ok: false, error: 'forbidden' }, 403);
          let body = null;
          try { body = await request.json(); } catch (error) { body = null; }
          const created = await createAccount(env, body && body.username, body && body.password);
          if (created.error) return json({ ok: false, error: created.error }, 400);
          bg(logEvent(env, me.id, 'admin', '新建账号 ' + normalizeUsername(body && body.username)));
          return json({ ok: true, id: created.id });
        }

        const targetId = url.pathname.indexOf('/api/accounts/') === 0
          ? Number(url.pathname.slice('/api/accounts/'.length))
          : NaN;
        if (Number.isFinite(targetId) && targetId > 0) {
          if (!isOwner) return json({ ok: false, error: 'forbidden' }, 403);
          const target = await findAccountById(env, targetId);
          if (!target) return json({ ok: false, error: 'not found' }, 404);
          const isSelf = Number(target.id) === Number(me.id);

          if (request.method === 'PATCH') {
            let body = null;
            try { body = await request.json(); } catch (error) { body = null; }
            if (body && typeof body.password === 'string') {
              if (body.password.length < 6) return json({ ok: false, error: 'password too short' }, 400);
              const done = await setAccountPassword(env, target.id, body.password);
              if (done.error) return json({ ok: false, error: done.error }, 400);
              bg(logEvent(env, me.id, 'admin', '重置了 ' + target.username + ' 的密码' + (isSelf ? '（自己）' : '')));
              // 改了自己的密码：会话版本也变了，顺手给自己换一张新会话，别把自己踢下线
              if (isSelf) {
                // 重新读一次：token_version 是数据库 +1 出来的，别拿内存里的旧行去猜
                const fresh = await findAccountById(env, me.id);
                const refreshed = await issueSession(env, me.id, Number((fresh && fresh.token_version) || 0));
                if (refreshed) {
                  const headers = new Headers(corsHeaders());
                  headers.append('Set-Cookie', sessionCookie(refreshed.value, refreshed.maxAge));
                  headers.append('Set-Cookie', uidCookie(me.id, refreshed.maxAge));
                  headers.set('Cache-Control', 'no-store, max-age=0');
                  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
                }
              }
            }
            if (body && body.disabled !== undefined) {
              // 不能把自己禁用，否则没人能管理了
              if (isSelf && body.disabled) return json({ ok: false, error: 'cannot disable self' }, 400);
              await setAccountDisabled(env, target.id, !!body.disabled);
              bg(logEvent(env, me.id, 'admin', (body.disabled ? '禁用' : '启用') + '了 ' + target.username));
            }
            return json({ ok: true });
          }

          if (request.method === 'DELETE') {
            if (isSelf) return json({ ok: false, error: 'cannot delete self' }, 400);
            // 删除前先把它的云端数据整份导出，随响应返回（前端会存成文件）
            const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM data WHERE user_id = ?').bind(target.id).all();
            const data = {};
            (results || []).forEach((row) => {
              try { data[row.key] = JSON.parse(row.value); } catch (error) { data[row.key] = row.value; }
            });
            await deleteAccount(env, target.id);
            bg(logEvent(env, me.id, 'admin', '删除了账号 ' + target.username));
            return json({ ok: true, exported: { userId: Number(target.id), username: target.username, exportedAt: Date.now(), data } });
          }
          return json({ error: 'Method not allowed' }, 405);
        }
      } catch (error) {
        return json({ ok: false, error: 'db error' }, 502);
      }
      return json({ error: 'Not Found' }, 404);
    }

    // 改自己的密码（谁都能改自己的）
    if (url.pathname === '/api/me/password' && request.method === 'POST') {
      const me = await activeAccount(request, env);
      if (!me) return json({ error: 'Unauthorized' }, 401);
      let body = null;
      try { body = await request.json(); } catch (error) { body = null; }
      const current = String((body && body.current) || '');
      const next = String((body && body.next) || '');
      if (next.length < 6) return json({ ok: false, error: 'password too short' }, 400);
      if (!await verifyAccountPassword(env, me, current)) return json({ ok: false, error: 'wrong password' }, 401);
      const done = await setAccountPassword(env, me.id, next);
      if (done.error) return json({ ok: false, error: done.error }, 400);
      bg(touchLastSeen(env, me.id));
      bg(logEvent(env, me.id, 'admin', '修改了自己的密码'));
      // 改密码会让 token_version +1：重新读一次，再给自己换一张带新版本号的会话，避免当场掉线
      const fresh = await findAccountById(env, me.id);
      const refreshed = await issueSession(env, me.id, Number((fresh && fresh.token_version) || 0));
      const headers = new Headers(corsHeaders());
      if (refreshed) {
        headers.append('Set-Cookie', sessionCookie(refreshed.value, refreshed.maxAge));
        headers.append('Set-Cookie', uidCookie(me.id, refreshed.maxAge));
      }
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    // 活动记录：主账号看全部，成员只看自己
    if (url.pathname === '/api/activity' && request.method === 'GET') {
      const me = await activeAccount(request, env);
      if (!me) return json({ error: 'Unauthorized' }, 401);
      const limit = Number(url.searchParams.get('limit')) || 40;
      const isOwner = me.role === 'owner';
      const rows = await recentEvents(env, isOwner ? { limit: limit } : { limit: limit, userId: me.id });
      return json({
        ok: true,
        scope: isOwner ? 'all' : 'self',
        events: rows.map((row) => ({
          ts: Number(row.ts) || 0,
          kind: row.kind,
          detail: row.detail || '',
          username: row.username || ('#' + row.user_id),
          userId: Number(row.user_id),
        })),
      });
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
      // 走 activeAccount：被禁用 / 会话版本过期（管理员重置过密码）都会立刻拒绝
      const account = await activeAccount(request, env);
      if (!account) return json({ error: 'Unauthorized' }, 401);
      const result = await handleSyncGet(env, account.id);
      // 同步很频繁，30 分钟内只记一条，免得把记录表刷满
      bg(logEventThrottled(env, account.id, 'sync', '拉取云端数据'));
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const account = await activeAccount(request, env);
      if (!account) return json({ error: 'Unauthorized' }, 401);
      const result = await handleSyncPost(request, env, account.id);
      const saved = result.body && result.body.saved;
      bg(logEventThrottled(env, account.id, 'sync', saved ? ('上传 ' + saved + ' 项到云端') : '推送云端数据'));
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
