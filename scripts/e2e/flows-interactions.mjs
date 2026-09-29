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
// 记录页顶部汇总（v236 改用 rows.js 的 dataPageTotals 计算）
const totals = await ev(() => ({
  dep: (document.getElementById('dataDep') || {}).textContent,
  sel: (document.getElementById('dataSel') || {}).textContent,
  buy: (document.getElementById('dataBuy') || {}).textContent,
}));
if (totals.dep !== '$5,000.00') failures.push('累计入金应为 $5,000.00，实际 ' + totals.dep);
if (totals.sel !== '$0.00') failures.push('累计卖出应为 $0.00，实际 ' + totals.sel);
if (!totals.buy || totals.buy === '$0.00') failures.push('累计买入应大于 0，实际 ' + totals.buy);
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

/* G) 观察列表状态机：添加一只标的 → 落库 + 进「关注」组 + 推到云端（v237 抽到 watch.js） */
const watchBefore = await ev(() => JSON.parse(localStorage.getItem('wealth_watchlist_v1') || '[]').map((x) => x.sym));
await ev(() => document.getElementById('btnWatchAddOpen').click());
await p.waitForTimeout(500);
await ev(() => {
  const i = document.getElementById('watchSearchInput');
  i.value = 'spy';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(1500);
const addRow = await ev(() => {
  const rows = Array.from(document.querySelectorAll('#watchSearchList .watch-search-row'));
  const hit = rows.filter((r) => ((r.querySelector('.wsr-sym') || {}).textContent || '') === 'SPY')[0];
  const btn = hit && hit.querySelector('button');
  if (btn) btn.click();
  return { found: !!hit, btnText: btn ? btn.textContent.trim() : null };
});
await p.waitForTimeout(2000);
const watchAfter = await ev(() => {
  const list = JSON.parse(localStorage.getItem('wealth_watchlist_v1') || '[]').map((x) => x.sym);
  const rows = Array.from(document.querySelectorAll('#watchRows .watch-row')).map((r) => r.getAttribute('data-sym'));
  const groups = Array.from(document.querySelectorAll('#watchRows .watch-group')).map((g) => ({
    title: (g.querySelector('.wg-name') || {}).textContent,
    count: (g.querySelector('.wg-count') || {}).textContent,
  }));
  return { list, rows, groups };
});
await p.waitForTimeout(1500);
const cloudWatch = await (await fetch(CLOUD + '/_log')).json();
await ev(() => document.getElementById('btnWatchAddOpen').click());
if (!watchAfter.list.includes('SPY')) failures.push('添加 SPY 没写进本地观察列表（现有 ' + watchAfter.list.join(',') + '）');
if (!watchAfter.rows.includes('SPY')) failures.push('添加后列表里没有 SPY 行');
if (!(cloudWatch.store.watchlist || []).some((x) => x.sym === 'SPY')) failures.push('观察列表改动没推到云端');

/* H) 拉取路径：模拟另一台设备改云端 → 本机应自动拉下来（v240 抽了同步决策层） */
await fetch(CLOUD + '/_seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    state: {
      monthlyDCA: 4321, dcaOverride: { month: '', amount: 0 }, roadmapStart: '2025-01', roadmapAge: 27,
      sgovTarget: 0, targetGoal: 2500000, vgt: 0.5, smh: 0.3, btc: 0.2, plan: null,
    },
  }),
});
await ev(() => {
  // 页面本来就可见，这里显式派发一次让 autoPull 跑起来
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(2600);
const pulledDca = await ev(() => JSON.parse(localStorage.getItem('wealth_dashboard_v2') || '{}').monthlyDCA);
if (pulledDca !== 4321) failures.push('云端更新后没有自动拉取（monthlyDCA 应为 4321，实际 ' + pulledDca + '）');

/* I) 两个入口体验（v242）：① 现金不足要引导去入金 ② 数据健康可点直达同步设置 */
await ev(() => document.getElementById('bbConsole').click());
await p.waitForTimeout(1400);
await ev(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('tfDate', '2026-09-28');
  set('tfPrice', '500');
  set('tfShares', '100');            // 50,000 > 可用现金 34,000
  const buy = Array.from(document.querySelectorAll('.segment[data-trade-type]')).filter((b) => b.getAttribute('data-trade-type') === 'buy')[0];
  if (buy && !buy.classList.contains('active')) buy.click();
  const chip = Array.from(document.querySelectorAll('.asset-chip[data-asset]')).filter((b) => b.getAttribute('data-asset') === 'VGT')[0];
  if (chip && !chip.classList.contains('active')) chip.click();
});
await p.waitForTimeout(400);
await ev(() => document.getElementById('btnAddTrade').click());
await p.waitForTimeout(1200);
const cashGuard = await ev(() => ({
  toast: (document.getElementById('syncToast') || {}).textContent || '',
  focused: document.activeElement ? document.activeElement.id : '',
  trades: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
}));
if (!/现金不足/.test(cashGuard.toast)) failures.push('现金不足时没有给出提示');
if (!/入金/.test(cashGuard.toast)) failures.push('现金不足的提示没引导去入金：' + cashGuard.toast);
if (cashGuard.focused !== 'hmCashAmt') failures.push('现金不足时没有把光标带到入金输入框（焦点在 ' + cashGuard.focused + '）');
if (cashGuard.trades === 0) failures.push('现金不足竟然把交易录进去了');

/* I2 数据健康可点 → 打开同步设置并展开连接配置 */
await ev(() => {
  const row = document.querySelector('.sb-health-list .sb-health-row');
  if (row) row.click();
});
await p.waitForTimeout(900);
const healthJump = await ev(() => ({
  syncPanelOpen: !!(document.getElementById('syncPanel') || {}).classList && document.getElementById('syncPanel').classList.contains('open'),
  panelVisible: (() => { const el = document.getElementById('settingsSync'); return !!el && el.getBoundingClientRect().height > 0; })(),
  settingsOpen: (() => { const sec = document.querySelector('.sb-section.sb-settings'); return !!sec && (sec.classList.contains('open') || sec.getBoundingClientRect().height > 0); })(),
}));
if (!healthJump.settingsOpen) failures.push('点数据健康没有打开设置面板');
if (!healthJump.panelVisible) failures.push('同步设置面板打开后仍不可见（移动端曾被整屏设置面板挡住）');
if (!healthJump.syncPanelOpen) failures.push('点数据健康没有自动展开「连接配置」');

await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

console.log('交互流：搜索 ' + search.total + ' 行→可见 ' + search.visible + '（隐藏 ' + search.hidden + '）· 清空 ' + tradesBefore + '→' + cleared + '→撤销 ' + undone + ' · 结算按钮 ' + settleBtns + ' 个 · 备份含观察列表 ' + backup.hasWatchlist);
console.log('记录页汇总：累计入金 ' + totals.dep + ' · 累计买入 ' + totals.buy + ' · 累计卖出 ' + totals.sel);
console.log('入口体验：现金不足提示="' + cashGuard.toast.slice(0, 40) + '" 焦点=' + cashGuard.focused + ' · 移动端同步面板可见=' + healthJump.panelVisible + ' · 连接配置展开=' + healthJump.syncPanelOpen);
console.log('策略工具：档位=' + planAfter.tier0 + ' · 提款率=' + planAfter.rate + '% · 年提款=' + planAfter.annual + ' · 耗尽=' + planAfter.deplete + (planBefore ? '' : '（此前无 plan）'));
console.log('观察列表：' + watchBefore.length + ' → ' + watchAfter.list.length + ' 项（添加 SPY：按钮="' + addRow.btnText + '"，分组 ' + watchAfter.groups.map((g) => g.title + g.count).join('/') + '，云端 ' + (cloudWatch.store.watchlist || []).length + ' 项）');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('交互流测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-interactions failed');
}
console.log('✓ 搜索过滤 / 清空撤销 / 期权结算 / 备份结构 全部正常');

