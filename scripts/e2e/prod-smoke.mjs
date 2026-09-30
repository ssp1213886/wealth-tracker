// 线上只读冒烟（无头，不弹窗）：部署后用它确认「页面能起、关键区块都在、没有报错」。
//   E2E_BASE=https://<worker 域名>/ node scripts/e2e/driver.mjs --file scripts/e2e/prod-smoke.mjs
// 安全：全程只读——先清掉同步 token（避免把调试副本的数据推到云端），不点任何会写数据的按钮。
const BASE = (process.env.E2E_BASE || 'https://wealth-tracker.ssp2180481336.workers.dev/');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === new URL(BASE).hostname ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message)));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 160));
});

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  localStorage.removeItem('wealth_sync_cfg');   // 关键：不留生产 token
  localStorage.removeItem('wealth_sync_state');
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
});
await p.goto(BASE + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);

// 线上已经开启登录门禁：未登录时这里拿到的是登录页。
// 给了 WT_TOKEN 就自动登录继续验 App；没给就只验"门禁确实在"，不去猜别人的令牌。
const needsLogin = await p.evaluate(() => !!document.getElementById('loginForm'));
if (needsLogin) {
  const token = process.env.WT_TOKEN || '';
  if (!token) {
    console.log('线上冒烟：检测到登录门禁（未提供 WT_TOKEN，跳过 App 断言）');
    console.log('✓ 门禁生效：未登录只能看到登录页');
    await p.close();
    process.exit(0);
  }
  const loginResult = await p.evaluate(async (value) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: value }),
    });
    return res.status;
  }, token);
  if (loginResult !== 200) {
    console.error('登录失败（HTTP ' + loginResult + '），WT_TOKEN 是否正确？');
    await p.close();
    process.exit(1);
  }
  await p.goto(BASE + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
}

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
const failures = [];
const snap = () => ev(() => ({
  build: (document.getElementById('sbBuild') || {}).textContent,
  bootFailed: document.body.innerText.indexOf('页面启动失败') >= 0,
  holdRows: document.querySelectorAll('#holdBody tr').length,
  watchRows: document.querySelectorAll('#watchRows .watch-row').length,
  sidebarTotal: (document.getElementById('sbValue') || {}).textContent,
  lastError: window.__lastError || null,
}));
const dashboard = await snap();
for (const tab of ['bbConsole', 'bbOption', 'bbData', 'bbHoldings']) {
  await ev((id) => document.getElementById(id).click(), tab);
  await p.waitForTimeout(1400);
}
const final = await snap();
await ev(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

if (dashboard.bootFailed) failures.push('出现「页面启动失败」兜底页');
if (!/^v\d+$/.test(dashboard.build || '')) failures.push('侧边栏版本号异常：' + dashboard.build);
if (dashboard.watchRows < 1) failures.push('观察列表没有渲染');
if (!dashboard.sidebarTotal || dashboard.sidebarTotal === '--') failures.push('侧边栏总资产没算出来');
if (dashboard.lastError || final.lastError) failures.push('__lastError: ' + (dashboard.lastError || final.lastError));
if (errors.length) failures.push(errors.join(' | '));

console.log('线上冒烟：' + dashboard.build + ' · 观察 ' + dashboard.watchRows + ' 行 · 持仓 ' + dashboard.holdRows + ' 行 · 总资产 ' + dashboard.sidebarTotal);
if (failures.length) {
  console.error('冒烟失败：\n  - ' + failures.join('\n  - '));
  throw new Error('prod smoke failed');
}
console.log('✓ 线上只读冒烟通过（未留 token、未改数据）');
