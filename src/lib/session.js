// 登录会话：无状态签名 cookie（HMAC-SHA256），服务端不需要 KV。
//
// 密码 = 现有的 AUTH_TOKEN（用户的同步令牌）——**不新增 secret**，只需要记一个东西。
// cookie 里只有「过期时间 + 签名」，没有密码本身；改 AUTH_TOKEN 会让所有会话立即失效。

const COOKIE_NAME = 'wt_session';
const UID_COOKIE = 'wt_uid';
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天

function toBase64Url(bytes) {
  const view = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < view.length; i += 1) text += String.fromCharCode(view[i]);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '==='.slice((padded.length + 3) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * 登录密码：优先 APP_PASSWORD，没配就沿用老的 AUTH_TOKEN。
 * 想换密码只 `npx wrangler secret put APP_PASSWORD`，不用改代码。
 */
export function loginPassword(env) {
  return (env && (env.APP_PASSWORD || env.AUTH_TOKEN)) || '';
}

/**
 * 额外的临时/测试密码（逗号分隔，来自 EXTRA_PASSWORDS secret）。
 * 用途：临时开一个口令给别的设备用，不想把主密码说出去；测完
 * `npx wrangler secret delete EXTRA_PASSWORDS` 就立刻失效。
 * ⚠️ 短口令（比如 6 位数字）只靠登录限流挡爆破，别长期留着。
 */
export function extraPasswords(env) {
  return String((env && env.EXTRA_PASSWORDS) || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 会话签名用的密钥：优先 SESSION_SECRET，没配就用登录密码本身。 */
export function sessionSecret(env) {
  return (env && (env.SESSION_SECRET || loginPassword(env))) || '';
}

/**
 * 登录成功后签发会话。
 * payload = `userId:过期时间`，签名覆盖两者 —— 服务器无状态，但能知道"你是谁"。
 * 服务器没配密钥时返回 null（此时门禁自动关闭，免得把主人锁在门外）。
 */
export async function issueSession(env, userId, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  if (!Number.isFinite(Number(userId))) return null;
  const payload = Number(userId) + ':' + (now + TTL_MS);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload));
  return { value: payload + '.' + toBase64Url(signature), maxAge: Math.floor(TTL_MS / 1000) };
}

export function sessionCookie(value, maxAge) {
  return COOKIE_NAME + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

export function clearSessionCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

/**
 * 给前端看的账号 id（**故意不加 HttpOnly**）。
 * 前端要在同步读取 localStorage 之前就知道"该读哪个账号的空间"，只能靠一个可读 cookie。
 * 它只是标识，不是凭证：服务端永远只认签过名的 wt_session，改这个 cookie 只会让自己读到别的本地空间。
 */
export function uidCookie(userId, maxAge) {
  return UID_COOKIE + '=' + Number(userId) + '; Path=/; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

export function clearUidCookie() {
  return UID_COOKIE + '=; Path=/; Secure; SameSite=Lax; Max-Age=0';
}

function readCookie(header, name) {
  const parts = String(header || '').split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const item = parts[i].trim();
    if (item.slice(0, name.length) === name && item.charAt(name.length) === '=') return item.slice(name.length + 1);
  }
  return '';
}

/** 会话有效就返回 { userId }，否则返回 null。crypto.subtle.verify 是常数时间比较。 */
export async function readSession(request, env, now = Date.now()) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const raw = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const split = payload.lastIndexOf(':');
  if (split <= 0) return null;
  const userId = Number(payload.slice(0, split));
  const expires = Number(payload.slice(split + 1));
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(expires) || expires <= now) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(raw.slice(dot + 1)),
      new TextEncoder().encode(payload),
    );
    return valid ? { userId } : null;
  } catch (error) {
    return null;
  }
}

/** 密码比对：先把两边都哈希再逐字节比，避免"长度不同就提前返回"这种时间差。 */
export async function passwordMatches(input, env) {
  const candidates = [loginPassword(env)].concat(extraPasswords(env)).filter(Boolean);
  if (!candidates.length) return false;
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const given = await digest(String(input || ''));
  let matched = false;
  // 不提前 return：否则响应时间会泄露"命中的是第几个密码"
  for (const candidate of candidates) {
    const expected = await digest(candidate);
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ given[i];
    if (diff === 0) matched = true;
  }
  return matched;
}
