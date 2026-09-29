// 备份纯逻辑的单测（v252 从 index.js 抽出）。
// 覆盖：导出对象结构、导入校验（坏文件 / 版本过高）、缺字段沿用当前值、
//       摘要文案、价格清洗白名单、主题配色白名单、OTM 裁剪。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupPayload, cleanBackupPrices, planBackupImport, ACCENT_CHOICES } from '../src/app/backup.js';

const CTX = {
  appDataVersion: 5,
  etfSymbols: ['VGT', 'SMH', 'BTC'],
  current: {
    trades: [{ id: 9, symbol: 'VGT' }],
    cashLog: [{ id: 8, type: '入金' }],
    optionTradesRaw: [],
    activitiesRaw: [],
    watchlist: [{ sym: 'VGT', enabled: true }],
  },
};

const trade = (sym, shares, price, date) => ({ symbol: sym, shares, price, date: date || '2026-09-01', type: 'buy' });

test('buildBackupPayload：固定住备份文件的字段（改名会直接破坏兼容）', () => {
  const out = buildBackupPayload({
    appDataVersion: 5, date: 'D', state: { a: 1 }, trades: [], cashBalance: 34000, cashLog: [],
    activities: [], optionTrades: [], otmSettings: {}, exitPortfolio: 'x', watchlist: [], prices: {},
    theme: 'light', accent: 'forest',
  });
  assert.deepEqual(Object.keys(out), [
    'version', 'date', 'state', 'trades', 'cashBalance', 'cashLog', 'activities',
    'optionTrades', 'otmSettings', 'exitPortfolio', 'watchlist', 'prices', 'theme', 'accent',
  ]);
  assert.equal(out.version, 5);
  assert.equal(out.exitPortfolio, 'x');
  assert.deepEqual(buildBackupPayload(null), { version: undefined, date: undefined, state: undefined, trades: undefined, cashBalance: undefined, cashLog: undefined, activities: undefined, optionTrades: undefined, otmSettings: undefined, exitPortfolio: undefined, watchlist: undefined, prices: undefined, theme: undefined, accent: undefined });
});

test('planBackupImport：不是对象 / 是数组 → 直接判为坏文件', () => {
  for (const bad of [null, undefined, 'x', 123, []]) {
    const plan = planBackupImport(bad, CTX);
    assert.equal(plan.ok, false);
    assert.equal(plan.error, '不是有效的备份文件');
  }
});

test('planBackupImport：备份版本高于应用 → 拒绝，并说明原因', () => {
  const plan = planBackupImport({ version: 6 }, CTX);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /备份版本高于当前应用/);
  assert.equal(planBackupImport({ version: 5 }, CTX).ok, true, '同版本要放行');
  assert.equal(planBackupImport({ version: '5' }, CTX).ok, true, '版本是字符串也要按数字比');
});

test('planBackupImport：缺字段时沿用当前值，有字段时归一化', () => {
  const keep = planBackupImport({ version: 5 }, CTX);
  assert.deepEqual(keep.next.trades, CTX.current.trades);
  assert.deepEqual(keep.next.cashLog, CTX.current.cashLog);
  assert.deepEqual(keep.next.watchlist.map((w) => [w.sym, w.enabled]), [['VGT', true]], 'kind 只分 crypto/gold/stock，这里不钉它');
  assert.equal(keep.has.trades, false);
  assert.equal(keep.has.watchlist, false);

  const replace = planBackupImport({
    version: 5,
    trades: [trade('VGT', 1, 100), trade('XXX', 1, 100)],
    watchlist: [{ sym: 'SMH' }],
  }, CTX);
  assert.equal(replace.next.trades.length, 1, '白名单外的标的会被丢掉');
  assert.equal(replace.next.trades[0].symbol, 'VGT');
  assert.equal(replace.has.trades, true);
  assert.deepEqual(replace.next.watchlist.map((w) => w.sym), ['SMH']);
});

