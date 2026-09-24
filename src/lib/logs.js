const MAX_ROWS = 200;
const MAX_MESSAGE = 300;
const MAX_DETAIL = 1500;

let tableReady = false;

async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, version TEXT, message TEXT, detail TEXT, ua TEXT)',
  ).run();
  tableReady = true;
}

const clip = (value, max) =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// 前端错误上报：公开端点（启动期出错时还没有鉴权 token），靠限流 + 长度裁剪 + 只留最近 200 条兜底
export async function handleLog(request, env) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }

  const entry = {
    ts: Number(body && body.ts) || Date.now(),
    version: clip(body && body.version, 24),
    message: clip(body && body.message, MAX_MESSAGE),
    detail: clip(body && body.detail, MAX_DETAIL),
    ua: clip(body && body.ua, 200),
  };
  if (!entry.message) return { status: 400, body: { error: 'Missing message' } };

  try {
    await ensureTable(env);
    await env.DB.prepare('INSERT INTO logs (ts, version, message, detail, ua) VALUES (?, ?, ?, ?, ?)')
      .bind(entry.ts, entry.version, entry.message, entry.detail, entry.ua)
      .run();
    await env.DB.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)')
      .bind(MAX_ROWS)
      .run();
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}
