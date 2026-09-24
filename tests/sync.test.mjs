// 云同步纯逻辑单测（src/app/sync.js）：payload 组装与错误分类。
// 这两块正是"云端已有更新"这类问题的高发区，抽出来之后可以离线验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncPayload, classifySyncError, SYNC_FIELDS } from '../src/app/sync.js';

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
  const payload = buildSyncPayload({
    dirtyOnly: false,
    cloudTs: { trades: 111, cashBalance: 222 },
    read: reader(sampleValues),
    readPrices: () => ({ VGT: { price: 150 } }),
  });

  SYNC_FIELDS.forEach((key) => {
    assert.ok(key in payload, '缺少字段 ' + key);
  });
  assert.deepEqual(payload.trades, [{ id: 1 }]);
  assert.equal(payload.cashBalance, 1500);
  assert.deepEqual(payload.prices, { VGT: { price: 150 } });
  assert.equal(payload.__expectedVersions.trades, 111);
  assert.equal(payload.__expectedVersions.cashBalance, 222);
  assert.equal(payload.__expectedVersions.optionTrades, 0, '没记录过云端版本时按 0 处理');
});

test('buildSyncPayload: 只推模式下仅带脏键', () => {
  const payload = buildSyncPayload({
    dirtyOnly: true,
    dirty: { trades: true },
    cloudTs: { trades: 5, cashLog: 9 },
    read: reader(sampleValues),
    readPrices: () => ({}),
  });

  assert.ok('trades' in payload);
  assert.ok(!('cashLog' in payload), '没改过的键不该推送');
  assert.ok(!('cashBalance' in payload));
  assert.deepEqual(Object.keys(payload.__expectedVersions), ['trades']);
  assert.equal(payload.__expectedVersions.trades, 5);
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
