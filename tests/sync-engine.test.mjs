// 云同步决策层单测（v240 从 index.js 抽出）：拉取逐键判定 + 409 核对计划。
// 这层是 v141「永远消不掉的假冲突」的所在地，现在用表格化的用例钉死每个分支。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePullAction, planPullSync, planConflictHeal,
  pushedKeysOf, pendingDirtyKeys, shouldSkipPush,
} from '../src/app/sync-engine.js';

test('decidePullAction：七个分支各归其位', () => {
  const base = { hasCloud: true, hasLocal: true, cloudEmpty: false, equal: false, cloudChanged: false, dirty: false };
  assert.equal(decidePullAction({ ...base, hasCloud: false, hasLocal: true }), 'mark-dirty-drop-ts');
  assert.equal(decidePullAction({ ...base, hasCloud: false, hasLocal: false }), 'nothing');
  assert.equal(decidePullAction({ ...base, hasLocal: false, cloudEmpty: true }), 'adopt-ts');
  assert.equal(decidePullAction({ ...base, hasLocal: false, cloudEmpty: false }), 'apply-cloud');
  assert.equal(decidePullAction({ ...base, equal: true }), 'clear-dirty');
  assert.equal(decidePullAction({ ...base, cloudChanged: true, dirty: true }), 'conflict');
  assert.equal(decidePullAction({ ...base, cloudChanged: true, dirty: false }), 'apply-cloud');
  assert.equal(decidePullAction({ ...base, cloudChanged: false, dirty: true }), 'keep-local');
  assert.equal(decidePullAction({ ...base }), 'mark-dirty');
});

const KEYS = ['trades', 'cashLog', 'state'];
const mk = (over) => Object.assign({
  keys: KEYS, cloudData: {}, meta: {}, state: { dirty: {}, cloudTs: {} }, normalizeTs: (v) => Number(v) || 0,
}, over);

test('planPullSync：云端没有该行 → 标脏、丢掉旧版本号、不覆盖本地', () => {
  const plan = planPullSync(mk({
    cloudData: { trades: undefined },
    meta: { trades: 111 },
    state: { dirty: {}, cloudTs: { trades: 999 } },
    hasLocal: (k) => k === 'trades',
    hasCloud: (k, cv) => cv !== undefined,
  }));
  assert.deepEqual(plan.applies, []);
  assert.equal(plan.dirty.trades, true);
  assert.equal('trades' in plan.cloudTs, false, '要忘掉旧版本号，否则下次推送必 409');
});

test('planPullSync：本地没有、云端也是空 → 只记版本号', () => {
  const plan = planPullSync(mk({
    cloudData: { cashLog: [] },
    meta: { cashLog: 222 },
    hasLocal: () => false,
    isEmptyCloud: (cv) => Array.isArray(cv) && cv.length === 0,
  }));
  assert.deepEqual(plan.applies, []);
  assert.equal(plan.dirty.cashLog, false);
  assert.equal(plan.cloudTs.cashLog, 222);
});

test('planPullSync：云端更新 + 本地也改过 → 冲突（带着云端内容待确认）', () => {
  const plan = planPullSync(mk({
    cloudData: { trades: [{ id: 2 }] },
    meta: { trades: 500 },
    state: { dirty: { trades: true }, cloudTs: { trades: 400 } },
    hasLocal: () => true,
    equal: () => false,
  }));
  assert.deepEqual(plan.conflicts, ['trades']);
  assert.deepEqual(plan.pendingCloud.trades, [{ id: 2 }]);
  assert.deepEqual(plan.applies, []);
  assert.equal(plan.dirty.trades, true, '冲突未解决前仍算本地有改动');
});

test('planPullSync：云端更新 + 本地没改过 → 直接覆盖本地', () => {
  const plan = planPullSync(mk({
    cloudData: { state: { monthlyDCA: 3000 } },
    meta: { state: 600 },
    state: { dirty: {}, cloudTs: { state: 500 } },
    hasLocal: () => true,
    equal: () => false,
  }));
  assert.deepEqual(plan.applies, ['state']);
  assert.equal(plan.dirty.state, false);
  assert.equal(plan.cloudTs.state, 600);
});

test('planPullSync：内容一致 → 清脏并记版本号（不再假冲突）', () => {
  const plan = planPullSync(mk({
    cloudData: { trades: [] },
    meta: { trades: 700 },
    state: { dirty: { trades: true }, cloudTs: { trades: 650 } },
    hasLocal: () => true,
    equal: () => true,
  }));
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.dirty.trades, false);
  assert.equal(plan.cloudTs.trades, 700);
});

test('planPullSync：云端没变 + 本地有改动 → 本地为准（等推送，不动状态）', () => {
  const plan = planPullSync(mk({
    cloudData: { cashLog: [] },
    meta: { cashLog: 800 },
    state: { dirty: { cashLog: true }, cloudTs: { cashLog: 800 } },
    hasLocal: () => true,
    equal: () => false,
  }));
  assert.deepEqual(plan.applies, []);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.dirty.cashLog, true);
  assert.equal(plan.cloudTs.cashLog, 800);
});

test('planPullSync：不改传入的 state（dirty/cloudTs 都是副本）', () => {
  const state = { dirty: { trades: true }, cloudTs: {} };
  const plan = planPullSync(mk({
    cloudData: { trades: [] },
    meta: { trades: 900 },
    state,
    hasLocal: () => true,
    equal: () => true,
  }));
  assert.equal(state.dirty.trades, true, '原对象保持原样');
  assert.equal(plan.dirty.trades, false);
  assert.notEqual(plan.dirty, state.dirty);
});

test('planConflictHeal：一致→静默对齐；不一致→进 diff；云端没有→标脏重建', () => {
  const heal = planConflictHeal({
    sentKeys: ['trades', 'cashLog', 'state'],
    cloudData: { trades: [{ id: 1 }], cashLog: undefined, state: { monthlyDCA: 3000 } },
    meta: { trades: 1234, state: 99 },
    state: { dirty: { trades: true, cashLog: true, state: true }, cloudTs: { state: 50 } },
    equal: (k) => k !== 'state',
  });
  assert.deepEqual(heal.diff, ['state'], '只有内容不同的键要用户确认');
  assert.equal(heal.dirty.trades, false);
  assert.equal(heal.cloudTs.trades, 1234);
  assert.equal(heal.dirty.cashLog, true, '云端没有该行 → 标脏等重建');
  assert.equal('cashLog' in heal.cloudTs, false);
});

test('推送辅助：pushedKeysOf / pendingDirtyKeys / shouldSkipPush', () => {
  const payload = { trades: [], prices: {}, __expectedVersions: {} };
  assert.deepEqual(pushedKeysOf(payload, KEYS), ['trades']);
  assert.deepEqual(pushedKeysOf({ prices: {}, __expectedVersions: {} }, KEYS), []);
  assert.equal(shouldSkipPush({ prices: {}, __expectedVersions: {} }, KEYS), true, '只有 prices+版本戳 → 不推');
  assert.equal(shouldSkipPush(payload, KEYS), false);
  assert.deepEqual(pendingDirtyKeys({ dirty: { trades: true, cashLog: false, state: true } }, KEYS), ['trades', 'state']);
  assert.deepEqual(pendingDirtyKeys(null, KEYS), []);
});
