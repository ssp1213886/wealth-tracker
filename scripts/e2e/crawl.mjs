// e2e：全页爬查——把所有标签页 / 设置面板 / 折叠卡 / 分段切换过一遍，收集 JS 报错。
// 需要：调试 Chrome（9222）+ scripts/e2e/mock-cloud.mjs（由 npm run e2e 自动拉起）。
// 断言：全程 0 报错、页面没有启动失败、关键区块都渲染出来。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });   // 与用户手机一致
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  const local = new URL(BASE).hostname;
  return host === local ? route.continue() : route.abort();   // 拦住一切外部请求，只打假云端
});
const consoleErrors = [];
p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e && e.message)));
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // 被上面 route 拦掉的外部资源会报 ERR_FAILED，属测试环境噪音
  if (/ERR_FAILED|ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(text)) return;
  consoleErrors.push('console.error: ' + text.slice(0, 200));
});

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });   // 先在非应用页清 SW / 写种子：避免首次加载时 SW 自动 reload 打断初始化
await fetch(CLOUD + '/_reset').catch(() => {});   // 每个场景都从干净的假云端开始，避免互相污染
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
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([{ id: 11, date: '2026-09-02', type: '入金', amount: 5000 }]));
  localStorage.setItem('wealth_activity_v1', JSON.stringify([
    { id: 101, date: '2026-09-20', time: '10:00', action: '买入 VGT', detail: '10 股 @ 100' },
    { id: 102, date: '2026-09-21', time: '11:00', action: '入金', detail: '$2,000' },
  ]));
  localStorage.setItem('wealth_options_v2', JSON.stringify([
    { id: 201, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20' },
  ]));
  localStorage.setItem('otmSettings', JSON.stringify({ vgt: 7, smh: 5 }));
  localStorage.setItem('exit_portfolio', '测试退出策略');
});
await p.goto(BASE + '?crawl=' + Date.now(), { waitUntil: 'domcontentloaded' });
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
const problems = [];
let lastSeenError = null;
async function step(label, fn, waitMs, arg) {
  const before = consoleErrors.length;
  try {
    if (fn) await ev(fn, arg);
  } catch (e) {
    problems.push(label + ' → 执行报错: ' + String(e && e.message).slice(0, 160));
  }
  await p.waitForTimeout(waitMs === undefined ? 700 : waitMs);
  const errs = consoleErrors.slice(before);
  if (errs.length) problems.push(label + ' → ' + errs.join(' | '));
  const lastError = await ev(() => window.__lastError || null);
  if (lastError && lastError !== lastSeenError) problems.push(label + ' → __lastError: ' + String(lastError).slice(0, 160));
  lastSeenError = lastError;
}
const clickId = (tabId) => document.getElementById(tabId).click();

