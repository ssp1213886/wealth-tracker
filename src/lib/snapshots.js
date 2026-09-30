// 云端快照（方案 B）：清除全部数据之前，把当前所有数据行原样留一份。
// 这样即使清完就关掉页面、换了设备，也能从设置里恢复回来。
// 只存原始字符串（value），恢复时原样写回，不参与任何业务计算。
const KEEP_PER_USER = 5;

function summarize(payload) {
  const num = (v) => (Number(v) || 0);
  let trades = 0, options = 0, cash = 0;
  try { const t = JSON.parse(payload.trades); if (Array.isArray(t)) trades = t.length } catch { /* 忽略坏值 */ }
  try { const o = JSON.parse(payload.optionTrades); if (Array.isArray(o)) options = o.length } catch { /* 忽略坏值 */ }
  try { cash = num(JSON.parse(payload.cashBalance)) } catch { /* 忽略坏值 */ }
  return JSON.stringify({ trades, options, cash, keys: Object.keys(payload).length });
}

/** 把某个账号当前的数据行整体存成一份快照；没有数据就不存。返回 {id, createdAt, summary} 或 null。 */
export async function saveSnapshot(env, userId, reason) {
  const { results } = await env.DB.prepare('SELECT key, value FROM data WHERE user_id = ?').bind(userId).all();
  if (!results || !results.length) return null;
  const payload = {};
  results.forEach((row) => { payload[row.key] = row.value; });
  const summary = summarize(payload);
  const createdAt = Date.now();
  const ins = await env.DB.prepare(
    'INSERT INTO snapshots (user_id, payload, summary, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(userId, JSON.stringify(payload), summary, String(reason || ''), createdAt).run();
  const id = (ins && ins.meta && ins.meta.last_row_id) || 0;
  // 每个账号只留最近几份，免得把库撑大
  try {
    await env.DB.prepare(
      'DELETE FROM snapshots WHERE user_id = ? AND id NOT IN (SELECT id FROM snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)',
    ).bind(userId, userId, KEEP_PER_USER).run();
  } catch { /* 裁剪失败不影响本次快照 */ }
  return { id, createdAt, summary };
}

/** 列出最近几份快照（不带 payload，避免响应过大）。 */
export async function listSnapshots(env, userId, limit) {
  try {
    const n = Math.max(1, Math.min(20, Number(limit) || KEEP_PER_USER));
    const { results } = await env.DB.prepare(
      'SELECT id, summary, reason, created_at FROM snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    ).bind(userId, n).all();
    return {
      status: 200,
      body: {
        ok: true,
        snapshots: (results || []).map((r) => ({
          id: r.id, summary: r.summary || '', reason: r.reason || '', createdAt: r.created_at,
        })),
      },
    };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}

/** 把某份快照写回 data 表：快照里有的一律覆盖，现在多出来的键删掉（干净回到当时的样子）。 */
export async function restoreSnapshot(env, userId, id) {
  const snapId = Number(id);
  if (!Number.isFinite(snapId) || snapId <= 0) return { status: 400, body: { ok: false, error: 'Bad snapshot id' } };
  try {
    const row = await env.DB.prepare('SELECT payload FROM snapshots WHERE user_id = ? AND id = ?').bind(userId, snapId).first();
    if (!row) return { status: 404, body: { ok: false, error: 'Snapshot not found' } };
    let payload = {};
    try { payload = JSON.parse(row.payload) || {} } catch { return { status: 500, body: { ok: false, error: 'Bad snapshot payload' } } }
    const keys = Object.keys(payload);
    const ts = Date.now();
    const stmts = keys.map((k) => env.DB.prepare(
      'INSERT OR REPLACE INTO data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
    ).bind(userId, k, payload[k], ts));
    const existing = await env.DB.prepare('SELECT key FROM data WHERE user_id = ?').bind(userId).all();
    const keep = new Set(keys);
    (existing.results || []).forEach((r) => {
      if (!keep.has(r.key)) stmts.push(env.DB.prepare('DELETE FROM data WHERE user_id = ? AND key = ?').bind(userId, r.key));
    });
    if (stmts.length) await env.DB.batch(stmts);
    return { status: 200, body: { ok: true, restored: keys.length, ts } };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}
