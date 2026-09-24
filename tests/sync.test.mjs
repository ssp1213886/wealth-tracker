// 云同步纯逻辑单测（src/app/sync.js）：payload 组装与错误分类。
// 这两块正是"云端已有更新"这类问题的高发区，抽出来之后可以离线验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyncPayload,
  classifySyncError,
  normalizeSyncTs,
  syncContentEqual,
  SYNC_FIELDS,
} from '../src/app/sync.js';

const reader = (values) => {
  const read = {};
  Object.keys(values).forEach((key) => {
    read[key] = () => values[key];
  });
  return read;
};

const sampleValues = {
  trades: [{ id: 1 }],
  cashBalance: 1500,
  cashLog: [],
  state: { monthlyDCA: 2000 },
  activities: [],
  optionTrades: [],
  otmSettings: { vgt: 7, smh: 5 },
  exit_portfolio: '',
};

test('buildSyncPayload: 全量模式下带上所有同步键与版本戳', () => {
  const tradesTs = 1790274411112;
  const cashTs = 1790274667906;
  const payload = buildSyncPayload({
    dirtyOnly: false,
    cloudTs: { trades: tradesTs, cashBalance: cashTs },
    read: reader(sampleValues),
    readPrices: () => ({ VGT: { price: 150 } }),
  });

  SYNC_FIELDS.forEach((key) => {
    assert.ok(key in payload, '缺少字段 ' + key);
  });
  assert.deepEqual(payload.trades, [{ id: 1 }]);
  assert.equal(payload.cashBalance, 1500);
  assert.deepEqual(payload.prices, { VGT: { price: 150 } });
  assert.equal(payload.__expectedVersions.trades, tradesTs);
  assert.equal(payload.__expectedVersions.cashBalance, cashTs);
  assert.equal(
    'optionTrades' in payload.__expectedVersions,
    false,
    '不知道云端版本时必须不带期望值：带 0 等于宣称"云端没有这一行"，必然被判成假冲突',
  );
});

test('buildSyncPayload: 没有已知云端版本时不发期望值（0 会被服务端判成冲突）', () => {
  const payload = buildSyncPayload({
    dirtyOnly: true,
    dirty: { cashLog: true, cashBalance: true },
    cloudTs: { cashLog: 0, cashBalance: undefined },
    read: reader(sampleValues),
    readPrices: () => ({}),
  });

  assert.deepEqual(Object.keys(payload.__expectedVersions), [], '未知版本的两项都不该带期望值');
  assert.deepEqual(
    Object.keys(payload).filter((k) => k !== '__expectedVersions').sort(),
    ['cashBalance', 'cashLog', 'prices'],
  );
});

test('buildSyncPayload: 秒级旧版本号会被归一化成毫秒再带出去', () => {
  const payload = buildSyncPayload({
    dirtyOnly: true,
    dirty: { trades: true },
    cloudTs: { trades: 1790274667 },
    read: reader(sampleValues),
    readPrices: () => ({}),
  });

  assert.equal(payload.__expectedVersions.trades, 1790274667000);
});

test('buildSyncPayload: 只推模式下仅带脏键', () => {
  const tradesTs = 1790274411112;
  const payload = buildSyncPayload({
    dirtyOnly: true,
    dirty: { trades: true },
    cloudTs: { trades: tradesTs, cashLog: 1790274411000 },
    read: reader(sampleValues),
    readPrices: () => ({}),
  });

  assert.ok('trades' in payload);
  assert.ok(!('cashLog' in payload), '没改过的键不该推送');
  assert.ok(!('cashBalance' in payload));
  assert.deepEqual(Object.keys(payload.__expectedVersions), ['trades']);
  assert.equal(payload.__expectedVersions.trades, tradesTs);
});

test('buildSyncPayload: 没有任何脏键时只带价格与版本戳', () => {
  const payload = buildSyncPayload({
    dirtyOnly: true,
    dirty: {},
    read: reader(sampleValues),
    readPrices: () => ({ VGT: { price: 1 } }),
  });

  const keys = Object.keys(payload).filter((k) => k !== '__expectedVersions');
  assert.deepEqual(keys, ['prices']);
  assert.deepEqual(payload.__expectedVersions, {});
});

test('buildSyncPayload: 缺少读取函数时字段为 undefined 而不是抛错', () => {
  const payload = buildSyncPayload({ dirtyOnly: false, read: {}, readPrices: () => ({}) });
  SYNC_FIELDS.forEach((key) => assert.equal(payload[key], undefined));
  assert.deepEqual(payload.prices, {});
});

test('classifySyncError: 区分冲突、鉴权、限流与一般错误', () => {
  assert.equal(classifySyncError(409), 'conflict');
  assert.equal(classifySyncError(401), 'unauthorized');
  assert.equal(classifySyncError(429), 'throttled');
  assert.equal(classifySyncError(500), 'error');
  assert.equal(classifySyncError(undefined), 'error');
});

test('normalizeSyncTs: 秒与毫秒统一到毫秒，脏输入归零', () => {
  // 毫秒原样保留（曾经被截断成秒，导致"云端是否变过"永远为真）
  assert.equal(normalizeSyncTs(1790274667906), 1790274667906);
  // 秒级历史值（D1 早期的 notes/options 行就是这样）放大 1000
  assert.equal(normalizeSyncTs(1790274667), 1790274667000);
  assert.equal(normalizeSyncTs('1790274667'), 1790274667000);
  assert.equal(normalizeSyncTs(0), 0);
  assert.equal(normalizeSyncTs(undefined), 0);
  assert.equal(normalizeSyncTs(null), 0);
  assert.equal(normalizeSyncTs('abc'), 0);
  assert.equal(normalizeSyncTs(-1), 0);
});

test('syncContentEqual: 键序无关，state 先归一化再比', () => {
  assert.equal(syncContentEqual('trades', [{ id: 1, symbol: 'VGT' }], [{ symbol: 'VGT', id: 1 }]), true);
  assert.equal(syncContentEqual('trades', [{ id: 1 }], [{ id: 2 }]), false);
  assert.equal(syncContentEqual('cashLog', [], []), true);
  assert.equal(syncContentEqual('cashBalance', 34000, 34000), true);
  assert.equal(syncContentEqual('cashBalance', 34000, 32000), false);

  // state 走 normalizeState：缺字段与补了默认值的写法应当等价
  const normalizeState = (s) => ({
    monthlyDCA: s && s.monthlyDCA !== undefined ? s.monthlyDCA : 2000,
    roadmapStart: (s && s.roadmapStart) || '2025-01',
  });
  assert.equal(
    syncContentEqual('state', { monthlyDCA: 2000 }, { monthlyDCA: 2000, roadmapStart: '2025-01' }, normalizeState),
    true,
  );
  assert.equal(syncContentEqual('state', { monthlyDCA: 2000 }, { monthlyDCA: 3000 }, normalizeState), false);

  // 环形结构也不能把比较器绕死
  const loop = {};
  loop.self = loop;
  assert.equal(syncContentEqual('state', loop, loop), false);
});
