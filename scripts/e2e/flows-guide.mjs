// e2e：装了 Service Worker 之后，「使用文档」还能不能打开。
//
// 回归对象（v318 修）：sw.js 的导航分支以前对**任何**导航都先返回壳子缓存（`caches.match('/')`，
// 只显式排除了 /login），于是同作用域的 /guide 被 App 壳子顶掉 —— 用户点侧边栏的「使用文档」，
// 看到的是 App 又加载了一遍。本地默认的假云端复现不出来（它不发 X-WT-Shell，壳子进不了缓存），
// 所以这个场景依赖 mock-cloud.mjs 对齐真 Worker 的那两个行为。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));

// 先在非应用页清 SW 与缓存：避免首次加载就被"新版接管自动刷新"打断
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
});

// ① 正常打开 App，等 SW 接管 —— 这一步之后壳子才会进缓存，也就是 bug 的复现前提
await p.goto(BASE + '?guide=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
const sw = await p.evaluate(async () => ({
  controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
  caches: await caches.keys(),
}));

// ② 走侧边栏那个链接的真实路径（同作用域导航）
await p.goto(BASE + 'guide', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(600);
const guide = await p.evaluate(() => {
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    isAppShell: !!document.getElementById('holdBody') || !!document.getElementById('syncBar'),
    hasGuideHeading: text.includes('云端同步'),
    title: document.title,
  };
});

await p.evaluate(() => localStorage.clear());
await p.close();

const failures = [];
if (!sw.controller) failures.push('SW 没接管，测不到"壳子已缓存"这条路径');
if (!sw.caches.length) failures.push('启动后没有任何 Cache Storage');
if (guide.isAppShell) failures.push('打开 /guide 拿到的是 App 壳子 —— 壳子缓存又把文档顶掉了');
if (!guide.hasGuideHeading) failures.push('/guide 没渲染出文档内容（title="' + guide.title + '"）');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));

console.log('SW 控制器：' + sw.controller + ' · 缓存：' + JSON.stringify(sw.caches));
console.log('打开 /guide：title="' + guide.title + '" · 是 App 壳子=' + guide.isAppShell + ' · 含文档内容=' + guide.hasGuideHeading);
if (failures.length) {
  console.error('使用文档可达性失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-guide failed');
}
console.log('✓ 装了 SW 之后「使用文档」仍能正常打开');