await step('仪表盘', clickId, 1600, 'bbHoldings');
await step('操作台', clickId, 1600, 'bbConsole');
await step('期权', clickId, 1600, 'bbOption');
await step('记录', clickId, 1600, 'bbData');
await step('记录-日志', () => { const b = Array.from(document.querySelectorAll('#recordSeg .record-seg')).filter((x) => x.getAttribute('data-seg') === 'log')[0]; if (b) b.click(); }, 1300);
await step('记录-明细', () => { const b = Array.from(document.querySelectorAll('#recordSeg .record-seg')).filter((x) => x.getAttribute('data-seg') === 'data')[0]; if (b) b.click(); }, 1300);
await step('设置抽屉', () => { if (typeof openMobileSettings === 'function') openMobileSettings(); }, 900);
for (const sec of ['sync', 'price', 'data', 'preferences']) {
  await step('设置-' + sec, (s) => { if (typeof openAdvancedSettings === 'function') openAdvancedSettings(s); }, 700, sec);
}
// 数据健康那几行文案来自 settings.js 的纯逻辑（v239），这里钉住它们确实渲染出来了
const healthText = await ev(() => ({
  state: (document.getElementById('sbSyncState') || {}).textContent,
  cloud: (document.getElementById('sbSyncLast') || {}).textContent,
  push: (document.getElementById('sbLastPush') || {}).textContent,
  conflict: (document.getElementById('sbConflictState') || {}).textContent,
}));
await step('观察-搜索面板', clickId, 700, 'btnWatchAddOpen');
await step('观察-搜索输入', () => { const i = document.getElementById('watchSearchInput'); i.value = 'nvda'; i.dispatchEvent(new Event('input', { bubbles: true })); }, 1800);
// 搜索模块抽出后，这里顺便钉住"能按名称搜到票"（回归 BRK-B 这类别名）
await ev(() => {
  const i = document.getElementById('watchSearchInput');
  i.value = 'berkshire';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(1600);
const searchTop = await ev(() => {
  const row = document.querySelector('#watchSearchList .watch-search-row');
  return row ? (row.querySelector('.wsr-sym') || {}).textContent : null;
});
await step('观察-关搜索', clickId, 500, 'btnWatchAddOpen');
await step('观察-⋯菜单', clickId, 500, 'btnWatchMore');
await step('观察-管理面板', clickId, 900, 'watchMenuManage');
await step('观察-收起管理', clickId, 500, 'btnWatchManageClose');
await step('观察-分组折叠', () => { const g = document.querySelectorAll('#watchRows .watch-group')[1]; if (g) g.querySelector('.watch-group-head').click(); }, 800);
await step('观察-分组展开', () => { const g = document.querySelectorAll('#watchRows .watch-group')[1]; if (g) g.querySelector('.watch-group-head').click(); }, 800);
await step('观察-行详情', () => document.querySelector('#watchRows .watch-row').click(), 800);
await step('提醒面板', () => { const b = Array.from(document.querySelectorAll('[onclick*="qaToggle"], .ms-bell')).filter((el) => el.offsetParent)[0]; if (b) b.click(); }, 900);
await step('主题切换', () => { if (typeof toggleTheme === 'function') toggleTheme(); }, 700);
await step('主题切回', () => { if (typeof toggleTheme === 'function') toggleTheme(); }, 700);
for (const tab of ['bbHoldings', 'bbConsole', 'bbOption', 'bbData']) {
  await ev((id) => document.getElementById(id).click(), tab);
  await p.waitForTimeout(1300);
  await step(tab + '-展开全部折叠卡', () => {
    Array.from(document.querySelectorAll('.collapsible-card .collapsible-header')).forEach((h) => h.click());
  }, 1600);
}

const summary = await ev(() => ({
  build: (document.getElementById('sbBuild') || {}).textContent,
  bootFailed: document.body.innerText.indexOf('页面启动失败') >= 0,
  watchRows: document.querySelectorAll('#watchRows .watch-row').length,
  activityRows: document.querySelectorAll('#activityLog .activity-item').length,
  optionRows: document.querySelectorAll('#tab-option tbody tr').length,
}));
await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

const failures = [...problems];
// 启动期（第一步之前）的报错不会被"每步增量"统计到，这里兜住
if (consoleErrors.length) failures.push('控制台报错 ' + consoleErrors.length + ' 条：' + consoleErrors.slice(0, 3).join(' | '));
if (summary.bootFailed) failures.push('页面出现「启动失败」兜底页');
if (summary.watchRows < 15) failures.push('观察列表没渲染出来（' + summary.watchRows + ' 行）');
if (summary.activityRows < 2) failures.push('操作日志没渲染出来（' + summary.activityRows + ' 行）');
if (summary.optionRows < 1) failures.push('期权持仓没渲染出来（' + summary.optionRows + ' 行）');
if (searchTop !== 'BRK-B') failures.push('搜索 berkshire 第一行应为 BRK-B，实际 ' + searchTop);
if (!healthText.state) failures.push('数据健康的「同步状态」没有渲染');
if (!healthText.conflict) failures.push('数据健康的「冲突状态」没有渲染');
if (!healthText.cloud) failures.push('数据健康的「最近下载」没有渲染');
console.log('爬查完成：' + summary.build + ' · 观察 ' + summary.watchRows + ' 行 · 日志 ' + summary.activityRows + ' 行 · 期权 ' + summary.optionRows + ' 行');
if (failures.length) {
  console.error('爬查发现问题 ' + failures.length + ' 条：\n  - ' + failures.join('\n  - '));
  throw new Error('crawl failed');
}
console.log('✓ 全页爬查零报错');
