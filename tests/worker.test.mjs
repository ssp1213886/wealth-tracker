import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import worker from '../src/worker.js';
import { createFakeDb } from './helpers/fake-d1.mjs';

const env = (db) => ({
  AUTH_TOKEN: 'secret',
  DB: db,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
});
const request = (path, options = {}) => new Request('https://example.com' + path, options);
const loginBody = (username, password) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
/** 用主密码登录（空库时会自动建主账号），返回可用于后续请求的 Cookie 头。 */
async function loginCookie(testEnv, username = 'admin', password = 'secret') {
  const res = await worker.fetch(request('/api/login', loginBody(username, password)), testEnv);
  const setCookie = res.headers.get('Set-Cookie') || '';
  return setCookie ? setCookie.split(';')[0] : '';
}

test('rejects sync without auth token', async () => {
  const response = await worker.fetch(request('/api/sync'), env(createFakeDb()));
  assert.equal(response.status, 401);
});

// v321：所有响应补安全头；HTML 另加 CSP（防点击劫持 —— 应用里有"长按 3 秒清除全部数据"）
test('安全响应头：通用三项人人有，CSP 只给 HTML', async () => {
  const html = await worker.fetch(request('/'), env(createFakeDb()));   // 未登录 → 登录页（HTML）
  assert.equal(html.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(html.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(html.headers.get('Referrer-Policy'), 'no-referrer');
  const csp = html.headers.get('Content-Security-Policy') || '';
  assert.match(csp, /frame-ancestors 'none'/, '必须禁止被嵌套（点击劫持）');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/qt\.gtimg\.cn/, '浏览器端腾讯行情回退要放行');
  assert.match(csp, /object-src 'none'/);

  const api = await worker.fetch(request('/api/sync'), env(createFakeDb()));   // 401 JSON
  assert.equal(api.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(api.headers.get('Content-Security-Policy'), null, 'JSON 接口不需要 CSP');
});

test('returns CORS preflight headers', async () => {
  const response = await worker.fetch(request('/api/sync', { method: 'OPTIONS' }), env(createFakeDb()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Max-Age'), '86400');
});

test('rejects unsupported price symbols and methods', async () => {
  const testEnv = env(createFakeDb());
  // /api/* 现在都要登录，这两个用例考的是参数校验，所以要带上凭证
  const cookie = await loginCookie(testEnv);
  assert.ok(cookie, '登录应拿到会话 cookie');
  const auth = { Cookie: cookie };
  assert.equal((await worker.fetch(request('/api/price?symbol=BAD', { headers: auth }), testEnv)).status, 400);
  assert.equal((await worker.fetch(request('/api/price?symbol=VGT', { method: 'POST', headers: auth }), testEnv)).status, 405);
});

/* ===== 登录门禁 ===== */

const shellEnv = (db) => ({
  AUTH_TOKEN: 'secret',
  DB: db,
  ASSETS: { fetch: async () => new Response('<!doctype html><html><body>APP SHELL</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) },
});
const nav = (path, cookie) => new Request('https://example.com' + path, {
  headers: {
    Accept: 'text/html,application/xhtml+xml',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    ...(cookie ? { Cookie: cookie } : {}),
  },
});
const login = (password) => request('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password }),
});

test('登录门禁：未登录的导航只给登录页，绝不吐 App 壳子', async () => {
  const res = await worker.fetch(nav('/'), env(createFakeDb()));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="loginForm"/);
  assert.doesNotMatch(html, /APP SHELL/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store, max-age=0');
});

test('登录门禁：/login 自己有路由（少了它会掉到资源查找变成 404）', async () => {
  const res = await worker.fetch(request('/login'), env(createFakeDb()));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') || '', /text\/html/);
  assert.match(await res.text(), /id="loginForm"/);
});

test('登录门禁：找不到的页面给人看 HTML，不要吐裸 JSON', async () => {
  const res = await worker.fetch(request('/definitely-not-here'), env(createFakeDb()));
  assert.equal(res.status, 404);
  assert.match(res.headers.get('Content-Type') || '', /text\/html/);
  assert.doesNotMatch(await res.text(), /^\{"error"/);
  // /api/* 仍然回 JSON（注意：未登录时会被门禁挡成 401，所以要带上会话才测得到 404）
  const apiEnv = shellEnv(createFakeDb());
  const cookie = await loginCookie(apiEnv);
  const api = await worker.fetch(request('/api/definitely-not-here', { headers: { Cookie: cookie } }), apiEnv);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('Content-Type') || '', /application\/json/);
  assert.match(api.headers.get('Cache-Control') || '', /no-store/);
});

test('登录门禁：/api/* 未登录返回 401 JSON（不是登录页）', async () => {
  const res = await worker.fetch(request('/api/quotes?symbols=VGT'), env(createFakeDb()));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Content-Type') || '', /application\/json/);
});

test('登录门禁：密码错 → 401；密码对 → 下发会话 cookie，带着它才能拿到壳子（且带壳子标记）', async () => {
  const testEnv = shellEnv(createFakeDb());
  assert.equal((await worker.fetch(login('wrong'), testEnv)).status, 401);

  const good = await worker.fetch(login('secret'), testEnv);
  assert.equal(good.status, 200);
  assert.equal((await good.clone().json()).username, 'admin', '首次登录会用它当主账号用户名');
  const setCookie = good.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /wt_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);

  const shell = await worker.fetch(nav('/', setCookie.split(';')[0]), testEnv);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /APP SHELL/);
  assert.equal(shell.headers.get('X-WT-Shell'), '1');
});

test('登录门禁：伪造 cookie 不放行；登出接口清空 cookie', async () => {
  const testEnv = shellEnv(createFakeDb());
  const forged = await worker.fetch(nav('/', 'wt_session=1:9999999999999.bad'), testEnv);
  assert.match(await forged.text(), /id="loginForm"/);

  const out = await worker.fetch(request('/api/logout', { method: 'POST' }), testEnv);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('Set-Cookie') || '', /Max-Age=0/);
});

test('登录门禁：服务器没配 AUTH_TOKEN 时不拦人（避免把自己锁在门外）', async () => {
  const bare = { DB: createFakeDb(), ASSETS: shellEnv(createFakeDb()).ASSETS };
  const res = await worker.fetch(nav('/'), bare);
  assert.match(await res.text(), /APP SHELL/);
});

test('登录门禁：静态资源不需要登录（否则 SW 预缓存会把登录页当成 App 壳子）', async () => {
  const res = await worker.fetch(new Request('https://example.com/assets/app.js', { headers: { Accept: '*/*' } }), shellEnv(createFakeDb()));
  assert.notEqual(res.status, 401);
});

test('validates sync payload and key whitelist', async () => {
  const db = createFakeDb();
  const cookie = await loginCookie(env(db));
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const testEnv = env(db);
  const badKey = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ bad: [] }),
  }), testEnv);
  assert.equal(badKey.status, 400);

  const invalidJson = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: '{',
  }), testEnv);
  assert.equal(invalidJson.status, 400);
});

