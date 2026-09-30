// 多用户隔离的集成测试：账号怎么建、数据怎么分、能不能互相看见。
//
// 这是这次改造最该钉住的东西 —— 单元测试覆盖不了"两个账号之间到底隔没隔开"。
// 用一个内存版 D1（按 worker 实际发出的 SQL 形状路由），把整条链路跑通。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

function createDb() {
  const accounts = [];
  const data = new Map(); // `${user_id}|${key}` -> { user_id, key, value, updated_at }

  const route = (sql, args) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('CREATE TABLE IF NOT EXISTS accounts')) return { results: [], success: true };
    if (q.startsWith('SELECT COUNT(*) AS n FROM accounts')) return { results: [{ n: accounts.length }] };
    if (q.startsWith('SELECT * FROM accounts WHERE username = ?')) {
      return { results: accounts.filter((a) => a.username === args[0]) };
    }
    if (q.startsWith('SELECT id, username, name, created_at FROM accounts')) {
      return { results: accounts.map((a) => ({ id: a.id, username: a.username, name: a.name, created_at: a.created_at })) };
    }
    if (q.startsWith('INSERT INTO accounts (id,')) {
      const [id, username, name, pass_hash, salt, created_at] = args;
      accounts.push({ id, username, name, pass_hash, salt, created_at, disabled: 0 });
      return { results: [], success: true, meta: { last_row_id: id } };
    }
    if (q.startsWith('INSERT INTO accounts (username,')) {
      const [username, name, pass_hash, salt, created_at] = args;
      const id = accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1;
      if (accounts.some((a) => a.username === username)) {
        const err = new Error('UNIQUE constraint failed: accounts.username');
        throw err;
      }
      accounts.push({ id, username, name, pass_hash, salt, created_at, disabled: 0 });
      return { results: [], success: true, meta: { last_row_id: id } };
    }
    if (q.startsWith('SELECT key, value, updated_at FROM data WHERE user_id = ?')) {
      const userId = Number(args[0]);
      return { results: [...data.values()].filter((row) => row.user_id === userId) };
    }
    if (q.startsWith('SELECT key, updated_at FROM data WHERE user_id = ? AND key IN')) {
      const userId = Number(args[0]);
      const wanted = new Set(args.slice(1));
      return { results: [...data.values()].filter((row) => row.user_id === userId && wanted.has(row.key)).map((row) => ({ key: row.key, updated_at: row.updated_at })) };
    }
    if (q.startsWith('INSERT OR REPLACE INTO data')) {
      const [user_id, key, value, updated_at] = args;
      data.set(user_id + '|' + key, { user_id, key, value, updated_at });
      return { results: [], success: true };
    }
    throw new Error('未预期的 SQL: ' + q);
  };

  const statement = (sql) => {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      all: async () => route(sql, args),
      first: async () => {
        const out = route(sql, args);
        return out.results && out.results.length ? out.results[0] : null;
      },
      run: async () => route(sql, args),
    };
  };

  return {
    accounts,
    data,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const item of statements) await item.run();
      return statements.map(() => ({ success: true }));
    },
  };
}

const SHELL = '<!doctype html><html><body>APP SHELL</body></html>';
const makeEnv = (db) => ({
  AUTH_TOKEN: 'master-secret',
  DB: db,
  ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }) },
});
const req = (path, options = {}) => new Request('https://example.com' + path, options);
const jsonReq = (path, body, cookie) => req(path, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
});
const cookieOf = (response) => (response.headers.get('Set-Cookie') || '').split(';')[0];

async function login(env, username, password) {
  const res = await worker.fetch(jsonReq('/api/login', { username, password }), env);
  return { status: res.status, cookie: cookieOf(res), body: await res.clone().json().catch(() => null) };
}
const getSync = async (env, cookie) => {
  const res = await worker.fetch(req('/api/sync', { headers: { Cookie: cookie } }), env);
  return { status: res.status, body: await res.json() };
};
const postSync = async (env, cookie, payload) => {
  const res = await worker.fetch(jsonReq('/api/sync', payload, cookie), env);
  return { status: res.status, body: await res.json() };
};

test('多用户：空库首次登录会用服务器密码自动建主账号（id 固定为 1）', async () => {
  const db = createDb();
  const env = makeEnv(db);
  const res = await login(env, 'admin', 'master-secret');
  assert.equal(res.status, 200);
  assert.equal(res.body.userId, 1);
  assert.equal(db.accounts.length, 1);
  assert.equal(db.accounts[0].id, 1, '老数据挂在 user_id=1，主账号必须是 1');
  assert.equal(db.accounts[0].username, 'admin');
  // 密码不能明文存
  assert.ok(db.accounts[0].pass_hash && db.accounts[0].pass_hash !== 'master-secret');
});

