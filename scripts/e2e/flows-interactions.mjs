// e2e：交互流——记录页搜索过滤 / 清空+撤销 / 再平衡切换 / 备份结构。
// 断言：搜索真的隐藏不匹配行（手机端曾被 !important 盖掉）、清空可撤销、备份含观察列表。
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
p.on('dialog', (d) => { d.accept(); });   // 原生 confirm/alert 一律确认

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });   // 先在非应用页清 SW / 写种子：避免首次加载时 SW 自动 reload 打断初始化
await fetch(CLOUD + '/_reset').catch(() => {});   // 关键：清掉上一个场景推到假云端的数据，否则本地种子会被云端覆盖
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
  ]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([{ id: 11, date: '2026-09-02', type: '入金', amount: 5000 }]));
  localStorage.setItem('wealth_activity_v1', JSON.stringify([{ id: 101, date: '2026-09-20', time: '10:00', action: '买入 VGT', detail: '10 股 @ 100' }]));
  localStorage.setItem('wealth_watchlist_v1', JSON.stringify([
    { sym: 'VGT', enabled: true, order: 0 }, { sym: 'SMH', enabled: true, order: 1 }, { sym: 'IWM', enabled: true, order: 2 },
  ]));
  localStorage.setItem('wealth_options_v2', JSON.stringify([
    { id: 301, sym: 'VGT', type: 'CALL', strike: 100, premium: 120, contracts: 1, expiry: '2026-08-21', added: '2026-08-01' },
  ]));
});
await p.goto(BASE + '?fx=' + Date.now(), { waitUntil: 'domcontentloaded' });
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

/* A) 再平衡：换仓 / 注资切换 + 重算 */
await ev(() => document.getElementById('bbConsole').click());
await p.waitForTimeout(1500);
const rebalBefore = await ev(() => (document.getElementById('rebalContent') || {}).innerText.replace(/\s+/g, ' ').slice(0, 40));
await ev(() => {
  Array.from(document.querySelectorAll('.rb-mode-btn')).forEach((b) => b.click());
  const rb = document.getElementById('btnRebalanceRecalc');
  if (rb) rb.click();
});
await p.waitForTimeout(1500);
const rebalAfter = await ev(() => (document.getElementById('rebalContent') || {}).innerText.replace(/\s+/g, ' ').slice(0, 40));
if (rebalBefore === rebalAfter) failures.push('再平衡切到「注资」后内容没变化');

