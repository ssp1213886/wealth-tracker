import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-d1.mjs';
import { saveSnapshot, listSnapshots, restoreSnapshot } from '../src/lib/snapshots.js';

const envWith = (initial) => ({ DB: createFakeDb(initial) });

test('saveSnapshot：把当前数据行整份存下来（含摘要），空库不存', async () => {
  const db = createFakeDb({ trades: [{ id: 1 }], cashBalance: 34000, cashLog: [] });
  const env = { DB: db };
  const snap = await saveSnapshot(env, 1, 'clear');
  assert.ok(snap && snap.id > 0);
  const sum = JSON.parse(snap.summary);
  assert.equal(sum.trades, 1, '摘要里的交易笔数');
  assert.equal(sum.cash, 34000, '摘要里的现金');
  assert.equal(db.snapshots.length, 1);
  // 空库不存
  const empty = await saveSnapshot({ DB: createFakeDb({}) }, 1, 'clear');
  assert.equal(empty, null);
});

test('listSnapshots：只列自己的、按时间倒序、不带 payload', async () => {
  const db = createFakeDb({ trades: [{ id: 1 }], cashBalance: 100 });
  const env = { DB: db };
  await saveSnapshot(env, 1, 'clear');
  await new Promise((r) => setTimeout(r, 5));
  await saveSnapshot(env, 2, 'clear');
  const mine = await listSnapshots(env, 1, 5);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.snapshots.length, 1, '不该看到别的账号的快照');
  assert.ok(!('payload' in mine.body.snapshots[0]), '列表不带 payload');
});

test('restoreSnapshot：把快照写回，并删掉快照里没有的键（干净回到当时的样子）', async () => {
  const db = createFakeDb({ trades: [{ id: 1, symbol: 'VGT' }], cashBalance: 999 });
  const env = { DB: db };
  const snap = await saveSnapshot(env, 1, 'clear');

  // 模拟"清除 + 之后又录了新东西"
  db.rows.set('1|trades', { user_id: 1, key: 'trades', value: JSON.stringify([]), updated_at: 2000 });
  db.rows.set('1|cashBalance', { user_id: 1, key: 'cashBalance', value: JSON.stringify(0), updated_at: 2000 });
  db.rows.set('1|activities', { user_id: 1, key: 'activities', value: JSON.stringify([{ id: 9 }]), updated_at: 3000 });

  const res = await restoreSnapshot(env, 1, snap.id);
  assert.equal(res.status, 200);
  assert.ok(res.body.restored >= 2);
  assert.equal(JSON.parse(db.rows.get('1|trades').value).length, 1, '交易回来了');
  assert.equal(JSON.parse(db.rows.get('1|cashBalance').value), 999, '现金回来了');
  assert.ok(!db.rows.has('1|activities'), '快照里没有的键要被清掉');
});

test('restoreSnapshot：别人的快照 / 不存在的 id 一律拒绝', async () => {
  const db = createFakeDb({ trades: [{ id: 1 }] });
  const env = { DB: db };
  const snap = await saveSnapshot(env, 1, 'clear');
  const other = await restoreSnapshot(env, 2, snap.id);
  assert.equal(other.status, 404, '不能恢复别人的快照');
  const bad = await restoreSnapshot(env, 1, 99999);
  assert.equal(bad.status, 404);
  const illegal = await restoreSnapshot(env, 1, 'abc');
  assert.equal(illegal.status, 400);
});

test('handleSyncPost：带 __snapshotBefore 时先留快照再落空值，且该标记不会被当成数据键拒绝', async () => {
  const db = createFakeDb({ trades: [{ id: 1 }], cashBalance: 5000 });
  const env = { DB: db };
  const req = new Request('https://x/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ __snapshotBefore: true, trades: [], cashBalance: 0 }),
  });
  const { handleSyncPost } = await import('../src/lib/sync.js');
  const res = await handleSyncPost(req, env, 1);
  assert.equal(res.status, 200);
  assert.ok(res.body.snapshot && res.body.snapshot.id > 0, '应返回快照信息');
  // 快照里是"清除前"的样子
  const saved = JSON.parse(db.snapshots[0].payload);
  assert.equal(JSON.parse(saved.trades).length, 1, '快照必须是清除前的数据');
  assert.equal(JSON.parse(saved.cashBalance), 5000);
  // data 表已被清空
  assert.equal(JSON.parse(db.rows.get('1|trades').value).length, 0);
});
