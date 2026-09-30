// e2e：轻量版本检查（v311）。
// 第一次打开：云端有变化 → ?meta=1 之后必须跟一次完整拉取。
// 第二次打开：云端没变 → 只发 ?meta=1，不许再下载正文（这是"打开就不用等几秒"的关键）。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
const syncs = [];
p.on('request', (r) => { if (/\/api\/sync/.test(r.url())) syncs.push(r.method() + ' ' + r.url().replace(/^.*\/api\/sync/, '/api/sync')); });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));

await fetch(CLOUD + '/_reset').catch(() => {});
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
});
// 云端先放一份（模拟另一台设备推过）→ 第一次打开应当拉下来
await fetch(CLOUD + '/api/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ trades: [{ id: 9, date: '2026-09-02', symbol: 'VGT', shares: 5, price: 100 }], cashBalance: 999 }),
});

await p.goto(BASE + '?meta1=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
const first = syncs.slice();

syncs.length = 0;
await p.goto(BASE + '?meta2=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
const second = syncs.slice();

const failures = [];
if (!first.includes('GET /api/sync?meta=1')) failures.push('第一次打开没有先做版本检查：' + (first.join(' , ') || '没有任何同步请求'));
if (!first.includes('GET /api/sync')) failures.push('云端有变化时没有完整拉取：' + first.join(' , '));
if (!second.includes('GET /api/sync?meta=1')) failures.push('第二次打开没有做版本检查：' + (second.join(' , ') || '无'));
if (second.includes('GET /api/sync')) failures.push('云端没变时仍然下载了正文：' + second.join(' , '));

await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

console.log('同步版本检查：第一次 ' + first.join(' → ') + ' ｜ 第二次 ' + second.join(' → '));
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('同步版本检查测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-sync-meta failed');
}
console.log('✓ 云端没变时只做版本检查，不再下载正文');
