// v373 数据迁移单测：第三腿 Grayscale BTC ETF → iShares IBIT（**按比例换算股数**）。
// 重点钉住四件事：① 股数换算 + 成本不变 ② watchlist/prices 的旧代码清干净
// ③ 迁移前本机留备份 ④ 幂等（重复跑不会二次换算）。
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { memory.set(key, String(value)); },
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

const { KEYS, readRaw, writeRaw, runMigrations } = await import('../src/app/store.js');
const { BTC_TO_IBIT_SHARES, convertLegacyBtcTrade } = await import('../src/app/util.js');

const RATIO = BTC_TO_IBIT_SHARES;

function seed() {
  memory.clear();
  writeRaw(KEYS.schema, '2');
  writeRaw(KEYS.trades, JSON.stringify([
    { id: 1, symbol: 'BTC', date: '2026-03-10', time: '10:00', shares: 40, price: 30, type: 'buy', tag: '' },
    { id: 2, symbol: 'VGT', date: '2026-04-10', time: '10:00', shares: 1, price: 100, type: 'buy', tag: '' },
    { id: 3, symbol: 'BTC', date: '2026-05-10', time: '10:00', shares: -10, price: 44, type: 'sell', tag: 'assign' },
  ]));
  writeRaw(KEYS.watchlist, JSON.stringify([
    { sym: 'BTC', kind: 'crypto', enabled: true, order: 2 },
    { sym: 'BTCETF', kind: 'stock', enabled: true, order: 3 },
  ]));
  writeRaw(KEYS.prices, JSON.stringify({ BTC: { price: 36.39, source: 'yahoo' }, VGT: { price: 108.62 } }));
}

test('convertLegacyBtcTrade：股数 × r、价格 ÷ r —— 每笔的"股数 × 价格"（成本）一分不差', () => {
  const out = convertLegacyBtcTrade({ symbol: 'BTC', shares: 40, price: 30 });
  assert.equal(out.symbol, 'IBIT');
  assert.ok(Math.abs(out.shares - 40 * RATIO) < 1e-6, '股数按比例缩小');
  assert.ok(Math.abs(out.shares * out.price - 40 * 30) < 1e-3, '成本必须保持不变');
  // 非 BTC 行原样返回（同一个对象引用，便于调用方判断"有没有命中"）
  const vgt = { symbol: 'VGT', shares: 1, price: 100 };
  assert.equal(convertLegacyBtcTrade(vgt), vgt);
  // 脏数据只改代码，不硬算
  assert.deepEqual(convertLegacyBtcTrade({ symbol: 'BTC', shares: 0, price: 0 }), { symbol: 'IBIT', shares: 0, price: 0 });
});

test('迁移 v2→v3：trades 换算成 IBIT、watchlist/prices 清掉旧代码、留备份、标脏', () => {
  seed();
  const before = readRaw(KEYS.trades);
  runMigrations(() => {});

  const trades = JSON.parse(readRaw(KEYS.trades));
  assert.equal(trades[0].symbol, 'IBIT');
  assert.ok(Math.abs(trades[0].shares - 40 * RATIO) < 1e-6);
  assert.ok(Math.abs(trades[0].shares * trades[0].price - 1200) < 1e-3, '第一笔成本 1200 不变');
  assert.equal(trades[1].symbol, 'VGT', '别的标的不能动');
  assert.equal(trades[2].symbol, 'IBIT');
  assert.equal(trades[2].shares < 0, true, '卖出仍是负股数（方向不变）');
  assert.ok(Math.abs(trades[2].shares * trades[2].price - -440) < 1e-3, '卖出金额也保持不变');

  const watch = JSON.parse(readRaw(KEYS.watchlist)).map((x) => x.sym);
  assert.deepEqual(watch, ['BTC', 'IBIT'], 'BTCETF → IBIT；加密现货那行不动');

  const prices = JSON.parse(readRaw(KEYS.prices));
  assert.equal(Object.prototype.hasOwnProperty.call(prices, 'BTC'), false,
    'Mini Trust 的缓存价不能改名给 IBIT 用（价不是一回事），直接删掉让下次重新取');
  assert.ok(prices.VGT, '别的缓存不动');

  const backup = JSON.parse(readRaw('wealth_pre_ibit_migration_v1'));
  assert.equal(backup.data[KEYS.trades], before, '备份里存的是迁移前的原始值');
  assert.match(readRaw('wealth_ibit_migration_dirty_v1'), /wealth_trades_v2/);
});

test('迁移幂等：第二次跑不会把 IBIT 再换算一遍', () => {
  seed();
  runMigrations(() => {});
  const once = readRaw(KEYS.trades);
  /* 把 schema 退回 2 再跑一次（模拟"重复迁移"这条路径） */
  writeRaw(KEYS.schema, '2');
  runMigrations(() => {});
  assert.equal(readRaw(KEYS.trades), once, '没有 BTC 可改 → 一个字节都不动');
});

test('takeIbitMigrationDirty：取一次就把标记清掉（避免每次启动都重复标脏）', async () => {
  const { takeIbitMigrationDirty } = await import('../src/app/store.js');
  seed();
  runMigrations(() => {});
  assert.deepEqual(takeIbitMigrationDirty(), [KEYS.trades, KEYS.watchlist, KEYS.prices]);
  assert.deepEqual(takeIbitMigrationDirty(), [], '第二次取是空的');
});
