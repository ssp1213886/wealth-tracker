// 冷启动延迟测量（由 driver 用 new Function 执行，不能用静态 import）
//
// 用途：所有单测/e2e 都跑在 ~0ms 的本地假云端上，测不出"延迟类"回归。
// 这个脚本把每个 /api 请求人为延迟 DELAY 毫秒，输出请求时间线与"同步变绿""行情到位"的时刻。
// 改同步 / 启动链路 / Service Worker 时应该跑它，并和旧构建对比（见同目录 measure-boot.mjs）。
const BASE = process.env.E2E_BASE;
const DELAY = Number(process.env.DELAY || 2000);
const RUN_MS = Number(process.env.RUN_MS || 15000);
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
const t0 = Date.now();
const events = [];
await p.route('**/api/**', async (route) => {
  const url = route.request().url().replace(/^.*\/api\//, '/api/').slice(0, 38);
  const started = Date.now() - t0;
  await new Promise((r) => setTimeout(r, DELAY));
  await route.continue();
  events.push(url + '  ' + started + '→' + (Date.now() - t0));
});
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
  localStorage.setItem('wealth_watchlist_v1', JSON.stringify(['VGT', 'SMH', 'BTC', 'NVDA'].map((s, i) => ({ sym: s, enabled: true, order: i }))));
});
await fetch(BASE + '_reset').catch(() => {});
await p.goto(BASE + '?measure=' + Date.now(), { waitUntil: 'domcontentloaded' });

let syncGreenAt = null;
let priceReadyAt = null;
for (let i = 0; i * 500 < RUN_MS; i += 1) {
  await p.waitForTimeout(500);
  const s = await p.evaluate(() => {
    const bar = document.getElementById('syncBar');
    const pills = document.querySelectorAll('#hmPricesCompact .price-pill[data-price]').length;
    return { bar: bar ? (bar.textContent || '').trim() : '', pills };
  });
  if (syncGreenAt === null && /已同步/.test(s.bar)) syncGreenAt = Date.now() - t0;
  if (priceReadyAt === null && s.pills >= 3) priceReadyAt = Date.now() - t0;
}
console.log('首次同步完成（变绿）: ' + (syncGreenAt === null ? '未完成' : syncGreenAt + 'ms'));
console.log('行情胶囊有真实报价:   ' + (priceReadyAt === null ? '未完成' : priceReadyAt + 'ms'));
console.log(RUN_MS / 1000 + ' 秒内 /api 请求总数: ' + events.length);
console.log('请求时间线（start→end）:');
events.forEach((x) => console.log('  ' + x));
