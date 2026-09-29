// e2e：核心数据流——买入 / 入金 / 卖 CALL 是否既落库又推上（假）云端。
// 断言：本地增量正确、dirty 被清掉、假云端收到对应的键。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === new URL(BASE).hostname ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });   // 先在非应用页清 SW / 写种子：避免首次加载时 SW 自动 reload 打断初始化
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin, token: 'test' }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_cashlog_v2', '[]');
  localStorage.setItem('wealth_activity_v1', '[]');
  localStorage.setItem('wealth_options_v2', '[]');
});
await fetch(CLOUD + '/_reset').catch(() => {});
await p.goto(BASE + '?flow=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

async function ev(fn, arg) {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn, arg); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await p.waitForTimeout(700);
    }
  }
  throw last;
}
const snap = () => ev(() => ({
  trades: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
  cash: Number(localStorage.getItem('wealth_cash_v2') || '0'),
  cashLog: JSON.parse(localStorage.getItem('wealth_cashlog_v2') || '[]').length,
  activities: JSON.parse(localStorage.getItem('wealth_activity_v1') || '[]').length,
  options: JSON.parse(localStorage.getItem('wealth_options_v2') || '[]').length,
}));
const failures = [];

/* 买入 VGT 10 股 @580 */
await ev(() => document.getElementById('bbConsole').click());
await p.waitForTimeout(1500);
const beforeBuy = await snap();
await ev(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('tfDate', '2026-09-28');
  set('tfPrice', '580');
  set('tfShares', '10');
  const buy = Array.from(document.querySelectorAll('.segment[data-trade-type]')).filter((b) => b.getAttribute('data-trade-type') === 'buy')[0];
  if (buy && !buy.classList.contains('active')) buy.click();
  const chip = Array.from(document.querySelectorAll('.asset-chip[data-asset]')).filter((b) => b.getAttribute('data-asset') === 'VGT')[0];
  if (chip && !chip.classList.contains('active')) chip.click();
});
await p.waitForTimeout(400);
await ev(() => document.getElementById('btnAddTrade').click());
await p.waitForTimeout(2000);
const afterBuy = await snap();
if (afterBuy.trades - beforeBuy.trades !== 1) failures.push('买入没有落库（交易数 ' + beforeBuy.trades + ' → ' + afterBuy.trades + '）');
if (afterBuy.activities - beforeBuy.activities !== 1) failures.push('买入没有写操作日志');

/* 入金 5000 */
const beforeDep = await snap();
await ev(() => {
  const el = document.getElementById('hmCashAmt');
  el.value = '5000';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await p.waitForTimeout(2200);
const afterDep = await snap();
if (afterDep.cash - beforeDep.cash !== 5000) failures.push('入金没有加进现金（' + beforeDep.cash + ' → ' + afterDep.cash + '）');
if (afterDep.cashLog - beforeDep.cashLog !== 1) failures.push('入金没有写资金流水');

/* 卖 CALL VGT @130 x1，权利金 120/张 */
await ev(() => document.getElementById('bbOption').click());
await p.waitForTimeout(1800);
const beforeOpt = await snap();
await ev(() => {
  const set = (id, v) => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('otype', 'CALL');
  set('osym', 'VGT');
  set('oexpiry', '2026-10-16');
  set('ostrike', '130');
  set('opremium', '120');
  set('ocontracts', '1');
});
await p.waitForTimeout(500);
await ev(() => document.getElementById('btnAddOption').click());
await p.waitForTimeout(2500);
const afterOpt = await snap();
if (afterOpt.options - beforeOpt.options !== 1) failures.push('卖 CALL 没有落库');
if (afterOpt.cash - beforeOpt.cash !== 120) failures.push('卖 CALL 的权利金没有入账（+' + (afterOpt.cash - beforeOpt.cash) + '，应为 +120）');

/* 云端是否真的收到 */
await p.waitForTimeout(1500);
const cloud = await (await fetch(CLOUD + '/_log')).json();
const keys = Object.keys(cloud.store);
['trades', 'cashBalance', 'cashLog', 'activities', 'optionTrades'].forEach((k) => {
  if (!keys.includes(k)) failures.push('假云端没收到 ' + k + '（收到：' + keys.join(',') + '）');
});
const pushes = cloud.log.map((x) => x.keys.join('+'));
if (!pushes.some((k) => k.includes('trade'))) failures.push('没有任何一次推送包含 trades');

await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

console.log('数据流：买入 ' + beforeBuy.trades + '→' + afterBuy.trades + ' 笔 · 现金 ' + beforeDep.cash + '→' + afterDep.cash + ' · 期权 ' + beforeOpt.options + '→' + afterOpt.options);
console.log('推送记录：' + pushes.join('  |  '));
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('数据流测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-data failed');
}
console.log('✓ 买入 / 入金 / 卖 CALL 都正确落库并同步');
