import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, normalizeAlerts, badgeCountOf } from '../src/app/alerts-view.js';

const ctx = (patch = {}) => ({
  now: new Date('2026-11-26T12:00:00Z'),
  trades: [],
  state: { monthlyDCA: 2000 },
  ...patch,
});

test('buildAlerts：本月尚未定投时只生成定投差额提醒', () => {
  const alerts = buildAlerts(ctx());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'dca:2026-11');
  assert.equal(alerts[0].action, 'dca');
  assert.match(alerts[0].title, /本月定投还差/);
});

test('buildAlerts：已完成 90% 定投后不再提醒', () => {
  const alerts = buildAlerts(ctx({
    trades: [{ symbol: 'VGT', date: '2026-11-20', shares: 10, price: 190 }],
  }));
  assert.equal(alerts.length, 0);
});

test('buildAlerts：月度覆盖金额优先于默认定投额', () => {
  const alerts = buildAlerts(ctx({
    state: { monthlyDCA: 2000, dcaOverride: { month: '2026-11', amount: 3000 } },
    trades: [{ symbol: 'VGT', date: '2026-11-20', shares: 5, price: 200 }],
  }));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /还差 \$2,000/);
});

test('normalizeAlerts：同 id 保留严重度更高的条目并排序', () => {
  const list = normalizeAlerts([
    { id: 'a', severity: 'low', title: '低' },
    { id: 'a', severity: 'high', title: '高' },
    { id: 'b', severity: 'medium', title: '中' },
  ]);
  assert.deepEqual(list.map((item) => item.id), ['a', 'b']);
  assert.equal(list[0].title, '高');
  assert.equal(badgeCountOf(list), 2);
});
