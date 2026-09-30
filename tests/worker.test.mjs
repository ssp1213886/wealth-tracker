import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import worker from '../src/worker.js';

function createDb(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key, value]) => [key, {
    key,
    value: JSON.stringify(value),
    updated_at: 1000,
  }]));

  const execute = (sql, args) => {
    if (sql.startsWith('SELECT key, value, updated_at')) {
      return { results: [...rows.values()] };
    }
    if (sql.startsWith('SELECT key, updated_at')) {
      return { results: [...rows.values()].filter((row) => args.includes(row.key)) };
    }
    if (sql.startsWith('INSERT OR REPLACE')) {
      const [key, value, updated_at] = args;
      rows.set(key, { key, value, updated_at });
      return { success: true };
    }
    return { results: [] };
  };

  const statement = (sql) => {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      all: async () => execute(sql, args),
      run: async () => execute(sql, args),
    };
  };

  return {
    rows,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const item of statements) await item.run();
      return statements.map(() => ({ success: true }));
    },
  };
}

const env = (db) => ({
  AUTH_TOKEN: 'secret',
  DB: db,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
});
const request = (path, options = {}) => new Request('https://example.com' + path, options);

test('rejects sync without auth token', async () => {
  const response = await worker.fetch(request('/api/sync'), env(createDb()));
  assert.equal(response.status, 401);
});

test('returns CORS preflight headers', async () => {
  const response = await worker.fetch(request('/api/sync', { method: 'OPTIONS' }), env(createDb()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Max-Age'), '86400');
});

test('rejects unsupported price symbols and methods', async () => {
  const testEnv = env(createDb());
  // /api/* 现在都要登录，这两个用例考的是参数校验，所以要带上凭证
  const auth = { 'X-Auth-Token': 'secret' };
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
  body: JSON.stringify({ password }),
});

test('登录门禁：未登录的导航只给登录页，绝不吐 App 壳子', async () => {
  const res = await worker.fetch(nav('/'), env(createDb()));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /请输入访问令牌/);
  assert.doesNotMatch(html, /APP SHELL/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store, max-age=0');
});

test('登录门禁：/login 自己有路由（少了它会掉到资源查找变成 404）', async () => {
  const res = await worker.fetch(request('/login'), env(createDb()));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') || '', /text\/html/);
  assert.match(await res.text(), /请输入访问令牌/);
});

test('登录门禁：找不到的页面给人看 HTML，不要吐裸 JSON', async () => {
  const res = await worker.fetch(request('/definitely-not-here'), env(createDb()));
  assert.equal(res.status, 404);
  assert.match(res.headers.get('Content-Type') || '', /text\/html/);
  assert.doesNotMatch(await res.text(), /^\{"error"/);
  // /api/* 仍然回 JSON（注意：未登录时会被门禁挡成 401，所以要带上凭证才测得到 404）
  const api = await worker.fetch(request('/api/definitely-not-here', { headers: { 'X-Auth-Token': 'secret' } }), env(createDb()));
  assert.equal(api.status, 404);
  assert.match(api.headers.get('Content-Type') || '', /application\/json/);
  assert.match(api.headers.get('Cache-Control') || '', /no-store/);
});

test('登录门禁：/api/* 未登录返回 401 JSON（不是登录页）', async () => {
  const res = await worker.fetch(request('/api/quotes?symbols=VGT'), env(createDb()));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Content-Type') || '', /application\/json/);
});

test('登录门禁：密码错 → 401；密码对 → 下发会话 cookie，带着它才能拿到壳子（且带壳子标记）', async () => {
  const testEnv = shellEnv(createDb());
  assert.equal((await worker.fetch(login('wrong'), testEnv)).status, 401);

  const good = await worker.fetch(login('secret'), testEnv);
  assert.equal(good.status, 200);
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
  const testEnv = shellEnv(createDb());
  const forged = await worker.fetch(nav('/', 'wt_session=9999999999999.bad'), testEnv);
  assert.match(await forged.text(), /请输入访问令牌/);

  const out = await worker.fetch(request('/api/logout', { method: 'POST' }), testEnv);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('Set-Cookie') || '', /Max-Age=0/);
});

test('登录门禁：服务器没配 AUTH_TOKEN 时不拦人（避免把自己锁在门外）', async () => {
  const bare = { DB: createDb(), ASSETS: shellEnv(createDb()).ASSETS };
  const res = await worker.fetch(nav('/'), bare);
  assert.match(await res.text(), /APP SHELL/);
});

test('登录门禁：静态资源不需要登录（否则 SW 预缓存会把登录页当成 App 壳子）', async () => {
  const res = await worker.fetch(new Request('https://example.com/assets/app.js', { headers: { Accept: '*/*' } }), shellEnv(createDb()));
  assert.notEqual(res.status, 401);
});

test('validates sync payload and key whitelist', async () => {
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const badKey = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ bad: [] }),
  }), env(createDb()));
  assert.equal(badKey.status, 400);

  const invalidJson = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: '{',
  }), env(createDb()));
  assert.equal(invalidJson.status, 400);
});

test('stores valid sync payloads', async () => {
  const db = createDb();
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ trades: [] }),
  }), env(db));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 1);
  assert.deepEqual(JSON.parse(db.rows.get('trades').value), []);
});

test('returns 409 when expected version is stale', async () => {
  const db = createDb({ trades: [] });
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [], __expectedVersions: { trades: 999 } }),
  }), env(db));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.deepEqual(body.conflicts, ['trades']);
  assert.equal(body.currentVersions.trades, 1000);
});

test('does not 409 when the cloud has no row for that key yet', async () => {
  // 全新库（或被重置）时，客户端带着任何版本号来推都应当直接建立基线，
  // 否则用户会看到永远消不掉的假冲突。
  const db = createDb();
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trades: [{ id: 1 }],
      cashBalance: 3000,
      __expectedVersions: { trades: 1790275460093, cashBalance: 1790275486762 },
    }),
  }), env(db));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 2);

  // 已有行 + 旧版本号，仍然要拦住
  const stale = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [{ id: 2 }], __expectedVersions: { trades: 1 } }),
  }), env(db));
  assert.equal(stale.status, 409);
});
