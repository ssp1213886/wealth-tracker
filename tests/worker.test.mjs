import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import worker from '../src/worker.js';

function createDb(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key, value]) => [key, {
    key,
    value: JSON.stringify(value),
    updated_at: 1000,
  }]));

  const execute = (sql, args) => {
    if (sql.startsWith('SELECT key, value, updated_at')) {
      return { results: [...rows.values()] };
    }
    if (sql.startsWith('SELECT key, updated_at')) {
      return { results: [...rows.values()].filter((row) => args.includes(row.key)) };
    }
    if (sql.startsWith('INSERT OR REPLACE')) {
      const [key, value, updated_at] = args;
      rows.set(key, { key, value, updated_at });
      return { success: true };
    }
    return { results: [] };
  };

  const statement = (sql) => {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      all: async () => execute(sql, args),
      run: async () => execute(sql, args),
    };
  };

  return {
    rows,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const item of statements) await item.run();
      return statements.map(() => ({ success: true }));
    },
  };
}

const env = (db) => ({
  AUTH_TOKEN: 'secret',
  DB: db,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
});
const request = (path, options = {}) => new Request('https://example.com' + path, options);

test('rejects sync without auth token', async () => {
  const response = await worker.fetch(request('/api/sync'), env(createDb()));
  assert.equal(response.status, 401);
});

test('returns CORS preflight headers', async () => {
  const response = await worker.fetch(request('/api/sync', { method: 'OPTIONS' }), env(createDb()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Max-Age'), '86400');
});

test('rejects unsupported price symbols and methods', async () => {
  const testEnv = env(createDb());
  assert.equal((await worker.fetch(request('/api/price?symbol=BAD'), testEnv)).status, 400);
  assert.equal((await worker.fetch(request('/api/price?symbol=VGT', { method: 'POST' }), testEnv)).status, 405);
});

test('validates sync payload and key whitelist', async () => {
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const badKey = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ bad: [] }),
  }), env(createDb()));
  assert.equal(badKey.status, 400);

  const invalidJson = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: '{',
  }), env(createDb()));
  assert.equal(invalidJson.status, 400);
});

test('stores valid sync payloads', async () => {
  const db = createDb();
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST', headers, body: JSON.stringify({ trades: [] }),
  }), env(db));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 1);
  assert.deepEqual(JSON.parse(db.rows.get('trades').value), []);
});

test('returns 409 when expected version is stale', async () => {
  const db = createDb({ trades: [] });
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [], __expectedVersions: { trades: 999 } }),
  }), env(db));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.deepEqual(body.conflicts, ['trades']);
  assert.equal(body.currentVersions.trades, 1000);
});

test('does not 409 when the cloud has no row for that key yet', async () => {
  // 全新库（或被重置）时，客户端带着任何版本号来推都应当直接建立基线，
  // 否则用户会看到永远消不掉的假冲突。
  const db = createDb();
  const headers = { 'Content-Type': 'application/json', 'X-Auth-Token': 'secret' };
  const response = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      trades: [{ id: 1 }],
      cashBalance: 3000,
      __expectedVersions: { trades: 1790275460093, cashBalance: 1790275486762 },
    }),
  }), env(db));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, 2);

  // 已有行 + 旧版本号，仍然要拦住
  const stale = await worker.fetch(request('/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({ trades: [{ id: 2 }], __expectedVersions: { trades: 1 } }),
  }), env(db));
  assert.equal(stale.status, 409);
});