test('多用户：两个账号的数据互相看不见（核心验收）', async () => {
  const db = createDb();
  const env = makeEnv(db);
  const mine = await login(env, 'admin', 'master-secret');
  assert.equal(mine.status, 200);

  // 主账号推入自己的数据
  const pushed = await postSync(env, mine.cookie, { trades: [{ id: 1, symbol: 'VGT', shares: 8.62 }], cashBalance: 34000 });
  assert.equal(pushed.status, 200);
  const mineBack = await getSync(env, mine.cookie);
  assert.deepEqual(mineBack.body.data.trades, [{ id: 1, symbol: 'VGT', shares: 8.62 }]);
  assert.equal(mineBack.body.data.cashBalance, 34000);

  // 用主账号的会话建一个新账号
  const created = await worker.fetch(jsonReq('/api/accounts', { username: 'lily', password: 'lily-pass-1', name: 'Lily' }, mine.cookie), env);
  assert.equal(created.status, 200);

  const other = await login(env, 'lily', 'lily-pass-1');
  assert.equal(other.status, 200);
  assert.equal(other.body.userId, 2);
  assert.notEqual(other.cookie, mine.cookie);

  // 新账号：云端是空的，看不到主账号任何数据
  const otherSync = await getSync(env, other.cookie);
  assert.equal(otherSync.status, 200);
  assert.deepEqual(otherSync.body.data, {}, '新账号不该看到别人的数据');

  // 新账号推自己的数据，不能覆盖主账号
  await postSync(env, other.cookie, { trades: [{ id: 9, symbol: 'SMH', shares: 1 }] });
  const mineAgain = await getSync(env, mine.cookie);
  assert.deepEqual(mineAgain.body.data.trades, [{ id: 1, symbol: 'VGT', shares: 8.62 }], '主账号数据必须原样');
  const otherAgain = await getSync(env, other.cookie);
  assert.deepEqual(otherAgain.body.data.trades, [{ id: 9, symbol: 'SMH', shares: 1 }]);
});

test('多用户：同名账号、非法用户名、过短密码都被拒', async () => {
  const db = createDb();
  const env = makeEnv(db);
  const mine = await login(env, 'admin', 'master-secret');
  const create = (body) => worker.fetch(jsonReq('/api/accounts', body, mine.cookie), env);

  assert.equal((await create({ username: 'admin', password: 'whatever1' })).status, 400, '重名要拒');
  assert.equal((await create({ username: 'A B', password: 'whatever1' })).status, 400);
  assert.equal((await create({ username: 'x', password: 'whatever1' })).status, 400, '太短的用户名');
  assert.equal((await create({ username: 'okname', password: '123' })).status, 400, '太短的密码');
  assert.equal((await create({ username: 'okname', password: '123456' })).status, 200);
});

test('多用户：密码错误 / 不存在的用户名都登不进去', async () => {
  const db = createDb();
  const env = makeEnv(db);
  await login(env, 'admin', 'master-secret');
  assert.equal((await login(env, 'admin', 'wrong-password')).status, 401);
  assert.equal((await login(env, 'nobody', 'master-secret')).status, 401, '不存在的主账号不能用服务器密码进');
  assert.equal((await login(env, 'admin', '')).status, 401);
});

test('多用户：改 cookie 里的 userId 冒充别人会验签失败', async () => {
  const db = createDb();
  const env = makeEnv(db);
  const mine = await login(env, 'admin', 'master-secret');
  await worker.fetch(jsonReq('/api/accounts', { username: 'lily', password: 'lily-pass-1' }, mine.cookie), env);

  // wt_session 的形状是 "userId:过期时间.签名" —— 把 userId 改成 2，签名对不上
  const value = mine.cookie.split('=')[1];
  const forged = 'wt_session=2:' + value.split(':')[1];
  const res = await worker.fetch(req('/api/sync', { headers: { Cookie: forged } }), env);
  assert.equal(res.status, 401, '改 userId 必须失效');
});

test('多用户：账号接口需要登录；列表里能看到有哪些账号', async () => {
  const db = createDb();
  const env = makeEnv(db);
  assert.equal((await worker.fetch(req('/api/accounts'), env)).status, 401, '未登录不能看/建账号');

  const mine = await login(env, 'admin', 'master-secret');
  await worker.fetch(jsonReq('/api/accounts', { username: 'lily', password: 'lily-pass-1', name: 'Lily' }, mine.cookie), env);
  const res = await worker.fetch(req('/api/accounts', { headers: { Cookie: mine.cookie } }), env);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.me.username, 'admin');
  assert.deepEqual(body.accounts.map((a) => a.username), ['admin', 'lily']);
  // 绝不能把哈希/盐泄给前端
  assert.equal(body.accounts[0].pass_hash, undefined);
  assert.equal(body.accounts[0].salt, undefined);
});
