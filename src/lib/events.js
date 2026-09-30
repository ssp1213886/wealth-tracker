// 账号活动记录：谁什么时候登录过、什么时候同步过、做过什么管理动作。
//
// 只给主账号看全部、普通成员看自己 —— 权限判断在 worker 层，这里只管存取。
// 写入是"尽力而为"：记不上不能影响登录/同步本身。

const KEEP_PER_USER = 200;
const KEEP_DAYS = 90;

export async function ensureEventsTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT \'\')',
  ).run();
}

/** 记一条活动。失败就算了（绝不能让"记日志"把登录/同步搞挂）。 */
export async function logEvent(env, userId, kind, detail) {
  try {
    await ensureEventsTable(env);
    await env.DB.prepare('INSERT INTO events (user_id, ts, kind, detail) VALUES (?, ?, ?, ?)')
      .bind(Number(userId), Date.now(), String(kind).slice(0, 24), String(detail || '').slice(0, 120))
      .run();
  } catch (error) {
    // 忽略
  }
}

/**
 * 同步很频繁（可见时每分钟一次），别每次都记。
 * 同一个账号同一类事件 30 分钟内只留一条。
 */
export async function logEventThrottled(env, userId, kind, detail, windowMs = 30 * 60 * 1000) {
  try {
    await ensureEventsTable(env);
    const last = await env.DB.prepare('SELECT ts FROM events WHERE user_id = ? AND kind = ? ORDER BY ts DESC LIMIT 1')
      .bind(Number(userId), String(kind)).first();
    if (last && Date.now() - Number(last.ts) < windowMs) return;
    await logEvent(env, userId, kind, detail);
  } catch (error) {
    // 忽略
  }
}

/** 最近的活动：给 userId 就只看他的，不给就是全部（仅主账号会这么调）。 */
export async function recentEvents(env, options = {}) {
  await ensureEventsTable(env);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 40));
  try {
    const rows = options.userId
      ? await env.DB.prepare(
        'SELECT e.id, e.user_id, e.ts, e.kind, e.detail, a.username FROM events e LEFT JOIN accounts a ON a.id = e.user_id WHERE e.user_id = ? ORDER BY e.ts DESC LIMIT ?',
      ).bind(Number(options.userId), limit).all()
      : await env.DB.prepare(
        'SELECT e.id, e.user_id, e.ts, e.kind, e.detail, a.username FROM events e LEFT JOIN accounts a ON a.id = e.user_id ORDER BY e.ts DESC LIMIT ?',
      ).bind(limit).all();
    return rows.results || [];
  } catch (error) {
    return [];
  }
}

/** 顺手清理：每账号只留最近 200 条、超过 90 天的删掉。偶尔调一次就行。 */
export async function pruneEvents(env) {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000),
      env.DB.prepare(
        'DELETE FROM events WHERE id NOT IN (SELECT id FROM events e WHERE e.user_id = events.user_id ORDER BY ts DESC LIMIT ' + KEEP_PER_USER + ')',
      ),
    ]);
  } catch (error) {
    // 忽略
  }
}
