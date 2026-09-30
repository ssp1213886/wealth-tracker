// e2e：未登录时只能拿到登录页，且登录页绝不能进「壳子缓存」。
//
// 背景（v318 那个坑的另一半）：真 Worker 除 /login /sw.js /manifest.json /icon* /splash/* 之外，
// 文档导航一律回登录页、/api/* 一律回 401。假云端以前没有这道门禁，所以"登录页 vs 壳子"这类问题
// 在本地根本测不出来（v318 的 /guide 被壳子顶掉就是这么漏掉的）。
// 这里用 POST /_gate 打开门禁（默认关，不影响其它场景；_reset 也会关掉）。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
});
await p.evaluate(() => { try { document.cookie = 'wt_uid=; Max-Age=0; path=/'; } catch (e) { /* 忽略 */ } });

const failures = [];
const setGate = (on) => fetch(CLOUD + '/_gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });

// ① 门禁关着：正常打开一次，让 SW 接管并缓存壳子（这是后面能测到"登录页覆盖壳子"的前提）
await p.goto(BASE + '?warm=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
const warm = await p.evaluate(async () => ({
  controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
  shellCached: !!(await caches.match('/')),
}));

// ② 门禁打开（相当于会话过期）：同一个地址必须回登录页 —— 而且**不能把壳子缓存覆盖成登录页**
await setGate(true);
await p.goto(BASE + '?gate=' + Date.now(), { waitUntil: 'domcontentloaded' });
// 注意：SW 可能先返回缓存里的真壳子，App 起来后 /api 全 401 → guardUnauthorized 跳 /login。
// 所以这里等跳转落定，并且用"带重试"的求值（导航会把执行上下文销毁）。
const ev = async (fn) => {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await p.waitForTimeout(700);
    }
  }
  throw last;
};
await p.waitForTimeout(2000);
const home = await ev(() => ({
  isAppShell: !!document.getElementById('holdBody') || !!document.getElementById('syncBar') || !!document.getElementById('msPageTitle'),
  isLogin: /请登录/.test(document.body.innerText || ''),
}));
home.shellAfter = await ev(async () => {
  const hit = await caches.match('/');
  if (!hit) return '(无缓存)';
  const text = await hit.text();
  if (/请登录/.test(text)) return '登录页';
  return /holdBody|msPageTitle/.test(text) ? '真壳子' : '其它';
});

// ③ /guide 也必须回登录页（真 Worker 一样会 gate 它）
await p.goto(BASE + 'guide', { waitUntil: 'domcontentloaded' });
const guide = await ev(() => ({
  isLogin: /请登录/.test(document.body.innerText || ''),
  isGuide: /同步提示胶囊/.test(document.body.innerText || ''),
  isAppShell: !!document.getElementById('holdBody'),
}));

// ④ /api/* 必须 401（从 Node 侧发，免得页面里的 guardUnauthorized 把页面跳去 /login）
const apiRes = await fetch(CLOUD + '/api/sync');
const apiStatus = apiRes.status;

// ⑤ 关掉门禁后，同一个地址必须能拿到真壳子（说明只是门禁在起作用，不是别的东西坏了）
await setGate(false);
await p.goto(BASE + '?gate=off-' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const after = await p.evaluate(() => ({
  isAppShell: !!document.getElementById('holdBody') || !!document.getElementById('syncBar'),
  isLogin: /请登录/.test(document.body.innerText || ''),
}));

await p.evaluate(() => localStorage.clear());
await p.close();

if (!warm.controller) failures.push('预热阶段 SW 没接管，后面测不到"登录页覆盖壳子"');
if (!warm.shellCached) failures.push('预热阶段壳子没进缓存');
if (home.isAppShell) failures.push('未登录时打开首页拿到了 App 壳子');
if (!home.isLogin) failures.push('未登录时首页不是登录页');
if (home.shellAfter === '登录页') failures.push('登录页把壳子缓存覆盖掉了（登出后会永远回不去）');
if (home.shellAfter !== '真壳子') failures.push('壳子缓存内容异常：' + home.shellAfter);
if (!guide.isLogin || guide.isGuide || guide.isAppShell) failures.push('/guide 在未登录时没有回登录页');
if (apiStatus !== 401) failures.push('/api/sync 未登录时应回 401，实际 ' + apiStatus);
if (!after.isAppShell || after.isLogin) failures.push('关掉门禁后应能拿到真壳子');

console.log('预热：SW=' + (warm.controller ? '已接管' : '未接管') + ' · 壳子进缓存=' + warm.shellCached);
console.log('未登录首页：登录页=' + home.isLogin + ' · 壳子=' + home.isAppShell + ' · 壳子缓存=' + home.shellAfter);
console.log('/guide 未登录：登录页=' + guide.isLogin + ' · 文档=' + guide.isGuide + ' · 壳子=' + guide.isAppShell + ' · /api/sync=' + apiStatus);
console.log('关掉门禁后：壳子=' + after.isAppShell + ' · 登录页=' + after.isLogin);
if (failures.length) {
  console.error('登录门禁失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-auth-gate failed');
}
console.log('✓ 未登录只能看到登录页，且不会污染壳子缓存');
