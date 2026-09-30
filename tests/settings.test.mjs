// 设置抽屉 / 云同步健康面板的纯逻辑单测（v239 从 index.js 抽出）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_PANEL_IDS, SETTINGS_FOCUS_IDS, parseSyncConfig, syncHealthSummary } from '../src/app/settings.js';

test('面板映射：七个面板 + 两个聚焦目标', () => {
  assert.deepEqual(Object.keys(SETTINGS_PANEL_IDS).sort(), ['account', 'activity', 'data', 'preferences', 'price', 'sync', 'users']);
  assert.equal(SETTINGS_PANEL_IDS.users, 'settingsUsers');
  assert.equal(SETTINGS_PANEL_IDS.activity, 'settingsActivity');
  assert.equal(SETTINGS_PANEL_IDS.sync, 'settingsSync');
  assert.equal(SETTINGS_PANEL_IDS.account, 'settingsAccount');
  assert.deepEqual(SETTINGS_FOCUS_IDS, { price: 'hmManualSym', preferences: 'monthlyDCAInput' });
});

test('parseSyncConfig：正常读取，缺字段补空串', () => {
  assert.deepEqual(parseSyncConfig('{"url":"https://x.dev","token":"abc"}'), { url: 'https://x.dev', token: 'abc' });
  assert.deepEqual(parseSyncConfig('{"url":"https://x.dev"}'), { url: 'https://x.dev', token: '' });
  assert.deepEqual(parseSyncConfig('{"token":"abc"}'), { url: '', token: 'abc' });
});

test('parseSyncConfig：坏 JSON / null / 空串都回落默认（不能抛）', () => {
  assert.deepEqual(parseSyncConfig('{'), { url: '', token: '' });
  assert.deepEqual(parseSyncConfig('null'), { url: '', token: '' });
  assert.deepEqual(parseSyncConfig(''), { url: '', token: '' });
  assert.deepEqual(parseSyncConfig(undefined), { url: '', token: '' });
  assert.deepEqual(parseSyncConfig('"just-a-string"'), { url: '', token: '' });
});

const fixedTime = (ts) => 'T' + ts;
const baseState = { dirty: {}, cloudTs: {}, pendingConflicts: [], lastSyncAt: 0, lastSyncErrorAt: 0, lastPushAt: 0, lastPullAt: 0 };

test('syncHealthSummary：判定优先级 冲突 > 失败 > 未配置 > 待同步 > 正常', () => {
  const conflict = syncHealthSummary({ ...baseState, pendingConflicts: ['trades'], dirty: { trades: true } }, { configured: true, formatTime: fixedTime });
  assert.equal(conflict.stateText, '1项冲突');
  assert.equal(conflict.mobileText, '发现数据冲突');
  assert.equal(conflict.conflictText, '1项待处理');

  const failed = syncHealthSummary({ ...baseState, lastSyncAt: 100, lastSyncErrorAt: 200 }, { configured: true, formatTime: fixedTime });
  assert.equal(failed.stateText, '同步需重试');
  assert.equal(failed.failed, true);

  const unconfigured = syncHealthSummary({ ...baseState, dirty: { trades: true } }, { configured: false });
  assert.equal(unconfigured.stateText, '本地保存');
  assert.equal(unconfigured.mobileText, '本地已保存');
  assert.equal(unconfigured.pullText, '尚未配置');
  assert.equal(unconfigured.pushText, '尚未配置');

  const dirty = syncHealthSummary({ ...baseState, dirty: { trades: true, cashLog: true } }, { configured: true, keys: ['trades', 'cashLog', 'state'] });
  assert.equal(dirty.dirtyCount, 2);
  assert.equal(dirty.stateText, '2项待同步');
  assert.equal(dirty.mobileText, '等待云同步');

  const ok = syncHealthSummary({ ...baseState, lastSyncAt: 500 }, { configured: true });
  assert.equal(ok.stateText, '云端正常');
  assert.equal(ok.mobileText, '云端已同步');

  const waiting = syncHealthSummary(baseState, { configured: true });
  assert.equal(waiting.stateText, '等待同步');
});

test('syncHealthSummary：时间文案（已下载/已上传/已导出 vs 尚未）', () => {
  const s = syncHealthSummary({ ...baseState, lastPullAt: 111, lastPushAt: 222 }, { configured: true, backupAt: 333, formatTime: fixedTime });
  assert.equal(s.pullText, 'T111');
  assert.equal(s.pushText, 'T222');
  assert.equal(s.backupText, 'T333');
  const empty = syncHealthSummary(baseState, { configured: true });
  assert.equal(empty.pullText, '尚未下载');
  assert.equal(empty.pushText, '尚未上传');
  assert.equal(empty.backupText, '尚未导出');
});

test('syncHealthSummary：dirty 只统计传入的键；脏数据不炸', () => {
  const s = syncHealthSummary({ dirty: { trades: true, watchlist: true, other: true } }, { configured: true, keys: ['trades', 'watchlist'] });
  assert.equal(s.dirtyCount, 2, '不在白名单里的键不参与计数');
  const bad = syncHealthSummary(null, {});
  assert.equal(bad.dirtyCount, 0);
  assert.equal(bad.stateText, '本地保存');
});
