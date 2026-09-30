// 账号体系：用户名 + 密码（一个账号一份数据，互相看不到）。
//
// 密码怎么存：
//   库里存 hash = HMAC-SHA256(pepper, salt + ':' + password)，pepper 是 Worker secret。
//   为什么不用 PBKDF2/bcrypt：Cloudflare 免费版每次请求只有 10ms CPU，
//   10 万次迭代的 PBKDF2 要几十毫秒，会直接超限（error 1102）。
//   代价是：**光拿到数据库还不够**（没有 pepper 猜不动），但抗离线爆破弱于慢哈希。
//   实际防线靠：① pepper 不进数据库 ② 登录接口限流（10 分钟 12 次）。

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidUsername(value) {
  return USERNAME_RE.test(normalizeUsername(value));
}

/** 哈希用到的 pepper：优先 PASSWORD_PEPPER，没配就沿用已有的服务端密钥。 */
export function pepperOf(env) {
  return (env && (env.PASSWORD_PEPPER || env.SESSION_SECRET || env.AUTH_TOKEN)) || '';
}

function toHex(bytes) {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 1) out += view[i].toString(16).padStart(2, '0');
  return out;
}

export function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPassword(env, password, salt) {
  const pepper = pepperOf(env);
  if (!pepper) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(salt + ':' + String(password || '')));
  return toHex(signature);
}

/** 定长字符串比较（两边都是 hex 摘要，长度固定）。 */
export async function hashEquals(a, b) {
  const left = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(a || ''))));
  const right = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(b || ''))));
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function ensureAccountsTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT \'\', pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT \'member\', last_seen_at INTEGER NOT NULL DEFAULT 0, token_version INTEGER NOT NULL DEFAULT 0)',
  ).run();
}

export async function countAccounts(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first();
  return Number((row && row.n) || 0);
}

export async function findAccountByUsername(env, username) {
  return env.DB.prepare('SELECT * FROM accounts WHERE username = ?').bind(normalizeUsername(username)).first();
}

export async function listAccounts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, username, role, disabled, created_at, last_seen_at FROM accounts ORDER BY id',
  ).all();
  return results || [];
}

export async function findAccountById(env, id) {
  return env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(Number(id)).first();
}

/** 每个账号在云端有多少行数据（管理列表里显示"数据量"）。 */
export async function dataRowCounts(env) {
  const { results } = await env.DB.prepare('SELECT user_id, COUNT(*) AS n FROM data GROUP BY user_id').all();
  const out = {};
  (results || []).forEach((row) => { out[Number(row.user_id)] = Number(row.n) || 0; });
  return out;
}

/** 记一下最近登录时间（管理列表用）。 */
export async function touchLastSeen(env, id) {
  try {
    await env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(Date.now(), Number(id)).run();
  } catch (error) {
    // 记不上不影响登录
  }
}

/** 管理员重置密码：换新盐、重算哈希；同时把 token_version +1（让该账号其它设备的会话失效）。 */
export async function setAccountPassword(env, id, password) {
  const salt = randomSalt();
  const passHash = await hashPassword(env, password, salt);
  if (!passHash) return { error: 'not configured' };
  await env.DB.prepare(
    'UPDATE accounts SET pass_hash = ?, salt = ?, token_version = token_version + 1 WHERE id = ?',
  ).bind(passHash, salt, Number(id)).run();
  return { ok: true };
}

export async function setAccountDisabled(env, id, disabled) {
  await env.DB.prepare('UPDATE accounts SET disabled = ? WHERE id = ?').bind(disabled ? 1 : 0, Number(id)).run();
  return { ok: true };
}

/** 删除账号：连带删掉它的全部云端数据行（调用方负责先导出）。 */
export async function deleteAccount(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM data WHERE user_id = ?').bind(Number(id)),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(Number(id)),
  ]);
  return { ok: true };
}

/**
 * 建账号。explicitId 只在"首次引导建主账号"时传 1 —— 老数据挂在 user_id=1 名下，
 * 账号 id 必须和它对上，不能寄希望于自增序列刚好从 1 开始。
 */
export async function createAccount(env, username, password, options) {
  const opts = options || {};
  const explicitId = opts.id;
  const role = opts.role === 'owner' ? 'owner' : 'member';
  const handle = normalizeUsername(username);
  if (!isValidUsername(handle)) return { error: 'invalid username' };
  if (String(password || '').length < 6) return { error: 'password too short' };
  const salt = randomSalt();
  const passHash = await hashPassword(env, password, salt);
  if (!passHash) return { error: 'not configured' };
  try {
    const result = Number.isFinite(Number(explicitId))
      ? await env.DB.prepare(
        'INSERT INTO accounts (id, username, name, pass_hash, salt, created_at, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(Number(explicitId), handle, handle, passHash, salt, Date.now(), role).run()
      : await env.DB.prepare(
        'INSERT INTO accounts (username, name, pass_hash, salt, created_at, role) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(handle, handle, passHash, salt, Date.now(), role).run();
    return { id: Number(result.meta && result.meta.last_row_id) || null };
  } catch (error) {
    if (String(error && error.message).indexOf('UNIQUE') >= 0) return { error: 'username taken' };
    return { error: 'db error' };
  }
}

export async function verifyAccountPassword(env, account, password) {
  if (!account || !account.salt || !account.pass_hash) return false;
  const attempt = await hashPassword(env, password, account.salt);
  return hashEquals(attempt, account.pass_hash);
}