test('planBackupImport：摘要写清每个域的数量', () => {
  const plan = planBackupImport({
    version: 5,
    trades: [trade('VGT', 1, 100)],
    cashLog: [{ date: '2026-09-02', type: '入金', amount: 5000 }],
    optionTrades: [],
    activities: [{ date: '2026-09-03', action: '买入 VGT', detail: 'x' }],
    watchlist: [{ sym: 'VGT' }, { sym: 'SMH' }],
  }, CTX);
  assert.equal(plan.summary, '交易 1 笔\n资金流水 1 条\n期权 0 个\n操作日志 1 条\n观察列表 2 项');
});

test('planBackupImport：观察列表传成字符串数组会回落默认名单（既有行为，钉住以免误判）', () => {
  const plan = planBackupImport({ version: 5, watchlist: ['VGT', 'SMH'] }, CTX);
  assert.equal(plan.next.watchlist.length, 16, '旧格式（纯代码数组）会被 normalizeWatchlist 当成空 → 默认 16 项');
  assert.equal(plan.has.watchlist, true, '但字段存在本身还是要覆盖');
});

test('planBackupImport：notes 当成操作日志、exit 两种键名都认', () => {
  const byNotes = planBackupImport({ version: 5, notes: [{ date: '2026-09-03', action: '买入', detail: 'x' }] }, CTX);
  assert.equal(byNotes.has.activities, true);
  assert.equal(byNotes.next.activities.length, 1);

  const byCamel = planBackupImport({ version: 5, exitPortfolio: 'A' }, CTX);
  assert.equal(byCamel.exitValue, 'A');
  const bySnake = planBackupImport({ version: 5, exit_portfolio: 'B' }, CTX);
  assert.equal(bySnake.exitValue, 'B');
  assert.equal(planBackupImport({ version: 5 }, CTX).exitValue, undefined);
  assert.equal(planBackupImport({ version: 5 }, CTX).has.exit, false);
});

test('planBackupImport：OTM 裁剪到 1~20，缺省 7 / 5', () => {
  assert.deepEqual(planBackupImport({ version: 5, otmSettings: { vgt: 99, smh: 0 } }, CTX).otm, { vgt: 20, smh: 5 });
  assert.deepEqual(planBackupImport({ version: 5, otmSettings: {} }, CTX).otm, { vgt: 7, smh: 5 });
  assert.equal(planBackupImport({ version: 5, otmSettings: 'nope' }, CTX).otm, null);
  assert.equal(planBackupImport({ version: 5 }, CTX).has.otmSettings, false);
});

test('planBackupImport：主题与配色只认白名单', () => {
  assert.equal(planBackupImport({ version: 5, theme: 'dark' }, CTX).has.theme, true);
  assert.equal(planBackupImport({ version: 5, theme: 'blue' }, CTX).has.theme, false);
  assert.deepEqual(ACCENT_CHOICES, ['forest', 'ocean', 'warm', 'plum', 'mono']);
  assert.equal(planBackupImport({ version: 5, accent: 'ocean' }, CTX).has.accent, true);
  assert.equal(planBackupImport({ version: 5, accent: 'neon' }, CTX).has.accent, false);
});

test('cleanBackupPrices：只留白名单标的、丢掉非法价', () => {
  const clean = cleanBackupPrices({
    VGT: 108.62,
    SMH: { price: 402.1, change: 1.5, source: 'yahoo' },
    BTC: { price: 0 },
    XXX: 12,
  }, ['VGT', 'SMH', 'BTC']);
  assert.deepEqual(Object.keys(clean), ['VGT', 'SMH']);
  assert.equal(clean.VGT.price, 108.62);
  assert.equal(clean.VGT.source, 'import', '纯数字要补成标准结构');
  assert.ok(clean.VGT.time > 0);
  assert.equal(clean.SMH.change, 1.5, '对象写法要保留原有字段');
  assert.equal(clean.SMH.price, 402.1);
  assert.equal(cleanBackupPrices(null, ['VGT']).VGT, undefined);
  assert.deepEqual(cleanBackupPrices({ VGT: 1 }, []), {}, '没有白名单就清空');
});
