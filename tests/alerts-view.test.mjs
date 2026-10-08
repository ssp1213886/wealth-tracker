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

test('buildAlerts：现价逼近行权价（≥98%，但还没实值）→ 只是说明，不是警报', () => {
  const alerts = buildAlerts(ctx({ options: [call()], prices: { VGT: 128 } }));
  const one = alerts.find((a) => a.id === 'call:VGT');
  assert.equal(one.type, 'blue', 'v335 起不再是 red/critical');
  assert.equal(one.severity, 'medium');
  assert.match(one.detail, /现价 \$128\.00 逼近行权价 \$130/);
  assert.match(one.detail, /到期前不需要动作/);
});

test('buildAlerts：到期前已实值 → 说明"不用做"，并告诉你到期会怎样', () => {
  const alerts = buildAlerts(ctx({ options: [call()], prices: { VGT: 140 } }));
  const one = alerts.find((a) => a.id === 'call:VGT');
  assert.equal(one.type, 'accent', '这是计划内状态，不是风险');
  assert.equal(one.severity, 'medium');
  assert.match(one.title, /VGT CALL \$130 已实值（现价 \$140\.00）/);
  assert.match(one.detail, /不主动平仓，等自然到期/);
  assert.match(one.detail, /次日买回 200 股/);
});

test('buildAlerts：已实值且除息落在本轮周期内 → 才升级成"提前行权可能"', () => {
  const withDiv = buildAlerts(ctx({
    options: [call()], prices: { VGT: 140 },
    ccRows: [{ sym: 'VGT', nextExpiry: '2026-10-16' }],
    exDiv: { VGT: '2026-10-12' },
  })).find((a) => a.id === 'call:VGT');
  assert.equal(withDiv.type, 'orange');
  assert.equal(withDiv.severity, 'high');
  assert.match(withDiv.title, /已实值 · 本轮含除息/);
  assert.match(withDiv.detail, /除息约 2026-10-12/);
  assert.match(withDiv.detail, /提前行权可能/);

  // 除息日在下一轮（> 本次到期日）→ 不升级
  const farDiv = buildAlerts(ctx({
    options: [call()], prices: { VGT: 140 },
    ccRows: [{ sym: 'VGT', nextExpiry: '2026-10-16' }],
    exDiv: { VGT: '2026-12-23' },
  })).find((a) => a.id === 'call:VGT');
  assert.equal(farDiv.type, 'accent', '除息还在更远的周期，跟这轮无关');
  // 没传 exDiv（比如股息接口挂了）→ 不升级
  const noDiv = buildAlerts(ctx({ options: [call()], prices: { VGT: 140 } })).find((a) => a.id === 'call:VGT');
  assert.equal(noDiv.type, 'accent');
});

