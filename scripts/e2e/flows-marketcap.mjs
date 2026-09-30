// e2e：市值信息与「按市值排序」。
// 断言：① 敞口卡点开有「总市值」；② 观察列表点开有「总市值」；③ 排序切到「市值」后最高的排最前；④ 缺市值的排最后。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === new URL(BASE).hostname ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(CLOUD + '/_reset').catch(() => {});
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
  // NVDA 不在持仓里，只用来验证排序；SKHYV 故意不给市值，应该排最后
  localStorage.setItem('wealth_watchlist_v1', JSON.stringify([
    { sym: 'IWM', enabled: true, order: 0 }, { sym: 'NVDA', enabled: true, order: 1 },
    { sym: 'SKHYV', enabled: true, order: 2 }, { sym: 'VGT', enabled: true, order: 3 },
    { sym: 'SMH', enabled: true, order: 4 },
  ]));
});
await p.goto(BASE + '?mcap=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
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

/* A) 观察列表：点开行详情 → 有「总市值」 */
const watchDetail = await ev(() => {
  const row = document.querySelector('#watchRows .watch-row');
  if (!row) return { ok: false, why: '观察列表没有行' };
  row.click();
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains('row-detail')) return { ok: false, why: '点开没有出现行详情' };
  const text = detail.innerText.replace(/\s+/g, ' ');
  return { ok: true, text, hasCap: text.includes('总市值') };
});
if (!watchDetail.ok) failures.push('观察列表行详情：' + watchDetail.why);
else if (!watchDetail.hasCap) failures.push('观察列表行详情里没有「总市值」：' + watchDetail.text.slice(0, 80));

/* B) 排序切到「市值」：最高的排最前，缺市值的排最后 */
const sortClicked = await ev(() => {
  document.getElementById('btnWatchMore').click();
  const btn = document.querySelector('[data-watch-sort="cap"]');
  if (!btn) return { ok: false, why: '菜单里没有「市值」排序按钮' };
  btn.click();
  return { ok: true, on: btn.classList.contains('is-on') };
});
// 重排后 watch 行会被重建，data-sym 由 MutationObserver 补上——等它跑完再读
await p.waitForTimeout(800);
const sorted = sortClicked.ok ? await ev(() => ({
  ok: true,
  groups: Array.from(document.querySelectorAll('#watchRows .watch-group')).map((g) => ({
    title: (g.querySelector('.wg-name') || {}).textContent,
    rows: Array.from(g.querySelectorAll('.watch-row')).map((r) => r.getAttribute('data-sym')),
  })),
  rows: Array.from(document.querySelectorAll('#watchRows .watch-row')).map((r) => r.getAttribute('data-sym')),
  on: !!document.querySelector('[data-watch-sort="cap"].is-on'),
})) : sortClicked;
if (!sorted.ok) failures.push('市值排序：' + sorted.why);
else {
  // 排序是在「持仓 / 关注」各自分组内生效的（和涨跌、价格两个排序一致）
  const held = sorted.groups.find((g) => g.title === '持仓') || { rows: [] };
  const watchGroup = sorted.groups.find((g) => g.title === '关注') || { rows: [] };
  // 关注组：NVDA 5.48T 最大排第一；没有市值的 SKHYV 必须垫底
  if (watchGroup.rows[0] !== 'NVDA') failures.push('按市值排序后关注组第一行应为 NVDA，实际 ' + watchGroup.rows.join(','));
  if (watchGroup.rows[watchGroup.rows.length - 1] !== 'SKHYV') failures.push('没有市值的 SKHYV 应该排最后，实际 ' + watchGroup.rows.join(','));
  // 持仓组：SMH 78.5B > VGT 7.0B
  if (held.rows[0] !== 'SMH') failures.push('按市值排序后持仓组第一行应为 SMH，实际 ' + held.rows.join(','));
  if (!sorted.on) failures.push('「市值」按钮没有点亮');
}

/* C) 敞口卡：点开穿透行 → 有「总市值」；SMH 的 SKHYV 必须在列表里 */
const exposure = await ev(() => {
  const expo = document.getElementById('holdExpose');
  if (!expo) return { ok: false, why: '敞口卡不存在' };
  const syms = Array.from(expo.querySelectorAll('.hold-row[data-sym]')).map((r) => r.getAttribute('data-sym'));
  const row = expo.querySelector('.hold-row[data-sym="SKHYV"]') || expo.querySelector('.hold-row[data-sym]');
  if (!row) return { ok: false, why: '敞口卡里没有可点开的数据行', syms };
  row.click();
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains('row-detail')) return { ok: false, why: '敞口行点开没有出现详情', syms };
  const text = detail.innerText.replace(/\s+/g, ' ');
  return { ok: true, syms, text, hasCap: text.includes('总市值') };
});
if (!exposure.ok) failures.push('底层资产敞口：' + exposure.why + (exposure.syms ? '（现有 ' + exposure.syms.join(',') + '）' : ''));
else {
  if (!exposure.hasCap) failures.push('敞口行详情里没有「总市值」：' + exposure.text.slice(0, 80));
  // SK Hynix 是本轮事故的主角：SMH 榜单换了源之后它必须回来
  if (!exposure.syms.includes('SKHYV')) failures.push('底层资产敞口里没有 SKHYV（现有 ' + exposure.syms.join(',') + '）');
}

/* D) 敞口卡脚注要标出榜单来源，方便肉眼核对 */
const sourceText = await ev(() => {
  const expo = document.getElementById('holdExpose');
  const meta = expo && expo.querySelector('.watch-meta');
  return meta ? meta.textContent.replace(/\s+/g, ' ') : '';
});
if (!sourceText.includes('榜单')) failures.push('敞口卡脚注没有标出榜单来源：' + sourceText.slice(0, 80));

await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

console.log('市值：观察行详情 ' + (watchDetail.hasCap ? '有' : '无') + '「总市值」 · 排序 ' + (sorted.rows || []).join(' > '));
console.log('敞口：SKHYV ' + (exposure.syms && exposure.syms.includes('SKHYV') ? '在列' : '缺失') + ' · 共 ' + ((exposure.syms && exposure.syms.length) || 0) + ' 行 · 脚注「' + sourceText.slice(0, 60) + '」');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('市值流测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-marketcap failed');
}
console.log('✓ 市值展示 / 市值排序 / SKHYV 回归 全部正常');
