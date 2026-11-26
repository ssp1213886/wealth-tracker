// 线上完整只读验证（比 prod-smoke 更全）：双视口 × 双主题 × PWA × API 鉴权 × 关键区块。
// 安全：全程只读——不设置同步 token、不点任何会写数据的按钮；结束时再清一次 token。
//   E2E_BASE=https://<worker 域名>/ node scripts/e2e/driver.mjs --file scripts/e2e/prod-full.mjs
const BASE = (process.env.E2E_BASE || 'https://wealth-tracker.ssp2180481336.workers.dev/');
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.route('**/*', (route) => {
  let h = '';
  try { h = new URL(route.request().url()).hostname; } catch (e) {}
  return h === HOST ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message)));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 160));
});

// 清掉同步配置再进；保留当前 SW，避免验收过程中触发控制器切换自动刷新。
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.goto(BASE + '?full=' + Date.now(), { waitUntil: 'domcontentloaded' });

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
const notes = [];

/* ---- ⓪ 登录门禁：线上未登录时拿到的是登录页 ---- */
// 门禁上线后，App 断言需要登录态。没给 WT_TOKEN 就只验"门禁确实在 + 静态资源可达 + API 要鉴权"，
// 不去猜别人的会话 —— 这也是线上未登录的真实状态（以前 App 是公开的，所以这段以前不需要）。
const gateProbe = await ev(async (base) => {
  const out = { loginForm: !!document.getElementById('loginForm') };
  const sync = await fetch(base + 'api/sync');
  out.syncStatus = sync.status;
  const sw = await fetch(base + 'sw.js');
  out.swStatus = sw.status;
  return out;
}, BASE);
if (gateProbe.loginForm) {
  if (!process.env.WT_TOKEN) {
    if (gateProbe.syncStatus !== 401 && gateProbe.syncStatus !== 403) failures.push('未登录访问 /api/sync 应回 401/403，实际 ' + gateProbe.syncStatus);
    if (gateProbe.swStatus !== 200) failures.push('未登录也应能拿到 /sw.js，实际 ' + gateProbe.swStatus);
    notes.push('未登录（未提供 WT_TOKEN）：只验门禁与静态资源 —— /api/sync → ' + gateProbe.syncStatus + ' · /sw.js → ' + gateProbe.swStatus);
    console.log('线上完整验证（只读）· 未登录模式：');
    notes.forEach((n) => console.log('  · ' + n));
    if (failures.length) {
      console.error('发现问题：\n  - ' + failures.join('\n  - '));
      throw new Error('prod-full failed');
    }
    console.log('✓ 门禁生效：未登录只能看到登录页、/api 要鉴权（未提供 WT_TOKEN，跳过 App 断言）');
    return;
  }

  const loginStatus = await ev(async ({ base, token }) => {
    const res = await fetch(base + 'api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: token }),
    });
    return res.status;
  }, { base: BASE, token: process.env.WT_TOKEN });
  if (loginStatus !== 200) {
    await p.close();
    throw new Error('登录失败（HTTP ' + loginStatus + '），WT_TOKEN 是否正确？');
  }
  await p.goto(BASE + '?full=' + Date.now(), { waitUntil: 'domcontentloaded' });
}

await p.waitForFunction(
  () => window.__wealthReady && typeof window.switchTab === 'function' && typeof window.toggleTheme === 'function',
  null,
  { timeout: 15000 },
).catch(async () => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(
    () => window.__wealthReady && typeof window.switchTab === 'function' && typeof window.toggleTheme === 'function',
    null,
    { timeout: 15000 },
  );
});

/* ---- ① 静态资源与 PWA ---- */
// 注意：用页面里的 fetch（走浏览器网络栈/代理），不要用 p.request（它直连，本机会超时）
const manifestProbe = await ev(async (base) => {
  const r = await fetch(base + 'manifest.json');
  if (!r.ok) return { status: r.status };
  try { return { status: r.status, json: await r.json() }; } catch (e) { return { status: r.status, json: null }; }
}, BASE);
const manifest = manifestProbe.json;
if (!manifest) failures.push('manifest.json 取不到或不是 JSON（HTTP ' + manifestProbe.status + '）');
else {
  for (const field of ['name', 'start_url', 'display', 'icons']) {
    if (!manifest[field]) failures.push('manifest 缺字段：' + field);
  }
  if (manifest.display !== 'standalone') notes.push('manifest.display = ' + manifest.display + '（不是 standalone）');
}
const swProbe = await ev(async (base) => {
  const r = await fetch(base + 'sw.js');
  return { status: r.status, text: r.ok ? await r.text() : '' };
}, BASE);
if (swProbe.status !== 200) failures.push('sw.js 取不到（HTTP ' + swProbe.status + '）');
else {
  const sw = swProbe.text;
  const m = sw.match(/wealth-v(\d+)/);
  if (!m) failures.push('sw.js 里没有版本号');
  else notes.push('线上 sw 版本 v' + m[1]);
}

/* ---- ② API 鉴权（无 token 应被挡；这里只验证"响应是结构化的、不是崩的"） ---- */
const apiProbe = await ev(async (base) => {
  const r = await fetch(base + 'api/quotes?symbols=VGT');
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body: body };
}, BASE);
if (!apiProbe.body) failures.push('GET /api/quotes 返回的不是 JSON（HTTP ' + apiProbe.status + '）');
else notes.push('/api/quotes 无 token → HTTP ' + apiProbe.status + '（' + JSON.stringify(apiProbe.body).slice(0, 70) + '…）');