test('stores valid sync payloads', async () => {
  const db = createFakeDb();
  const testEnv = env(db);
  const cookie = await loginCookie(testEnv);
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ trades: [] }),
  }), testEnv);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 1);
  assert.deepEqual(JSON.parse(db.rows.get('1|trades').value), []);
});

test('returns 409 when expected version is stale', async () => {
  const db = createFakeDb({ trades: [] });
  const testEnv = env(db);
  const cookie = await loginCookie(testEnv);
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [], __expectedVersions: { trades: 999 } }),
  }), testEnv);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.deepEqual(body.conflicts, ['trades']);
  assert.equal(body.currentVersions.trades, 1000);
});

test('does not 409 when the cloud has no row for that key yet', async () => {
  // 全新库（或被重置）时，客户端带着任何版本号来推都应当直接建立基线，
  // 否则用户会看到永远消不掉的假冲突。
  const db = createFakeDb();
  const testEnv = env(db);
  const cookie = await loginCookie(testEnv);
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trades: [{ id: 1 }],
      cashBalance: 3000,
      __expectedVersions: { trades: 1790275460093, cashBalance: 1790275486762 },
    }),
  }), testEnv);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 2);

  // 已有行 + 旧版本号，仍然要拦住
  const stale = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [{ id: 2 }], __expectedVersions: { trades: 1 } }),
  }), testEnv);
  assert.equal(stale.status, 409);
});
