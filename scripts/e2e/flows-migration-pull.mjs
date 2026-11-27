const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.setViewportSize({ width: 1280, height: 900 });
const seq = [];
p.on('request', (r) => { if (r.url().indexOf('/api/sync') >= 0) seq.push(r.method()); });
p.on('response', (r) => { if (r.url().indexOf('/api/sync') >= 0) seq[seq.length - 1] += ':' + r.status(); });
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === HOST ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(CLOUD + '/_reset').catch(() => {});
await p.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin }));
});
await p.goto(BASE + '?mig=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
/* 让云端先有一份 state（monthlyDCA=2000），本机也推过一次，cloudTs 才是真实的 */
await p.evaluate(() => {
  const input = document.getElementById('monthlyDCAInput');
  if (input) { input.value = '2000'; input.dispatchEvent(new Event('change', { bubbles: true })); }
});
await p.waitForTimeout(2500);
const cloud1 = await (await fetch(CLOUD + '/api/sync')).json();
const seeded = Object.assign({}, (cloud1.data && cloud1.data.state) || {}, { monthlyDCA: 4321 });
await fetch(CLOUD + '/_seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: seeded }) });
await p.evaluate(() => {
  const ns = (Object.keys(localStorage).map((k) => (k.match(/^(u\d+:)/) || [])[1]).filter(Boolean)[0]) || '';
  const stKey = ns + 'wealth_sync_state';
  const st = (() => { try { return JSON.parse(localStorage.getItem(stKey) || '{}'); } catch (e) { return {}; } })();
  st.dirty = {};                     // 本地干净
  localStorage.setItem(stKey, JSON.stringify(st));
  localStorage.setItem(ns + 'wealth_core_migration_v4_pending', '1');
});
seq.length = 0;
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);
const out = await p.evaluate(() => {
  const ns = (Object.keys(localStorage).map((k) => (k.match(/^(u\d+:)/) || [])[1]).filter(Boolean)[0]) || '';
  const st = (() => { try { return JSON.parse(localStorage.getItem(ns + 'wealth_sync_state') || '{}'); } catch (e) { return {}; } })();
  const mig = localStorage.getItem(ns + 'wealth_core_migration_v4_pending');
  const input = document.getElementById('monthlyDCAInput');
  const saved = (() => { try { return JSON.parse(localStorage.getItem(ns + 'wealth_dashboard_v2') || '{}'); } catch (e) { return {}; } })();
  return {
    monthlyDCA: input ? input.value : '',
    savedMonthlyDCA: saved.monthlyDCA,
    migrationFlag: mig,
    failStreak: st.failStreak,
    lastError: st.lastSyncError,
    dirty: st.dirty,
    msSync: (document.getElementById('msSyncText') || {}).textContent || '',
    modal: !!document.getElementById('conflictModal'),
  };
});
const failures = [];
if (String(out.monthlyDCA) !== '4321') failures.push('迁移标记存在 + 本地干净时没有拉到云端 monthlyDCA=4321，实际 ' + out.monthlyDCA);
if (out.migrationFlag === '1') failures.push('迁移标记没有被清掉');
if (out.failStreak > 0) failures.push('出现同步失败（failStreak=' + out.failStreak + '）');
if (seq.length > 6) failures.push('同步请求过多（' + seq.length + ' 次），疑似重试环');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
console.log('迁移引导：请求 ' + seq.join(' · ') + ' · monthlyDCA=' + out.monthlyDCA + ' · 迁移标记=' + (out.migrationFlag || '已清') + ' · failStreak=' + out.failStreak);
if (failures.length) {
  console.error('迁移后自动拉取失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-migration-pull failed');
}
console.log('✓ 迁移标记存在且本地无待推键时，仍能拉到云端更新');
return { seq: seq.slice(0, 10), out, failures };