test('buildAlerts：不够 100 股（或已被现有 CALL 占满）就不催卖 CALL', () => {
  const due = { ccRows: [{ sym: 'VGT', nextExpiry: '2026-09-29', label: '每月第三个周五' }] };
  const ccIds = (list) => list.filter((a) => /^cc/.test(a.id)).map((a) => a.id);
  const hold = (symbol, shares) => ({ symbol, shares, date: '2026-09-02', price: 100 });

  // 只有 60 股 → 连 1 张都凑不出，卖 CALL 没意义
  assert.deepEqual(ccIds(buildAlerts(ctx({ ...due, trades: [hold('VGT', 60)] }))), [], '不足 100 股不该催');

  // 正好 100 股、没有活跃 CALL → 这一天该卖
  assert.deepEqual(ccIds(buildAlerts(ctx({ ...due, trades: [hold('VGT', 100)] }))), ['ccdue:VGT'], '够 1 张才催');

  // 100 股已经被一张活跃 CALL 占着 → 不能再卖
  assert.deepEqual(ccIds(buildAlerts(ctx({
    ...due,
    trades: [hold('VGT', 100)],
    options: [call({ contracts: 1, expiry: '2026-11-20' })],
  }))), [], '已经被现有 CALL 占满就不催');

  // 250 股、已卖 2 张 → 还能卖 0 张（向下取整）
  assert.deepEqual(ccIds(buildAlerts(ctx({
    ...due,
    trades: [hold('VGT', 250)],
    options: [call({ contracts: 2, expiry: '2026-11-20' })],
  }))), [], '250 股只够 2 张，卖满了就不再催');

  // 标的对不上也不催
  assert.deepEqual(ccIds(buildAlerts(ctx({ ...due, trades: [hold('SMH', 500)] }))), [], '只有 SMH 的股票，别催 VGT');
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

test('buildAlerts：到期预告覆盖 1~7 天；到期日当天与之后交给「到期判定」', () => {
  const soon = buildAlerts(ctx({ options: [call({ id: 7, expiry: '2026-10-02' })] })).find((a) => a.id === 'expiry:7');
  assert.equal(soon.type, 'orange');
  assert.equal(soon.severity, 'high');
  assert.match(soon.title, /还剩 3 天到期/);
  assert.equal(soon.dismiss, 'opt-expiry-7');

  /* v334：过期未标记不再走"到期预告"（会同一天冒出两条），改由到期判定给「未标记 N 天」 */
  const list = buildAlerts(ctx({ options: [call({ id: 8, expiry: '2026-09-28' })] }));
  assert.equal(list.filter((a) => a.id === 'expiry:8').length, 0, '过期的不再重复出一条到期预告');
  const over = list.find((a) => a.id === 'optunmarked:8');
  assert.ok(over, '过期未标记要有提示');
  assert.match(over.title, /已到期 1 天未标记/);
  assert.match(over.detail, /确认是否被行权/);
  assert.equal(over.action, 'option');
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

/* ================= v334：到期判定 + 买回待办 ================= */

const EXP_SHUT = new Date('2026-10-16T21:00:00.000Z');   // 10-16 17:00 ET，已收盘
const expCall = (over) => Object.assign({ id: 1, sym: 'VGT', type: 'CALL', strike: 135, contracts: 1, premium: 1, expiry: '2026-10-16' }, over || {});
const assign = (over) => Object.assign({ id: 90, symbol: 'VGT', date: '2026-10-16', shares: -100, price: 135, tag: 'assign' }, over || {});

test('buildAlerts：到期日收盘后实值 → 提示会被行权，并叫你明天买回', () => {
  const list = buildAlerts(ctx({ now: EXP_SHUT, options: [expCall()], prices: { VGT: 137.2 } }));
  const a = list.find((x) => x.id === 'optdecide:1');
  assert.ok(a, '应有到期判定');
  assert.equal(a.type, 'red');
  assert.equal(a.severity, 'critical');
  assert.match(a.title, /VGT CALL \$135 会被行权/);
  assert.match(a.detail, /收盘 \$137\.20 > 行权价 \$135/);
  assert.match(a.detail, /明天买回 100 股/);
  assert.equal(a.action, 'option');
});

test('buildAlerts：到期日收盘后虚值 → 提示会作废，去点结算', () => {
  const list = buildAlerts(ctx({ now: EXP_SHUT, options: [expCall()], prices: { VGT: 131.5 } }));
  const a = list.find((x) => x.id === 'optdecide:1');
  assert.equal(a.type, 'blue');
  assert.match(a.title, /会作废/);
  assert.match(a.detail, /点「结算」归档/);
});

test('buildAlerts：到期日当天尚未收盘 → 只提示今天到期，不下判断', () => {
  const list = buildAlerts(ctx({ now: new Date('2026-10-16T14:00:00.000Z'), options: [expCall()], prices: { VGT: 137.2 } }));
  const a = list.find((x) => x.id === 'optdue:1');
  assert.ok(a);
  assert.equal(a.type, 'accent');
  assert.match(a.detail, /收盘后（美东 16:00）/);
  assert.equal(list.filter((x) => String(x.id).indexOf('optdecide:') === 0).length, 0);
});

test('buildAlerts：被行权后没有买回 → 待买回（最高优先级，且不可"今天不再提醒"）', () => {
  const list = buildAlerts(ctx({ now: new Date('2026-10-19T14:00:00.000Z'), trades: [assign()] }));
  const a = list.find((x) => String(x.id).indexOf('buyback:') === 0);
  assert.ok(a, '被行权后必须有买回待办');
  assert.equal(a.severity, 'critical');
  assert.match(a.title, /待买回 100 股 VGT/);
  assert.match(a.detail, /2026-10-16 被行权/);
  assert.match(a.detail, /T\+1 市价买回/);
  assert.equal(a.action, 'console', '点击跳到操作台去记录买回');
  assert.equal(a.dismiss, undefined, '买回是硬性动作，不给"今天不再提醒"');
});

test('buildAlerts：记录了买回之后待办消失', () => {
  const bought = assign({ id: 91, shares: 100, price: 137.2, date: '2026-10-19', tag: '' });
  const list = buildAlerts(ctx({ now: new Date('2026-10-19T14:00:00.000Z'), trades: [assign(), bought] }));
  assert.equal(list.filter((x) => String(x.id).indexOf('buyback:') === 0).length, 0);
});

test('buildAlerts：没过期的期权不会产生到期判定或买回待办', () => {
  const list = buildAlerts(ctx({ now: EXP_SHUT, options: [expCall({ id: 5, expiry: '2026-12-18' })], prices: { VGT: 137.2 } }));
  assert.equal(list.filter((x) => /^opt(decide|due|unmarked):/.test(String(x.id))).length, 0);
});