/* B) 记录页搜索：必须真的隐藏不匹配的行（手机端曾经被 !important 盖掉） */
await ev(() => document.getElementById('bbData').click());
await p.waitForTimeout(1500);
await ev(() => {
  const card = document.getElementById('tradeBody').closest('.collapsible-card');
  if (card && card.classList.contains('collapsed')) card.querySelector('.collapsible-header').click();
});
await p.waitForTimeout(900);
await ev(() => {
  const i = document.getElementById('dsSearchInput');
  i.value = 'SMH';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(2000);
const search = await ev(() => {
  const rows = Array.from(document.querySelectorAll('#tradeBody tr'));
  return {
    visible: rows.filter((r) => getComputedStyle(r).display !== 'none').length,
    hidden: rows.filter((r) => r.classList.contains('is-hidden-row')).length,
    total: rows.length,
  };
});
if (search.total > 1 && (search.hidden === 0 || search.visible !== 1)) {
  failures.push('搜索过滤没生效：' + search.total + ' 行里可见 ' + search.visible + '、隐藏 ' + search.hidden);
}
await ev(() => {
  const i = document.getElementById('dsSearchInput');
  i.value = '';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(1200);
const restored = await ev(() => Array.from(document.querySelectorAll('#tradeBody tr')).filter((r) => r.classList.contains('is-hidden-row')).length);
if (restored !== 0) failures.push('清空搜索后仍有 ' + restored + ' 行处于隐藏状态');

/* C) 清空交易 + 撤销 */
const tradesBefore = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
await ev(() => document.getElementById('btnClearTrades').click());
await p.waitForTimeout(900);
await ev(() => {
  const ok = document.querySelector('.ds-approval-card [data-act="ok"]');
  if (ok) ok.click();
});
await p.waitForTimeout(1800);
const cleared = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
if (cleared !== 0) failures.push('清空交易没生效（还剩 ' + cleared + ' 笔）');
await ev(() => {
  const b = document.querySelector('#syncToast .toast-action');
  if (b) b.click();
});
await p.waitForTimeout(1500);
const undone = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
if (undone !== tradesBefore) failures.push('撤销清空没把交易恢复（' + undone + ' vs ' + tradesBefore + '）');

/* D) 期权：过期那张应能「结算」（原生 confirm 已在上面自动确认） */
await ev(() => document.getElementById('bbOption').click());
await p.waitForTimeout(1800);
const settleBtns = await ev(() => document.querySelectorAll('#tab-option .opt-settle').length);
if (settleBtns < 1) failures.push('过期期权没有出现「结算」按钮');
await ev(() => {
  const b = document.querySelector('#tab-option .opt-settle');
  if (b) b.click();
});
await p.waitForTimeout(2000);
const settled = await ev(() => JSON.parse(localStorage.getItem('wealth_options_v2') || '[]').filter((o) => o.settled).length);
if (settled < 1) failures.push('点结算后没有标记为已结算');

/* E) 备份结构：必须含观察列表（曾经漏掉） */
const backup = await ev(() => {
  const d = createBackupData();
  return { hasWatchlist: Array.isArray(d.watchlist), watch: (d.watchlist || []).map((x) => x.sym), keys: Object.keys(d) };
});
if (!backup.hasWatchlist) failures.push('备份文件里没有 watchlist');

/* F) 策略工具：档位就地编辑 + 提款滑杆 → 写进 state.plan（v235 把这块逻辑抽成了 plan.js） */
await ev(() => document.getElementById('bbConsole').click());
await p.waitForTimeout(1400);
await ev(() => {
  const card = document.getElementById('strategyTools');
  if (card && card.classList.contains('collapsed')) card.querySelector('.collapsible-header').click();
});
await p.waitForTimeout(900);
const planBefore = await ev(() => JSON.parse(localStorage.getItem('wealth_dashboard_v2') || '{}').plan || null);
await ev(() => {
  const el = document.querySelector('.plan-edit[data-plan="income"][data-i="0"][data-k="0"]');
  if (!el) return;
  el.textContent = '起步期E2E';
  el.dispatchEvent(new Event('focusout', { bubbles: true }));
});
await p.waitForTimeout(800);
await ev(() => {
  const el = document.getElementById('rWdRate');
  if (!el) return;
  el.value = '3.5';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(900);
const planAfter = await ev(() => {
  const p = JSON.parse(localStorage.getItem('wealth_dashboard_v2') || '{}').plan || {};
  return {
    tier0: p.income && p.income[0] ? p.income[0][0] : null,
    rate: p.wd ? p.wd.rate : null,
    deplete: (document.getElementById('wdDeplete') || {}).textContent,
    annual: (document.getElementById('wdAnnual') || {}).textContent,
  };
});
if (planAfter.tier0 !== '起步期E2E') failures.push('档位就地编辑没写进 state.plan（读到 ' + planAfter.tier0 + '）');
if (planAfter.rate !== 3.5) failures.push('提款滑杆没写进 state.plan.wd.rate（读到 ' + planAfter.rate + '）');
if (!planAfter.annual || planAfter.annual === '$0.00') failures.push('提款模拟没算出年提款额');

await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

console.log('交互流：搜索 ' + search.total + ' 行→可见 ' + search.visible + '（隐藏 ' + search.hidden + '）· 清空 ' + tradesBefore + '→' + cleared + '→撤销 ' + undone + ' · 结算按钮 ' + settleBtns + ' 个 · 备份含观察列表 ' + backup.hasWatchlist);
console.log('策略工具：档位=' + planAfter.tier0 + ' · 提款率=' + planAfter.rate + '% · 年提款=' + planAfter.annual + ' · 耗尽=' + planAfter.deplete + (planBefore ? '' : '（此前无 plan）'));
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('交互流测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-interactions failed');
}
console.log('✓ 搜索过滤 / 清空撤销 / 期权结算 / 备份结构 全部正常');
