// 待办提醒的单测（v253 从 index.js 抽出）。
// 重点是 buildAlerts —— 这里是纯函数，把"@行权价逼近 / 期权临期 / 本月定投差额"三类判定钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, normalizeAlerts, loadOptPing, saveOptPing } from '../src/app/alerts-view.js';

// 美东 2026-09-29 08:00（UTC 12:00）→ 当月 = 2026-09
const NOW = new Date('2026-09-29T12:00:00Z');

function ctx(over) {
  return Object.assign({
    now: NOW,
    options: [],
    prices: {},
    trades: [],
    state: { monthlyDCA: 2000 },
    pingMap: {},
  }, over || {});
}

const call = (over) => Object.assign({ id: 1, sym: 'VGT', type: 'CALL', strike: 130, contracts: 2, expiry: '2026-10-16' }, over || {});
const buy = (date, amount) => ({ date, symbol: 'VGT', shares: 1, price: amount, type: 'buy' });

test('buildAlerts：卖 Call 覆盖情况（虚值 → 蓝色中风险）', () => {
  const alerts = buildAlerts(ctx({ options: [call()], prices: { VGT: 110 } }));
  const one = alerts.find((a) => a.id === 'call:VGT');
  assert.ok(one, '应该有 call:VGT 这条');
  assert.equal(one.type, 'blue');
  assert.equal(one.severity, 'medium');
  assert.match(one.title, /VGT 已卖 2 张 Call/);
  assert.match(one.detail, /覆盖 200 股/);
  assert.match(one.detail, /最近 10-16 到期/);
  assert.equal(one.action, 'option');
});

test('buildAlerts：现价逼近行权价（≥98%）→ 红色紧急', () => {
  const alerts = buildAlerts(ctx({ options: [call()], prices: { VGT: 128 } }));
  const one = alerts.find((a) => a.id === 'call:VGT');
  assert.equal(one.type, 'red');
  assert.equal(one.severity, 'critical');
  assert.match(one.detail, /当前 \$128\.00/);
  assert.match(one.detail, /行权价 \$130/);
});

test('buildAlerts：同一标的的多张 Call 合并计数，用最近到期那张做提示', () => {
  const alerts = buildAlerts(ctx({
    options: [call({ id: 1, expiry: '2026-11-20', contracts: 2 }), call({ id: 2, expiry: '2026-10-16', contracts: 1 })],
    prices: { VGT: 100 },
  }));
  const one = alerts.find((a) => a.id === 'call:VGT');
  assert.match(one.title, /已卖 3 张 Call/);
  assert.match(one.detail, /最近 10-16 到期/);
});

test('buildAlerts：期权临期（≤3 天）提醒，已过期升级为红色', () => {
  const soon = buildAlerts(ctx({ options: [call({ id: 7, expiry: '2026-10-02' })] })).find((a) => a.id === 'expiry:7');
  assert.equal(soon.type, 'orange');
  assert.equal(soon.severity, 'high');
  assert.match(soon.title, /还剩 3 天到期/);
  assert.equal(soon.dismiss, 'opt-expiry-7');

  const over = buildAlerts(ctx({ options: [call({ id: 8, expiry: '2026-09-28' })] })).find((a) => a.id === 'expiry:8');
  assert.equal(over.type, 'red');
  assert.equal(over.severity, 'critical');
  assert.match(over.title, /已过期未结算/);
  assert.match(over.detail, /请确认行权或结算/);
});

test('buildAlerts：>3 天 / 已结算 / 已归档 / 今天已提醒过的都不进列表', () => {
  assert.equal(buildAlerts(ctx({ options: [call({ id: 9, expiry: '2026-10-20' })] })).filter((a) => String(a.id).indexOf('expiry:') === 0).length, 0);
  assert.equal(buildAlerts(ctx({ options: [call({ id: 10, expiry: '2026-10-02', settled: true })] })).filter((a) => String(a.id).indexOf('expiry:') === 0).length, 0);
  assert.equal(buildAlerts(ctx({ options: [call({ id: 11, expiry: '2026-10-02', archived: true })] })).filter((a) => String(a.id).indexOf('expiry:') === 0).length, 0);
  const pinged = buildAlerts(ctx({ options: [call({ id: 12, expiry: '2026-10-02' })], pingMap: { 12: '2026-09-29' } }));
  assert.equal(pinged.filter((a) => String(a.id).indexOf('expiry:') === 0).length, 0);
});

test('buildAlerts：本月定投没投够 → 差额提醒', () => {
  const alerts = buildAlerts(ctx({ trades: [buy('2026-09-05', 1000)] }));
  const dca = alerts.find((a) => a.id === 'dca:2026-09');
  assert.ok(dca);
  assert.equal(dca.type, 'accent');
  assert.equal(dca.severity, 'low');
  assert.match(dca.title, /本月定投还差 \$1,000\.00/);
  assert.equal(dca.action, 'console');
});

test('buildAlerts：投够 90% 就不提醒；上个月的买入不算', () => {
  assert.equal(buildAlerts(ctx({ trades: [buy('2026-09-05', 1800)] })).filter((a) => String(a.id).indexOf('dca:') === 0).length, 0);
  assert.equal(buildAlerts(ctx({ trades: [buy('2026-08-31', 1000)] })).filter((a) => String(a.id).indexOf('dca:') === 0).length, 1, '8 月的买入不能顶这个月');
});

test('buildAlerts：本月覆盖额（dcaOverride）优先于默认月投额', () => {
  const alerts = buildAlerts(ctx({ state: { monthlyDCA: 2000, dcaOverride: { month: '2026-09', amount: 500 } }, trades: [buy('2026-09-05', 100)] }));
  const dca = alerts.find((a) => a.id === 'dca:2026-09');
  assert.match(dca.title, /还差 \$400\.00/, '按 override 的 500 算');
});

test('buildAlerts：没有任何事项时返回空数组', () => {
  assert.deepEqual(buildAlerts(ctx({ trades: [buy('2026-09-05', 2000)], state: { monthlyDCA: 2000 } })), []);
});

test('normalizeAlerts：同 id 留最严重的一条，并按严重度排序', () => {
  const out = normalizeAlerts([
    { id: 'a', severity: 'low', title: 'a' },
    { id: 'b', severity: 'high', title: 'b' },
    { id: 'a', severity: 'critical', title: 'a2' },
  ]);
  assert.deepEqual(out.map((x) => [x.id, x.severity]), [['a', 'critical'], ['b', 'high']]);
  assert.deepEqual(normalizeAlerts(null), []);
  assert.deepEqual(normalizeAlerts([{ severity: 'low' }]), [], '没有 id 的直接丢掉');
});

test('期权提醒标记：存的是"哪个 id 在今天被提醒过"', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    configurable: true,
    writable: true,
  });
  try {
    assert.deepEqual(loadOptPing(), {}, '没存过返回空对象');
    saveOptPing(42);
    const map = loadOptPing();
    assert.deepEqual(Object.keys(map), ['42'], '键是字符串化的 id');
    assert.match(map['42'], /^\d{4}-\d{2}-\d{2}$/, '存的是"提醒过的那一天"');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
});
