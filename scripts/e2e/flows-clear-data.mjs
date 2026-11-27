// e2e：非主账号（localStorage 里没有历史 token）点「清除所有数据」必须真的清掉云端。
// 回归背景（v302）：hasCloud 曾用 syncCfg.token 判断，而 token 已退役，
// 于是走了"只清本机"分支 → 云端原样保留 → 重载后又被拉回来，表现是"点了没反应"。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const UID = '2';

const cloudGet = () => fetch(CLOUD + '/api/sync', { headers: { Cookie: 'wt_uid=' + UID } }).then((r) => r.json()).then((j) => j.data || {});

await fetch(CLOUD + '/_reset').catch(() => {});
await fetch(CLOUD + '/api/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: 'wt_uid=' + UID },
  body: JSON.stringify({ trades: [{ id: 9, date: '2026-09-02', symbol: 'VGT', shares: 5, price: 100 }], cashBalance: 999, watchlist: [{ sym: 'NVDA', enabled: true }] }),
});

const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === new URL(BASE).hostname ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));
await context.addCookies([{ name: 'wt_uid', value: UID, domain: '127.0.0.1', path: '/' }]);

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  // 关键：token 已退役，这里刻意不写 token —— 复现"非主账号"的配置
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
  localStorage.setItem('wealth_trades_v2', '[]');
  localStorage.setItem('wealth_cash_v2', '0');
  localStorage.setItem('wealth_cashlog_v2', '[]');
  localStorage.setItem('wealth_activity_v1', '[]');
  /* v442：清除必须连观察列表 / 记录分段 / v433 归档 / 汇率与市值缓存一起清 */
  const NS = 'u2:';
  localStorage.setItem(NS + 'wealth_watchlist_v1', JSON.stringify([{ sym: 'NVDA', enabled: true }]));
  localStorage.setItem(NS + 'wealth_records_segment_v1', 'logs');
  localStorage.setItem(NS + 'wealth_legacy_core_v4', JSON.stringify({ trades: [] }));
  localStorage.setItem(NS + 'wealth_fx_usd_cny_v1', JSON.stringify({ rate: 7.1 }));
  localStorage.setItem(NS + 'wealth_marketcap_v3', JSON.stringify({ caps: { NVDA: 1 }, at: Date.now() }));
});
await p.goto(BASE + '?clear=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const failures = [];
const before = await cloudGet();
if (!Array.isArray(before.trades) || before.trades.length !== 1) {
  failures.push('前置条件不成立：云端没有预置数据（' + JSON.stringify(before).slice(0, 80) + '）');
}

await p.evaluate(() => window.clearAllData());
await p.waitForTimeout(400);
const promptText = await p.evaluate(() => {
  const t = document.querySelector('#approvalModal .ds-approval-text');
  return t ? t.textContent : '';
});
if (!/云端/.test(promptText)) failures.push('清除提示没提到云端，说明又走回了"只清本机"分支：' + promptText.split('\n')[0]);

// v305 起：危险操作要长按 3 秒（方案 C）。先确认"点一下"不会执行，再模拟长按。
await p.evaluate(() => { const b = document.querySelector('#approvalModal [data-act="ok"]'); if (b) b.click(); });
await p.waitForTimeout(500);
const afterPlainClick = await p.evaluate(() => !!document.getElementById('approvalModal'));
if (!afterPlainClick) failures.push('长按确认失效：普通点一下就执行了清除');

const holdBox = await p.evaluate(() => {
  const b = document.querySelector('#approvalModal [data-act="ok"]');
  if (!b) return null;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  return b.textContent;
});
if (!holdBox || !/长按/.test(holdBox)) failures.push('确认按钮没有提示要长按：' + holdBox);
await p.waitForTimeout(3400);
await p.waitForTimeout(2500);

const after = await cloudGet();
if (Array.isArray(after.trades) && after.trades.length) failures.push('云端交易没被清掉：' + JSON.stringify(after.trades).slice(0, 80));
if (Number(after.cashBalance) !== 0) failures.push('云端现金没归零：' + after.cashBalance);
if (Array.isArray(after.watchlist) && after.watchlist.length) failures.push('云端观察列表没被清掉：' + JSON.stringify(after.watchlist).slice(0, 60));

await p.waitForTimeout(3000);
const localTrades = await p.evaluate(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
if (localTrades !== 0) failures.push('清除后本地又被云端拉回来了：' + localTrades + ' 笔');
const leftovers = await p.evaluate(() => ({
  watch: JSON.parse(localStorage.getItem('u2:wealth_watchlist_v1') || '[]').filter((w) => w && w.sym === 'NVDA').length,
  legacy: localStorage.getItem('u2:wealth_legacy_core_v4') !== null,
}));
if (leftovers.watch) failures.push('清除后观察列表里的 NVDA 又回来了');
if (leftovers.legacy) failures.push('旧核心仓归档 wealth_legacy_core_v4 没被清掉');

await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

console.log('清除全部数据：提示「' + promptText.split('\n')[0] + '」· 云端交易 ' + (before.trades || []).length + '→' + (after.trades || []).length + ' · 重载后本地 ' + localTrades + ' 笔');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('清除数据测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-clear-data failed');
}
console.log('✓ 非主账号清除全部数据：云端与本机都被清干净');