/* ---- ②c 行情接口的入参防护：非法代码不该被当成合法请求 ---- */
const badProbe = await ev(async (base) => {
  const r = await fetch(base.replace(/\/$/, '') + '/api/quotes?symbols=' + encodeURIComponent('../../etc/passwd,<script>,VGT'));
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body: body };
}, BASE);
if (badProbe.status >= 500) failures.push('非法代码让 /api/quotes 返回 ' + badProbe.status + '（不该 5xx）');
else if (badProbe.body && badProbe.body.invalid && badProbe.body.invalid.length) {
  notes.push('/api/quotes 非法代码 → 被列进 invalid（' + badProbe.body.invalid.join(',') + '），合法代码照常返回');
} else {
  notes.push('/api/quotes 非法代码 → HTTP ' + badProbe.status + '（响应：' + JSON.stringify(badProbe.body || {}).slice(0, 60) + '…）');
}

/* ---- ③ 双视口 × 双主题：关键区块都在、切 tab 不报错 ---- */
const CHECK = () => {
  const byId = (id) => document.getElementById(id);
  const has = (sel) => document.querySelectorAll(sel).length;
  return {
    build: (byId('sbBuild') || {}).textContent,
    theme: document.documentElement.dataset.theme,
    bootFailed: document.body.innerText.indexOf('页面启动失败') >= 0,
    tabs: has('.tab-btn'),
    holdBody: !!byId('holdBody'),
    chartDonut: !!byId('chartDonut'),
    exposure: !!byId('holdExpose') || !!byId('exposureSlot'),
    watchRows: has('#watchRows .watch-row'),
    analysisPanel: !!byId('tab-analysis'),
    alerts: !!byId('qaAlerts'),
    bell: has('.ms-bell'),
    sidebar: has('.sidebar'),
    dataPanel: !!byId('tab-data'),
    lastError: window.__lastError || null,
  };
};

for (const [label, width, dark] of [['手机-浅色', 390, false], ['手机-深色', 390, true], ['桌面-浅色', 1280, false], ['桌面-深色', 1280, true]]) {
  await p.setViewportSize({ width: width, height: 900 });
  await ev((wantDark) => {
    const want = wantDark ? 'dark' : 'light';
    if (document.documentElement.dataset.theme !== want) {
      const button = document.getElementById('btnTheme');
      if (button) button.click();
    }
    document.documentElement.style.scrollBehavior = 'auto';
  }, dark);
  await p.waitForTimeout(700);
  for (const tab of ['bbConsole', 'bbAnalysis', 'bbData', 'bbHoldings']) {
    await ev((id) => { const b = document.getElementById(id); if (b) b.click(); }, tab);
    await p.waitForTimeout(900);
  }
  const snap = await ev(CHECK);
  if (snap.bootFailed) failures.push(label + '：出现「页面启动失败」兜底页');
  if (!/^v\d+$/.test(snap.build || '')) failures.push(label + '：版本号异常 ' + snap.build);
  if (snap.theme !== (dark ? 'dark' : 'light')) failures.push(label + '：主题没切成 ' + snap.theme);
  if (snap.tabs < 4) failures.push(label + '：底部 tab 少于 4 个（' + snap.tabs + '）');
  if (!snap.holdBody) failures.push(label + '：持仓表容器不存在');
  if (!snap.chartDonut) failures.push(label + '：甜甜圈 canvas 不存在');
  if (!snap.exposure) failures.push(label + '：底层资产敞口卡不存在');
  if (snap.watchRows < 1) failures.push(label + '：观察列表没渲染');
  if (!snap.alerts) failures.push(label + '：待办容器不存在');
  if (!snap.dataPanel || !snap.analysisPanel) failures.push(label + '：分析/记录面板容器缺失');
  if (snap.lastError) failures.push(label + '：__lastError = ' + snap.lastError);
  if (label === '手机-浅色') {
    if (snap.bell < 1) failures.push('手机端：铃铛入口不存在');
    if (snap.sidebar < 1) failures.push('手机端：侧栏不存在');
    notes.push('线上渲染：' + snap.build + ' · 观察 ' + snap.watchRows + ' 项 · tab ' + snap.tabs + ' 个 · 四种视口/主题都切过');
  }
}

/* ---- ④ Service Worker 是否在本次加载里注册成功 ---- */
const swState = await ev(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { hasReg: !!reg, scope: reg ? reg.scope : null, controlled: !!navigator.serviceWorker.controller };
});
if (!swState.hasReg) failures.push('Service Worker 没有注册成功');
else notes.push('SW 已注册（scope ' + swState.scope + '，controlled=' + swState.controlled + '）');

await ev(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

if (errors.length) failures.push('页面报错：' + errors.join(' | '));

console.log('线上完整验证（只读）：');
notes.forEach((n) => console.log('  · ' + n));
if (failures.length) {
  console.error('发现问题：\n  - ' + failures.join('\n  - '));
  throw new Error('prod-full failed');
}
console.log('✓ 线上完整验证通过（双视口 × 双主题 × PWA × API，全程只读、未留 token）');
