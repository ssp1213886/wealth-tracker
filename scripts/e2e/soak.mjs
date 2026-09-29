// 长时运行（soak）：页面挂着跑几分钟，周期性采样 JS 堆内存 / DOM 节点数 / 报错，
// 用来抓"定时器泄漏、每次刷新都往 DOM 里塞东西、控制台越跑越吵"这类问题。
// 用法：E2E_BASE=http://127.0.0.1:8788/ SOAK_MINUTES=3 node scripts/e2e/driver.mjs --file scripts/e2e/soak.mjs
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8788/');
const HOST = new URL(BASE).hostname;
const MINUTES = Number(process.env.SOAK_MINUTES || 3);
const p = await context.newPage();
await p.route('**/*', (route) => {
  let h = '';
  try { h = new URL(route.request().url()).hostname; } catch (e) {}
  return h === HOST ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message)));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 140));
});

await p.setViewportSize({ width: 390, height: 844 });
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(BASE + '_reset').catch(() => {});
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin, token: 'test' }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([
    { id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 },
    { id: 2, date: '2026-09-05', symbol: 'SMH', shares: 1.02, price: 584.08 },
    { id: 3, date: '2026-09-10', symbol: 'BTC', shares: 13.62, price: 29.38 },
  ]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_options_v2', JSON.stringify([{ id: 201, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20' }]));
});
await p.goto(BASE + '?soak=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const ev = async (fn, a) => {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn, a); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await p.waitForTimeout(700);
    }
  }
  throw last;
};

const sample = () => ev(() => {
  const m = performance.memory || {};
  return {
    nodes: document.querySelectorAll('*').length,
    heapMB: m.usedJSHeapSize ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
    listeners: (typeof getEventListeners === 'function') ? null : null,
    dirty: Object.keys((JSON.parse(localStorage.getItem('wealth_sync_state') || '{}').dirty) || {}).filter((k) => JSON.parse(localStorage.getItem('wealth_sync_state') || '{}').dirty[k]).length,
  };
});

const samples = [];
samples.push({ t: 0, ...(await sample()) });
const rounds = Math.max(1, Math.round((MINUTES * 60) / 20));
for (let i = 1; i <= rounds; i += 1) {
  // 期间做点真实交互，避免"静止页面"测不出问题
  await ev(() => { const b = document.getElementById('bbConsole'); if (b) b.click(); });
  await p.waitForTimeout(900);
  await ev(() => { const b = document.getElementById('bbHoldings'); if (b) b.click(); });
  await p.waitForTimeout(700);
  await ev(() => { const m = document.getElementById('watchMeta'); if (m) m.click(); });
  await p.waitForTimeout(19000 - 1600);
  const s = await sample();
  samples.push({ t: i * 20, ...s });
  process.stdout.write('  · t=' + (i * 20) + 's  nodes=' + s.nodes + '  heap=' + s.heapMB + 'MB  dirty=' + s.dirty + '\n');
}

const first = samples[0];
const last = samples[samples.length - 1];
const failures = [];
const notes = [];
notes.push('采样 ' + samples.length + ' 次，共 ' + MINUTES + ' 分钟');
notes.push('DOM 节点：' + first.nodes + ' → ' + last.nodes + '（Δ' + (last.nodes - first.nodes) + '）');
if (first.heapMB != null && last.heapMB != null) {
  notes.push('JS 堆：' + first.heapMB + 'MB → ' + last.heapMB + 'MB（Δ' + (last.heapMB - first.heapMB).toFixed(1) + 'MB）');
  if (last.heapMB - first.heapMB > 40) failures.push('堆内存增长 ' + (last.heapMB - first.heapMB).toFixed(1) + 'MB（超过 40MB，疑似泄漏）');
}
if (last.nodes - first.nodes > 400) failures.push('DOM 节点增长 ' + (last.nodes - first.nodes) + '（超过 400，疑似每次刷新都插节点）');
const stillAlive = await ev(() => ({
  build: (document.getElementById('sbBuild') || {}).textContent,
  holdRows: document.querySelectorAll('#holdBody tr').length,
  lastError: window.__lastError || null,
}));
if (stillAlive.lastError) failures.push('运行期间出现 __lastError: ' + stillAlive.lastError);
if (errors.length) failures.push('运行期间报错：' + errors.slice(0, 4).join(' | '));
notes.push('结束时页面仍正常：' + stillAlive.build + ' · 持仓 ' + stillAlive.holdRows + ' 行');

await ev(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

console.log('长时运行（' + MINUTES + ' 分钟，20 秒一轮交互）：');
notes.forEach((n) => console.log('  · ' + n));
if (failures.length) {
  console.error('发现问题：\n  - ' + failures.join('\n  - '));
  throw new Error('soak failed');
}
console.log('✓ 长时运行通过（无报错、无异常内存/DOM 增长）');
