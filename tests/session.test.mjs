// 登录会话（src/lib/session.js）：签名、过期、篡改、密码比对。
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, readSession, sessionCookie, clearSessionCookie, uidCookie, clearUidCookie, passwordMatches, sessionSecret, loginPassword, extraPasswords } from '../src/lib/session.js';

const ENV = { AUTH_TOKEN: 'token-abc-123' };
const requestWith = (cookie) => new Request('https://example.com/', { headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = (setCookie) => setCookie.split(';')[0];

test('session：签发的会话能被验签通过，v 前面的 payload 就是过期时间', async () => {
  const session = await issueSession(ENV, 7, 0, 1_700_000_000_000);
  assert.ok(session && session.value.indexOf('.') > 0);
  // payload 是「userId:过期时间」，过期时间 = 签发时刻 + 90 天
  assert.equal(session.value.split('.')[0], '7:0:' + (1_700_000_000_000 + 90 * 24 * 60 * 60 * 1000));
  assert.equal(session.maxAge, 90 * 24 * 60 * 60);
  const cookie = sessionCookie(session.value, session.maxAge);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.deepEqual(await readSession(requestWith(cookieOf(cookie)), ENV, 1_700_000_000_000 + 1000), { userId: 7, tokenVersion: 0 });
});

test('session：过期的时间戳一定失效', async () => {
  const session = await issueSession(ENV, 7, 0, 1_700_000_000_000);
  const cookie = cookieOf(sessionCookie(session.value, session.maxAge));
  const afterTtl = 1_700_000_000_000 + 90 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(await readSession(requestWith(cookie), ENV, afterTtl), null);
});

test('session：签名被改动 / 换一把密钥都会失效', async () => {
  const session = await issueSession(ENV, 7, 0, 1_700_000_000_000);
  const [payload, sig] = session.value.split('.');
  const tampered = payload + '.' + sig.slice(0, -2) + (sig.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert.equal(await readSession(requestWith('wt_session=' + tampered), ENV), null);
  // 换个 AUTH_TOKEN（等于换密钥）后老会话作废
  assert.equal(await readSession(requestWith('wt_session=' + session.value), { AUTH_TOKEN: 'another' }), null);
  // 把 userId 改掉但签名不变 → 必须失效（不能靠改 cookie 冒充别人）
  const forged = '9:' + payload.split(':')[1] + ':' + payload.split(':')[2] + '.' + sig;
  assert.equal(await readSession(requestWith('wt_session=' + forged), ENV), null);
  // 没有 cookie / cookie 里没有这一段
  assert.equal(await readSession(requestWith(''), ENV), null);
  assert.equal(await readSession(requestWith('other=1'), ENV), null);
  assert.equal(await readSession(requestWith('wt_session=garbage'), ENV), null);
});

test('session：服务器没配密钥时签不出会话（门禁会自动关闭，避免锁死自己）', async () => {
  assert.equal(sessionSecret({}), '');
  assert.equal(await issueSession({}, 1, 0), null);
  assert.equal(await readSession(requestWith('wt_session=1:2.3'), {}), null);
  assert.equal(await passwordMatches('x', {}), false);
});

test('session：SESSION_SECRET 优先于 AUTH_TOKEN', async () => {
  assert.equal(sessionSecret({ AUTH_TOKEN: 'a', SESSION_SECRET: 'b' }), 'b');
  const session = await issueSession({ SESSION_SECRET: 'b' }, 3, 0);
  assert.deepEqual(await readSession(requestWith('wt_session=' + session.value), { SESSION_SECRET: 'b' }), { userId: 3, tokenVersion: 0 });
  assert.equal(await readSession(requestWith('wt_session=' + session.value), { AUTH_TOKEN: 'a' }), null);
});

test('passwordMatches：对就是对、错就是错，空值不通过', async () => {
  assert.equal(await passwordMatches('token-abc-123', ENV), true);
  assert.equal(await passwordMatches('token-abc-124', ENV), false);
  assert.equal(await passwordMatches('', ENV), false);
  assert.equal(await passwordMatches(null, ENV), false);
  assert.equal(await passwordMatches(undefined, ENV), false);
});

test('uid cookie：给前端读账号 id（故意不 HttpOnly），登出时一起清掉', () => {
  const cookie = uidCookie(5, 3600);
  assert.match(cookie, /^wt_uid=5;/);
  assert.doesNotMatch(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(clearUidCookie(), /^wt_uid=;/);
  assert.match(clearUidCookie(), /Max-Age=0/);
});

test('clearSessionCookie：把 cookie 置空并立即过期', () => {
  const cookie = clearSessionCookie();
  assert.match(cookie, /^wt_session=;/);
  assert.match(cookie, /Max-Age=0/);
});

test('session：登录密码优先 APP_PASSWORD，没配才沿用老的 AUTH_TOKEN', async () => {
  assert.equal(loginPassword({ APP_PASSWORD: 'p' }), 'p');
  assert.equal(loginPassword({ AUTH_TOKEN: 't' }), 't');
  assert.equal(loginPassword({ APP_PASSWORD: 'p', AUTH_TOKEN: 't' }), 'p');
  assert.equal(loginPassword({}), '');
  // 两个都配了的时候，只有密码能登录，老的 token 不再算数
  assert.equal(await passwordMatches('p', { APP_PASSWORD: 'p', AUTH_TOKEN: 't' }), true);
  assert.equal(await passwordMatches('t', { APP_PASSWORD: 'p', AUTH_TOKEN: 't' }), false);
  // 会话密钥可以单独指定，没指定就跟着登录密码
  assert.equal(sessionSecret({ APP_PASSWORD: 'p' }), 'p');
  assert.equal(sessionSecret({ APP_PASSWORD: 'p', SESSION_SECRET: 's' }), 's');
});

test('session：EXTRA_PASSWORDS 里的额外口令也能登录（主密码照旧有效）', async () => {
  const env = { AUTH_TOKEN: 'main-token', EXTRA_PASSWORDS: '123456, temp-pass ' };
  assert.deepEqual(extraPasswords(env), ['123456', 'temp-pass']);
  assert.equal(await passwordMatches('main-token', env), true, '主密码不能被顶掉');
  assert.equal(await passwordMatches('123456', env), true, '额外口令要能登');
  assert.equal(await passwordMatches('temp-pass', env), true, '前后空格要 trim');
  assert.equal(await passwordMatches('123457', env), false);
  assert.equal(await passwordMatches('', env), false);
  // 没配 EXTRA_PASSWORDS 时不影响原有行为
  assert.deepEqual(extraPasswords({}), []);
  assert.deepEqual(extraPasswords({ EXTRA_PASSWORDS: '  ,  ' }), []);
  assert.equal(await passwordMatches('123456', { AUTH_TOKEN: 'main-token' }), false);
});
