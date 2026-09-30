// 多用户隔离的集成测试：账号怎么建、数据怎么分、能不能互相看见。
//
// 这是这次改造最该钉住的东西 —— 单元测试覆盖不了"两个账号之间到底隔没隔开"。
// 用一个内存版 D1（按 worker 实际发出的 SQL 形状路由），把整条链路跑通。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { createFakeDb } from './helpers/fake-d1.mjs';

const SHELL = '<!doctype html><html><body>APP SHELL</body></html>';
const makeEnv = (db) => ({
  AUTH_TOKEN: 'master-secret',
  DB: db,
  ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }) },
});
let ipSeq = 0;
/** 每个请求给一个独立 IP：登录限流是按 IP 计的，测试之间不该互相影响。 */
const req = (path, options = {}) => new Request('https://example.com' + path, Object.assign({}, options, {
  headers: Object.assign({ 'CF-Connecting-IP': '10.0.0.' + (++ipSeq) }, options.headers || {}),
}));
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
  const db = createFakeDb();
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
  const db = createFakeDb();
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
  const db = createFakeDb();
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
  const db = createFakeDb();
  const env = makeEnv(db);
  await login(env, 'admin', 'master-secret');
  assert.equal((await login(env, 'admin', 'wrong-password')).status, 401);
  assert.equal((await login(env, 'nobody', 'master-secret')).status, 401, '不存在的主账号不能用服务器密码进');
  assert.equal((await login(env, 'admin', '')).status, 401);
});

test('多用户：改 cookie 里的 userId 冒充别人会验签失败', async () => {
  const db = createFakeDb();
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
  const db = createFakeDb();
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

/* ===== 管理功能 ===== */

async function ownerAndMember() {
  const db = createFakeDb();
  const env = makeEnv(db);
  const owner = await login(env, 'ssp', 'master-secret');
  await worker.fetch(jsonReq('/api/accounts', { username: 'lily', password: 'lily-pass-1' }, owner.cookie), env);
  const member = await login(env, 'lily', 'lily-pass-1');
  return { db, env, owner, member };
}
const patch = (env, cookie, id, body) => worker.fetch(req('/api/accounts/' + id, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body),
}), env);

test('管理：只有主账号能建账号，成员被拒（403）且只看得到自己', async () => {
  const { env, owner, member } = await ownerAndMember();
  assert.equal((await worker.fetch(jsonReq('/api/accounts', { username: 'nope', password: 'whatever1' }, member.cookie), env)).status, 403);
  const list = await (await worker.fetch(req('/api/accounts', { headers: { Cookie: member.cookie } }), env)).json();
  assert.equal(list.accounts.length, 1, '成员只看得到自己');
  assert.equal(list.me.username, 'lily');
  assert.equal(list.me.role, 'member');
  const ownerList = await (await worker.fetch(req('/api/accounts', { headers: { Cookie: owner.cookie } }), env)).json();
  assert.equal(ownerList.accounts.length, 2, '主账号看得到全部');
  assert.equal(ownerList.me.role, 'owner');
});

test('管理：重置密码后旧密码失效、旧设备会话立刻作废', async () => {
  const { env, owner, member } = await ownerAndMember();
  assert.equal((await getSync(env, member.cookie)).status, 200, '重置前会话有效');

  const res = await patch(env, owner.cookie, 2, { password: 'new-pass-99' });
  assert.equal(res.status, 200);

  assert.equal((await getSync(env, member.cookie)).status, 401, '旧会话必须立刻失效（token_version 变了）');
  assert.equal((await login(env, 'lily', 'lily-pass-1')).status, 401, '旧密码不能再用');
  assert.equal((await login(env, 'lily', 'new-pass-99')).status, 200, '新密码可用');
});

test('管理：禁用账号后同步被拒，启用后恢复', async () => {
  const { env, owner, member } = await ownerAndMember();
  assert.equal((await patch(env, owner.cookie, 2, { disabled: true })).status, 200);
  assert.equal((await getSync(env, member.cookie)).status, 401, '被禁用后数据接口要拒绝');
  assert.equal((await login(env, 'lily', 'lily-pass-1')).status, 401, '被禁用后登不进来');
  assert.equal((await patch(env, owner.cookie, 2, { disabled: false })).status, 200);
  assert.equal((await login(env, 'lily', 'lily-pass-1')).status, 200);
});

test('管理：主账号不能禁用或删除自己（否则没人能管理了）', async () => {
  const { env, owner } = await ownerAndMember();
  assert.equal((await patch(env, owner.cookie, 1, { disabled: true })).status, 400);
  const del = await worker.fetch(req('/api/accounts/1', { method: 'DELETE', headers: { Cookie: owner.cookie } }), env);
  assert.equal(del.status, 400);
});

test('管理：删除成员会连带删掉它的数据，并把数据先导出返回', async () => {
  const { env, owner, member } = await ownerAndMember();
  await postSync(env, member.cookie, { trades: [{ id: 9, symbol: 'SMH' }], cashBalance: 555 });

  const del = await worker.fetch(req('/api/accounts/2', { method: 'DELETE', headers: { Cookie: owner.cookie } }), env);
  assert.equal(del.status, 200);
  const body = await del.json();
  assert.equal(body.exported.username, 'lily');
  assert.deepEqual(body.exported.data.trades, [{ id: 9, symbol: 'SMH' }], '删除前要把数据导出来');
  assert.equal(body.exported.data.cashBalance, 555);

  assert.equal((await login(env, 'lily', 'lily-pass-1')).status, 401, '账号没了就登不进');
  const list = await (await worker.fetch(req('/api/accounts', { headers: { Cookie: owner.cookie } }), env)).json();
  assert.deepEqual(list.accounts.map((a) => a.username), ['ssp']);
});

test('管理：改自己的密码要验旧密码，改完当前设备不掉线、旧密码失效', async () => {
  const { env, member } = await ownerAndMember();
  const wrong = await worker.fetch(jsonReq('/api/me/password', { current: 'nope', next: 'brand-new-1' }, member.cookie), env);
  assert.equal(wrong.status, 401);

  const ok = await worker.fetch(jsonReq('/api/me/password', { current: 'lily-pass-1', next: 'brand-new-1' }, member.cookie), env);
  assert.equal(ok.status, 200);
  const refreshed = (ok.headers.get('Set-Cookie') || '').split(';')[0];
  assert.ok(refreshed.indexOf('wt_session=') === 0, '改完密码要换发新会话，别把自己踢下线');
  assert.equal((await getSync(env, refreshed)).status, 200, '新会话可用');
  assert.equal((await getSync(env, member.cookie)).status, 401, '旧会话作废');
  assert.equal((await login(env, 'lily', 'brand-new-1')).status, 200);
  assert.equal((await login(env, 'lily', 'lily-pass-1')).status, 401);
});
