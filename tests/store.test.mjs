// 本地存储基础设施单测（src/app/store.js）
// 用一个内存版 localStorage 替身，覆盖读写容错、JSON 兜底、配额判断与迁移链。
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
let failWrites = false;

globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => {
    if (failWrites) {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    memory.set(key, String(value));
  },
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

const {
  KEYS, readRaw, writeRaw, removeKey, readJSON, writeJSON, isQuotaError, runMigrations, DATA_SCHEMA,
} = await import('../src/app/store.js');

const reset = () => {
  memory.clear();
  failWrites = false;
};

test('readRaw / writeRaw：基本读写', () => {
  reset();
  assert.equal(readRaw(KEYS.trades), null);
  assert.equal(writeRaw(KEYS.trades, 'hello'), true);
  assert.equal(readRaw(KEYS.trades), 'hello');
});

test('writeRaw：存储超限时返回 false 而不是抛错', () => {
  reset();
  failWrites = true;
  assert.equal(writeRaw(KEYS.trades, 'x'), false);
  failWrites = false;
  assert.equal(readRaw(KEYS.trades), null);
});

test('readJSON：无值 / 坏 JSON / null 都回退到默认值', () => {
  reset();
  assert.deepEqual(readJSON(KEYS.trades, []), []);
  assert.equal(writeRaw(KEYS.trades, '{not json'), true);
  assert.deepEqual(readJSON(KEYS.trades, []), []);
  assert.equal(writeRaw(KEYS.trades, 'null'), true);
  assert.deepEqual(readJSON(KEYS.trades, []), []);
  assert.equal(writeRaw(KEYS.trades, '{"a":1}'), true);
  assert.deepEqual(readJSON(KEYS.trades, {}), { a: 1 });
});

test('writeJSON：循环引用时返回 false 而不抛错', () => {
  reset();
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(writeJSON(KEYS.trades, cyclic), false);
  assert.equal(writeJSON(KEYS.trades, [1, 2, 3]), true);
  assert.deepEqual(readJSON(KEYS.trades, []), [1, 2, 3]);
});

test('removeKey：删除后读不到', () => {
  reset();
  writeRaw(KEYS.firstTime, '1');
  assert.equal(removeKey(KEYS.firstTime), true);
  assert.equal(readRaw(KEYS.firstTime), null);
});

test('isQuotaError：识别配额超限的各种表述', () => {
  const quota = new Error('x');
  quota.name = 'QuotaExceededError';
  assert.equal(isQuotaError(quota), true);
  assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true);
  assert.equal(isQuotaError(new Error('别的问题')), false);
  assert.equal(isQuotaError(null), false);
});

test('runMigrations：首次运行写入版本号并清理遗留键', () => {
  reset();
  writeRaw(KEYS.alertSeen, 'legacy-value');
  assert.equal(readRaw(KEYS.schema), null);

  const result = runMigrations();
  assert.equal(result, DATA_SCHEMA);
  assert.equal(readRaw(KEYS.schema), String(DATA_SCHEMA));
  assert.equal(readRaw(KEYS.alertSeen), null, '迁移应清掉遗留的已读标记');
});

test('runMigrations：已是最新版本时不重复执行', () => {
  reset();
  runMigrations();
  writeRaw(KEYS.alertSeen, '再次出现');
  runMigrations();
  assert.equal(readRaw(KEYS.alertSeen), '再次出现', '版本已最新时不应再跑迁移');
});

test('runMigrations：迁移出错时通过回调上报而不是抛出', () => {
  reset();
  const seen = [];
  const result = runMigrations((message, detail) => seen.push({ message, detail }));
  assert.equal(result, DATA_SCHEMA);
  assert.equal(seen.length, 0, '正常情况下不该有迁移错误');
});
