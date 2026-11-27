// v444：币种只是展示层 —— 切换不写 state、不推云端；每次打开默认美元。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.setViewportSize({ width: 1280, height: 900 });
const syncs = [];
p.on('request', (r) => { if (r.url().indexOf('/api/sync') >= 0 && r.method() === 'POST') syncs.push(r.postData() || ''); });
await p.route('**/*', (r) => { let h = ''; try { h = new URL(r.request().url()).hostname; } catch (e) {} return h === HOST ? r.continue() : r.abort(); });
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(CLOUD + '/_reset').catch(() => {});
await p.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
  localStorage.setItem('wealth_cash_v2', '1000');
});
await p.goto(BASE + '?cur=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
const usd = await p.evaluate(() => ({ active: (document.querySelector('#currencySwitch [data-currency].active') || {}).getAttribute ? document.querySelector('#currencySwitch [data-currency].active').getAttribute('data-currency') : '', total: (document.getElementById('hmTotal') || {}).textContent || '' }));
await p.evaluate(() => document.querySelector('#currencySwitch [data-currency="CNY"]').click());
await p.waitForTimeout(2500);
const cny = await p.evaluate(() => ({
  active: (document.querySelector('#currencySwitch [data-currency].active') || {}).getAttribute ? document.querySelector('#currencySwitch [data-currency].active').getAttribute('data-currency') : '',
  total: (document.getElementById('hmTotal') || {}).textContent || '',
  stored: (() => { try { return JSON.parse(localStorage.getItem('wealth_dashboard_v2') || '{}').displayCurrency; } catch (e) { return ''; } })(),
}));
const beforeReload = syncs.length;
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500);
const after = await p.evaluate(() => ({ active: (document.querySelector('#currencySwitch [data-currency].active') || {}).getAttribute ? document.querySelector('#currencySwitch [data-currency].active').getAttribute('data-currency') : '', total: (document.getElementById('hmTotal') || {}).textContent || '' }));
const failures = [];
if (usd.active !== 'USD') failures.push('首次打开默认应是美元，实际 ' + usd.active);
if (cny.active !== 'CNY' || !/^¥/.test(cny.total)) failures.push('切到人民币后主金额没有换算：' + JSON.stringify(cny));
if (cny.stored && cny.stored !== 'USD') failures.push('币种被写进了 state（应为 USD 不变）：' + cny.stored);
if (beforeReload !== 0) failures.push('切换币种触发了云端推送（应为 0 次）：' + beforeReload);
if (after.active !== 'USD' || !/^\$/.test(after.total)) failures.push('重新打开后没有回到美元：' + JSON.stringify(after));
if (failures.length) { console.error('币种展示层失败：\n  - ' + failures.join('\n  - ')); throw new Error('flows-currency-default failed'); }
console.log('币种：默认 ' + usd.active + ' → 切换 ' + cny.active + '（' + cny.total + '）→ 重开 ' + after.active + ' · 切换推送 ' + beforeReload + ' 次');
console.log('✓ 人民币只是展示层，云端/本地始终美元');
return { usd, cny, after };
