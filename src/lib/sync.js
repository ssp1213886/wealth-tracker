import { SYNC_KEYS } from './http.js';

const MAX_KEYS = 50;
const MAX_VALUE_LENGTH = 512 * 1024;

async function readPayload(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: { status: 400, body: { error: 'Invalid JSON' } } };
  }
}

export async function handleSyncGet(env) {
  try {
    const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM data').all();
    const data = {};
    const meta = {};
    for (const row of results) {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch {
        data[row.key] = row.value;
      }
      meta[row.key] = row.updated_at;
    }
    return { status: 200, body: { ok: true, data, ts: Date.now(), meta } };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}

export async function handleSyncPost(request, env) {
  const payload = await readPayload(request);
  if (payload.error) return payload.error;

  const body = payload.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: 'Invalid payload' } };
  }

  const expectedVersions = body.__expectedVersions;
  if (expectedVersions !== undefined) {
    if (typeof expectedVersions !== 'object' || expectedVersions === null || Array.isArray(expectedVersions)) {
      return { status: 400, body: { error: 'Invalid expected versions' } };
    }
    for (const [key, value] of Object.entries(expectedVersions)) {
      if (!SYNC_KEYS.has(key) || !Number.isFinite(Number(value))) {
        return { status: 400, body: { error: 'Bad expected version: ' + key } };
      }
    }
  }

  const entries = Object.entries(body).filter(([key]) => key !== '__expectedVersions');
  if (entries.length > MAX_KEYS) return { status: 400, body: { error: 'Too many keys' } };

  const statements = [];
  const syncTs = Date.now();
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || key.length > 64 || !/^[a-zA-Z0-9_\-.]+$/.test(key)) {
      return { status: 400, body: { error: 'Bad key: ' + key } };
    }
    if (!SYNC_KEYS.has(key)) return { status: 400, body: { error: 'Unknown key: ' + key } };

    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_VALUE_LENGTH) {
      return { status: 400, body: { error: 'Value too large for key: ' + key } };
    }
    statements.push(env.DB.prepare(
      'INSERT OR REPLACE INTO data (key, value, updated_at) VALUES (?, ?, ?)',
    ).bind(key, serialized, syncTs));
  }

  try {
    if (expectedVersions) {
      const keys = Object.keys(expectedVersions);
      if (keys.length > 0) {
        const placeholders = keys.map(() => '?').join(',');
        const { results } = await env.DB.prepare(
          `SELECT key, updated_at FROM data WHERE key IN (${placeholders})`,
        ).bind(...keys).all();
        const currentVersions = Object.fromEntries(results.map((row) => [row.key, row.updated_at]));
        const conflicts = keys.filter((key) => {
          // 云端根本没有这一行（全新库、被重置、或该键从未推过）→ 不算冲突，
          // 否则客户端带着任何版本号来推都会被拒，等于永久假冲突。
          if (currentVersions[key] === undefined) return false;
          return Number(currentVersions[key]) !== Number(expectedVersions[key]);
        });
        if (conflicts.length > 0) {
          return {
            status: 409,
            body: { ok: false, error: 'Version conflict', conflicts, currentVersions },
          };
        }
      }
    }

    if (statements.length > 0) await env.DB.batch(statements);
    return { status: 200, body: { ok: true, saved: statements.length, ts: syncTs } };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}
