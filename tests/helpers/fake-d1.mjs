// 测试用的内存版 D1：按 worker 实际发出的 SQL 形状路由。
// 抽成共用模块，避免几个测试文件各写一份、改一处忘一处。

export function createFakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key, value]) => ['1|' + key, {
    user_id: 1,
    key,
    value: JSON.stringify(value),
    updated_at: 1000,
  }]));
  const accounts = [];
  const events = [];
  const snapshots = [];
  const maStates = [];
  const maEvents = [];

  const route = (sql, args) => {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (q.startsWith('CREATE TABLE IF NOT EXISTS accounts')) return { results: [], success: true };
    if (q.startsWith('CREATE TABLE IF NOT EXISTS events')) return { results: [], success: true };
    if (q.startsWith('CREATE TABLE IF NOT EXISTS snapshots')) return { results: [], success: true };
    if (q.startsWith('CREATE TABLE IF NOT EXISTS ma_cross_state')) return { results: [], success: true };
    if (q.startsWith('CREATE TABLE IF NOT EXISTS ma_cross_events')) return { results: [], success: true };
    if (q.startsWith('CREATE INDEX')) return { results: [], success: true };
    if (q.startsWith('INSERT INTO snapshots')) {
      const [user_id, payload, summary, reason, created_at] = args;
      const id = snapshots.reduce((max, s) => Math.max(max, s.id), 0) + 1;
      snapshots.push({ id, user_id: Number(user_id), payload, summary, reason, created_at: Number(created_at) });
      return { results: [], success: true, meta: { last_row_id: id } };
    }
    if (q.startsWith('DELETE FROM snapshots WHERE user_id = ? AND id NOT IN')) {
      // 测试里不真裁剪（只验证 SQL 能被识别）
      return { results: [], success: true };
    }
    if (q.startsWith('SELECT id, summary, reason, created_at FROM snapshots')) {
      const list = snapshots
        .filter((s) => s.user_id === Number(args[0]))
        .sort((a, b) => b.created_at - a.created_at);
      const limit = Number(args[1]) || 5;
      return { results: list.slice(0, limit) };
    }
    if (q.startsWith('SELECT payload FROM snapshots WHERE user_id = ? AND id = ?')) {
      const hit = snapshots.filter((s) => s.user_id === Number(args[0]) && s.id === Number(args[1]))[0];
      return { results: hit ? [{ payload: hit.payload }] : [] };
    }
    if (q.startsWith('SELECT key, value FROM data WHERE user_id = ?')) {
      const userId = Number(args[0]);
      return { results: [...rows.values()].filter((row) => row.user_id === userId).map((row) => ({ key: row.key, value: row.value })) };
    }
    if (q.startsWith('SELECT key FROM data WHERE user_id = ?')) {
      const userId = Number(args[0]);
      return { results: [...rows.values()].filter((row) => row.user_id === userId).map((row) => ({ key: row.key })) };
    }
    if (q.startsWith('DELETE FROM data WHERE user_id = ? AND key = ?')) {
      rows.delete(Number(args[0]) + '|' + args[1]);
      return { results: [], success: true };
    }
    if (q.startsWith('INSERT INTO events')) {
      const [user_id, ts, kind, detail] = args;
      events.push({ id: events.length + 1, user_id: Number(user_id), ts: Number(ts), kind: String(kind), detail: String(detail || '') });
      return { results: [], success: true, meta: { last_row_id: events.length } };
    }
    if (q.startsWith('SELECT ts FROM events WHERE user_id = ? AND kind = ?')) {
      const list = events
        .filter((e) => e.user_id === Number(args[0]) && e.kind === args[1])
        .sort((a, b) => b.ts - a.ts);
      return { results: list.slice(0, 1) };
    }
    if (q.startsWith('SELECT e.id, e.user_id, e.ts, e.kind, e.detail, a.username FROM events e')) {
      const forUser = q.indexOf('WHERE e.user_id = ?') >= 0;
      const list = (forUser ? events.filter((e) => e.user_id === Number(args[0])) : events.slice())
        .sort((a, b) => b.ts - a.ts);
      const limit = Number(args[forUser ? 1 : 0]) || 40;
      return {
        results: list.slice(0, limit).map((e) => Object.assign({}, e, {
          username: (accounts.filter((a) => a.id === e.user_id)[0] || {}).username || ('#' + e.user_id),
        })),
      };
    }
    if (q.startsWith('DELETE FROM events WHERE ts < ?')) {
      const cutoff = Number(args[0]);
      for (let i = events.length - 1; i >= 0; i -= 1) if (events[i].ts < cutoff) events.splice(i, 1);
      return { results: [], success: true };
    }
    if (q.startsWith('DELETE FROM events WHERE id NOT IN')) {
      // 测试里不真的裁剪（只验证 SQL 能被识别）
      return { results: [], success: true };
    }
    if (q.startsWith('SELECT COUNT(*) AS n FROM accounts')) return { results: [{ n: accounts.length }] };
    if (q.startsWith('SELECT * FROM accounts WHERE username = ?')) {
      return { results: accounts.filter((a) => a.username === args[0]) };
    }
    if (q.startsWith('SELECT * FROM accounts WHERE id = ?')) {
      return { results: accounts.filter((a) => a.id === Number(args[0])) };
    }
    if (q.startsWith('SELECT id, username, role, disabled, created_at, last_seen_at FROM accounts')) {
      return { results: accounts.map((a) => ({
        id: a.id, username: a.username, role: a.role, disabled: a.disabled,
        created_at: a.created_at, last_seen_at: a.last_seen_at,
      })) };
    }
    if (q.startsWith('SELECT id FROM accounts WHERE disabled = 0')) {
      return { results: accounts.filter((a) => !Number(a.disabled)).map((a) => ({ id: a.id })) };
    }
    if (q.startsWith('INSERT INTO accounts (id,')) {
      const [id, username, name, pass_hash, salt, created_at, role] = args;
      accounts.push({ id: Number(id), username, name, pass_hash, salt, created_at, role: role || 'member', disabled: 0, last_seen_at: 0, token_version: 0 });
      return { results: [], success: true, meta: { last_row_id: Number(id) } };
    }
    if (q.startsWith('INSERT INTO accounts (username,')) {
      const [username, name, pass_hash, salt, created_at, role] = args;
      if (accounts.some((a) => a.username === username)) {
        throw new Error('UNIQUE constraint failed: accounts.username');
      }
      const id = accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1;
      accounts.push({ id, username, name, pass_hash, salt, created_at, role: role || 'member', disabled: 0, last_seen_at: 0, token_version: 0 });
      return { results: [], success: true, meta: { last_row_id: id } };
    }
    if (q.startsWith('UPDATE accounts SET last_seen_at')) {
      const found = accounts.filter((a) => a.id === Number(args[1]))[0];
      if (found) found.last_seen_at = args[0];
      return { results: [], success: true };
    }
    if (q.startsWith('UPDATE accounts SET pass_hash')) {
      const found = accounts.filter((a) => a.id === Number(args[2]))[0];
      if (found) {
        found.pass_hash = args[0];
        found.salt = args[1];
        found.token_version += 1;
      }
      return { results: [], success: true };
    }
    if (q.startsWith('UPDATE accounts SET disabled')) {
      const found = accounts.filter((a) => a.id === Number(args[1]))[0];
      if (found) found.disabled = args[0] ? 1 : 0;
      return { results: [], success: true };
    }
    if (q.startsWith('DELETE FROM data WHERE user_id = ?')) {
      const userId = Number(args[0]);
      [...rows.keys()].forEach((key) => {
        if (rows.get(key).user_id === userId) rows.delete(key);
      });
      return { results: [], success: true };
    }
    if (q.startsWith('DELETE FROM accounts WHERE id = ?')) {
      const at = accounts.findIndex((a) => a.id === Number(args[0]));
      if (at >= 0) accounts.splice(at, 1);
      return { results: [], success: true };
    }
    if (q.startsWith('DELETE FROM ma_cross_events WHERE user_id = ?')) {
      const userId = Number(args[0]);
      for (let i = maEvents.length - 1; i >= 0; i -= 1) if (maEvents[i].user_id === userId) maEvents.splice(i, 1);
      return { results: [], success: true };
    }
    if (q.startsWith('DELETE FROM ma_cross_state WHERE user_id = ?')) {
      const userId = Number(args[0]);
      for (let i = maStates.length - 1; i >= 0; i -= 1) if (maStates[i].user_id === userId) maStates.splice(i, 1);
      return { results: [], success: true };
    }
    if (q.startsWith('SELECT user_id, symbol, period, side, price, average, observed_at FROM ma_cross_state')) {
      return { results: maStates.slice() };
    }
    if (q.startsWith('INSERT INTO ma_cross_events')) {
      const [user_id, symbol, period, from_side, to_side, price, average, triggered_at] = args;
      const row = {
        id: maEvents.reduce((max, e) => Math.max(max, e.id), 0) + 1,
        user_id: Number(user_id), symbol, period: Number(period), from_side, to_side,
        price: Number(price), average: Number(average), triggered_at: Number(triggered_at), acked_at: null,
      };
      maEvents.push(row);
      return { results: [], success: true, meta: { last_row_id: row.id } };
    }
    if (q.startsWith('INSERT INTO ma_cross_state')) {
      const [user_id, symbol, period, side, price, average, observed_at] = args;
      const userId = Number(user_id);
      const periodNum = Number(period);
      const found = maStates.filter((s) => s.user_id === userId && s.symbol === symbol && s.period === periodNum)[0];
      const row = {
        user_id: userId, symbol, period: periodNum, side, price: Number(price),
        average: Number(average), observed_at: Number(observed_at),
      };
      if (found) Object.assign(found, row);
      else maStates.push(row);
      return { results: [], success: true };
    }
    if (q.startsWith('SELECT id, symbol, period, from_side, to_side, price, average, triggered_at FROM ma_cross_events')) {
      const userId = Number(args[0]);
      const limit = Number(args[1]) || 20;
      return { results: maEvents
        .filter((e) => e.user_id === userId && !e.acked_at)
        .sort((a, b) => b.triggered_at - a.triggered_at || b.id - a.id)
        .slice(0, limit) };
    }
    if (q.startsWith('UPDATE ma_cross_events SET acked_at = ?')) {
      const [acked_at, id, user_id] = args;
      const found = maEvents.filter((e) => e.id === Number(id) && e.user_id === Number(user_id) && !e.acked_at)[0];
      if (found) found.acked_at = Number(acked_at);
      return { results: [], success: true, meta: { changes: found ? 1 : 0 } };
    }
    if (q.startsWith('SELECT key, value, updated_at FROM data WHERE user_id = ?')) {
      const userId = Number(args[0]);
      return { results: [...rows.values()].filter((row) => row.user_id === userId) };
    }
    if (q.startsWith('SELECT key, updated_at FROM data WHERE user_id = ? AND key IN')) {
      const userId = Number(args[0]);
      const wanted = new Set(args.slice(1));
      return { results: [...rows.values()]
        .filter((row) => row.user_id === userId && wanted.has(row.key))
        .map((row) => ({ key: row.key, updated_at: row.updated_at })) };
    }
    if (q.startsWith('SELECT user_id, COUNT(*) AS n FROM data')) {
      const counts = {};
      [...rows.values()].forEach((row) => { counts[row.user_id] = (counts[row.user_id] || 0) + 1; });
      return { results: Object.keys(counts).map((userId) => ({ user_id: Number(userId), n: counts[userId] })) };
    }
    if (q.startsWith('INSERT OR REPLACE INTO data')) {
      const [user_id, key, value, updated_at] = args;
      rows.set(user_id + '|' + key, { user_id: Number(user_id), key, value, updated_at });
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
    rows,
    accounts,
    events,
    snapshots,
    maStates,
    maEvents,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const item of statements) await item.run();
      return statements.map(() => ({ success: true }));
    },
  };
}
