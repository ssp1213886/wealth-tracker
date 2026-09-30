// 「只取版本号」的轻量检查：打开 App 时先问一句"云端有没有变过"。
// 没变就不下载正文，省掉一次完整拉取；变了再走正常拉取。
// 只读 key + updated_at，不读 value，响应只有几百字节。
export async function handleSyncMeta(env, userId) {
  try {
    const { results } = await env.DB.prepare('SELECT key, updated_at FROM data WHERE user_id = ?').bind(userId).all();
    const meta = {};
    for (const row of results) meta[row.key] = row.updated_at;
    return { status: 200, body: { ok: true, userId, metaOnly: true, meta, ts: Date.now() } };
  } catch (error) {
    return { status: 502, body: { ok: false, error: 'DB error', detail: error.message } };
  }
}
