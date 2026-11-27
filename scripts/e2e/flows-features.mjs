// e2e：本批新增能力——批量定投记账、策略基准、集中度结论、人民币折算与响应式布局。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.setViewportSize({ width: 390, height: 844 });
let delaySync = 0;
let blockSync = false;
await p.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== HOST) return route.abort();
  if (url.pathname === '/api/sync') {
    if (blockSync) return route.abort('failed');
    if (delaySync) await new Promise((resolve) => setTimeout(resolve, delaySync));
  }
  return route.continue();
});
const errors = [];
p.on('pageerror', (error) => errors.push(String(error && error.message)));

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(CLOUD + '/_reset').catch(() => {});
await p.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin, token: 'test' }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([
    { id: 1, date: '2026-09-02', symbol: 'QQQM', shares: 2, price: 250 },
    { id: 2, date: '2026-10-02', symbol: 'VGT', shares: 1, price: 120 },
    { id: 3, date: '2026-11-02', symbol: 'SMH', shares: 0.5, price: 600 },
  ]));
  localStorage.setItem('wealth_cash_v2', '10000');
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([
    { id: 11, date: '2026-09-01', type: '入金', amount: 1000 },
    { id: 12, date: '2026-10-01', type: '入金', amount: 1000 },
    { id: 13, date: '2026-11-01', type: '入金', amount: 1000 },
  ]));
});
delaySync = 800;
await p.goto(BASE + '?features=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500);

async function ev(fn, arg) {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn, arg); } catch (error) {
      last = error;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(error && error.message))) throw error;
      await p.waitForTimeout(700);
    }
  }
  throw last;
}
const failures = [];

/* 计价币种开关：USD/CNY 切换只影响只读估值，成交录入始终保持美元 */
await p.waitForFunction(() => /USD\/CNY 7\.1200/.test((document.getElementById('msTotalCny') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
const currencyUsd = await ev(() => ({
  mobile: (document.getElementById('msTotalCny') || {}).textContent || '',
  desktopNote: (document.getElementById('hmCnyEquivalent') || {}).textContent || '',
  usd: (document.getElementById('hmTotal') || {}).textContent || '',
}));
if (!/美元计价/.test(currencyUsd.mobile) || !/USD\/CNY 7\.1200/.test(currencyUsd.mobile) || !/^\$/.test(currencyUsd.usd)) {
  failures.push('默认美元计价状态异常：' + JSON.stringify(currencyUsd));
}
await ev(() => document.getElementById('mobHamburger').click());
await p.waitForTimeout(400);
await ev(() => [...document.querySelectorAll('.sb-quick-menu>button')].find((button) => /投资参数/.test(button.textContent))?.click());
await p.waitForTimeout(400);
const currencySwitchUi = await ev(() => {
  const panel = document.getElementById('settingsPreferences');
  const control = document.getElementById('currencySwitch');
  return { panel: !!panel?.offsetParent, control: !!control?.offsetParent, height: control?.getBoundingClientRect().height || 0 };
});
if (!currencySwitchUi.panel || !currencySwitchUi.control || currencySwitchUi.height < 40) {
  failures.push('投资参数里的币种开关不可见：' + JSON.stringify(currencySwitchUi));
}
await ev(() => document.querySelector('#currencySwitch [data-currency="CNY"]').click());
await p.waitForTimeout(1800);
const currencyCny = await ev(() => ({
  mobile: (document.getElementById('msTotalCny') || {}).textContent || '',
  desktopNote: (document.getElementById('hmCnyEquivalent') || {}).textContent || '',
  total: (document.getElementById('hmTotal') || {}).textContent || '',
  holdings: (document.getElementById('hmValue') || {}).textContent || '',
  cash: (document.getElementById('hmCash') || {}).textContent || '',
  goalGap: (document.getElementById('prGap') || {}).textContent || '',
  dcaTarget: (document.getElementById('mobileDcaTarget') || {}).textContent || '',
  stored: JSON.parse(localStorage.getItem('wealth_dashboard_v2') || '{}').displayCurrency,
  pressed: document.querySelector('#currencySwitch [data-currency="CNY"]')?.getAttribute('aria-pressed'),
}));
if (!/人民币计价/.test(currencyCny.mobile) || !/^¥/.test(currencyCny.total) || !/^¥/.test(currencyCny.holdings) ||
  !/^¥/.test(currencyCny.cash) || !/^¥/.test(currencyCny.goalGap) || !/^¥/.test(currencyCny.dcaTarget) ||
/* v444：币种只做展示，不再写进 state（每次打开默认美元），所以这里只验证主金额确实换算 */
currencyCny.pressed !== 'true') {
failures.push('CNY 开关没有切换主金额：' + JSON.stringify(currencyCny));
}
await ev(() => document.getElementById('mobHamburger').click());
await p.waitForTimeout(300);

/* 批量定投：空行跳过、一次写入、整批撤销 */
const beforeBatch = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
await ev(() => document.getElementById('btnDcaBatch').click());
await p.waitForTimeout(450);
const batchLayout = await ev(() => {
  const row = document.querySelector('.dca-batch-row');
  const panel = document.querySelector('#dcaSheet .qa-panel');
  return {
    open: document.getElementById('dcaSheet').classList.contains('open'),
    rowDisplay: row ? getComputedStyle(row).display : '',
    rowHeight: row ? row.getBoundingClientRect().height : 0,
    panelWidth: panel ? panel.getBoundingClientRect().width : 0,
    overflow: document.body.scrollWidth > innerWidth,
  };
});
if (!batchLayout.open || batchLayout.rowDisplay !== 'grid' || batchLayout.panelWidth > 390 || batchLayout.overflow) {
  failures.push('移动端批量定投表单布局异常：' + JSON.stringify(batchLayout));
}
await ev(() => {
  const set = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('dcaSharesQQQM', '1');
  set('dcaPriceQQQM', '260');
  set('dcaSharesVGT', '1');
  set('dcaPriceVGT', '125');
});
const preview = await ev(() => ({
  total: document.getElementById('dcaBatchTotal').textContent,
  button: document.getElementById('btnSaveDcaBatch').textContent,
}));
if (!/^¥/.test(preview.total) || !/2 笔/.test(preview.button)) failures.push('CNY 模式下批量成交金额应统一换算：' + JSON.stringify(preview));
await ev(() => document.getElementById('btnSaveDcaBatch').click());
await p.waitForTimeout(1400);
const afterBatch = await ev(() => ({
  count: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
  open: document.getElementById('dcaSheet').classList.contains('open'),
  last: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').slice(-2).map((trade) => trade.symbol),
  toast: document.getElementById('syncToast').innerText,
}));
if (afterBatch.count - beforeBatch !== 2 || afterBatch.open || afterBatch.last.join(',') !== 'QQQM,VGT') {
  failures.push('批量定投没有整批写入：' + JSON.stringify(afterBatch));
}
await ev(() => document.querySelector('#syncToast .toast-action')?.click());
await p.waitForTimeout(900);
const afterUndo = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
if (afterUndo !== beforeBatch) failures.push('批量定投撤销没有恢复原交易：' + afterUndo + ' vs ' + beforeBatch);

/* 现金不足不写入，并保留表单 */
await ev(() => document.getElementById('btnDcaBatch').click());
await p.waitForTimeout(300);
await ev(() => {
  const shares = document.getElementById('dcaSharesQQQM');
  const price = document.getElementById('dcaPriceQQQM');
  shares.value = '1000';
  price.value = '500';
  shares.dispatchEvent(new Event('input', { bubbles: true }));
});
await ev(() => document.getElementById('btnSaveDcaBatch').click());
await p.waitForTimeout(250);
const cashGuard = await ev(() => ({
  count: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
  open: document.getElementById('dcaSheet').classList.contains('open'),
  error: document.getElementById('dcaBatchError').textContent,
  shares: document.getElementById('dcaSharesQQQM').value,
}));
if (cashGuard.count !== beforeBatch || !cashGuard.open || !/现金不足/.test(cashGuard.error) || cashGuard.shares !== '1000') {
  failures.push('批量定投现金不足保护异常：' + JSON.stringify(cashGuard));
}

/* 策略基准 + 集中度结论 */
await p.evaluate(() => {
  document.getElementById('dcaSharesQQQM').value = '';
  document.getElementById('dcaPriceQQQM').value = '';
  closeDcaSheet();
  document.querySelector('.tab-btn[data-tab="analysis"]').click();
});
await p.waitForTimeout(9000);
const analysis = await ev(() => {
  const shell = document.querySelector('#equityChart .eq-shell');
  return {
    benchmarkLine: !!document.querySelector('#equityChart .eq-benchmark'),
    benchmarkLegend: !!document.querySelector('#equityChart .eq-legend-benchmark'),
    meta: (document.getElementById('equityMeta') || {}).textContent || '',
    endLabel: (document.querySelector('#equityChart .eq-end-label') || {}).textContent || '',
    leaders: document.querySelectorAll('#holdExpose .conc-leader-list span').length,
    effective: (document.querySelector('#holdExpose .conc-grid') || {}).textContent || '',
    overflow: document.body.scrollWidth > innerWidth,
    threeYearSymbols: performance.getEntriesByType('resource')
      .filter((entry) => /\/api\/price\?[^#]*range=3y/.test(entry.name))
      .map((entry) => new URL(entry.name).searchParams.get('symbol')),
  };
});
if (!analysis.benchmarkLine || !analysis.benchmarkLegend || !/目标基准/.test(analysis.meta) || !/执行差异/.test(analysis.meta) || !/^¥/.test(analysis.endLabel)) {
  failures.push('策略基准线或摘要没有渲染：' + JSON.stringify(analysis));
}
if (analysis.leaders > 0) failures.push('v443：重复的前五大底层资产 chips 应已删除');
if (!/有效独立暴露/.test(analysis.effective)) failures.push('集中度摘要缺失：' + JSON.stringify(analysis));
if (analysis.overflow) failures.push('分析页出现横向溢出');
if (analysis.threeYearSymbols.length !== 3 || new Set(analysis.threeYearSymbols).size !== 3) {
  failures.push('市场趋势日线请求必须每个核心标的一次，不能重复：' + JSON.stringify(analysis.threeYearSymbols));
}
await ev(() => document.querySelector('#currencySwitch [data-currency="USD"]').click());
await p.waitForTimeout(600);

/* 四种宽度 + 双主题都不横向溢出；移动端快捷面板始终可见 */
await ev(() => document.querySelector('[data-tab="holding"]').click());
await p.waitForTimeout(500);
const responsive = [];
for (const width of [320, 360, 390, 1440]) {
  for (const theme of ['light', 'dark']) {
    await p.setViewportSize({ width: width, height: width > 800 ? 1000 : 844 });
    await p.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
    await p.waitForTimeout(180);
    responsive.push(await ev(({ width, theme }) => ({
      width, theme,
      overflow: document.body.scrollWidth > innerWidth,
      nav: document.querySelectorAll('.bb-btn').length,
      dcaButtonVisible: (() => { const el = document.getElementById('btnDcaBatch'); return !!el && el.getBoundingClientRect().height > 0; })(),
    }), { width, theme }));
  }
}
if (responsive.some((row) => row.overflow)) failures.push('响应式宽度或主题下出现横向溢出：' + JSON.stringify(responsive.filter((row) => row.overflow)));
if (responsive.filter((row) => row.width <= 800).some((row) => row.nav !== 4)) failures.push('移动端底部导航数量异常：' + JSON.stringify(responsive));
if (responsive.some((row) => !row.dcaButtonVisible)) failures.push('批量定投入口在部分视口不可见');

/* 慢网：延迟同步时本地仍立即落库；随后网络恢复能补推 */
delaySync = 1200;
await p.setViewportSize({ width: 390, height: 844 });
await ev(() => document.getElementById('btnDcaBatch').click());
await p.waitForTimeout(250);
await ev(() => {
  const set = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('dcaSharesSMH', '0.25');
  set('dcaPriceSMH', '600');
  document.getElementById('btnSaveDcaBatch').click();
});
await p.waitForTimeout(500);
const slowLocal = await ev(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').some((trade) => trade.symbol === 'SMH' && trade.shares === 0.25));
if (!slowLocal) failures.push('慢网下批量成交没有先写本地');
await p.waitForTimeout(2600);
const slowCloud = await (await fetch(CLOUD + '/_log')).json();
if (!Array.isArray(slowCloud.store.trades) || !slowCloud.store.trades.some((trade) => trade.symbol === 'SMH' && trade.shares === 0.25)) {
  failures.push('慢网恢复后新增成交没有补推云端');
}

/* 网络失败时保留本地并显示失败；恢复 online 后补推 */
blockSync = true;
await ev(() => document.getElementById('btnDcaBatch').click());
await p.waitForTimeout(250);
await ev(() => {
  const shares = document.getElementById('dcaSharesQQQM');
  const price = document.getElementById('dcaPriceQQQM');
  shares.value = '0.1'; price.value = '260';
  shares.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('btnSaveDcaBatch').click();
});
await p.waitForTimeout(1600);
const offlineUi = await ev(() => ({
  local: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').some((trade) => trade.symbol === 'QQQM' && trade.shares === 0.1),
  status: (document.getElementById('syncStatus') || {}).textContent || '',
}));
if (!offlineUi.local) failures.push('同步失败时没有保留本地成交');
blockSync = false;
await p.evaluate(() => window.dispatchEvent(new Event('online')));
await p.waitForTimeout(2600);
const recoveredCloud = await (await fetch(CLOUD + '/_log')).json();
if (!Array.isArray(recoveredCloud.store.trades) || !recoveredCloud.store.trades.some((trade) => trade.symbol === 'QQQM' && trade.shares === 0.1)) {
  failures.push('网络恢复后没有补推失败期间成交');
}

await p.close();
console.log('批量定投：' + beforeBatch + '→' + afterBatch.count + '→撤销 ' + afterUndo + ' · 预览 ' + preview.total + ' · 现金保护=' + (cashGuard.open ? '已保留' : '异常'));
console.log('策略基准：' + (analysis.benchmarkLine ? '已绘制' : '缺失') + ' · 集中度前五=' + analysis.leaders + ' · 币种=' + currencyUsd.mobile + '→' + currencyCny.mobile);
console.log('响应式：' + responsive.map((row) => row.width + '/' + row.theme).join(' · '));
console.log('慢网与恢复：本地=' + slowLocal + ' · 补推=' + (slowCloud.store.trades || []).length + ' 笔');
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('功能验收失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-features failed');
}
console.log('✓ 批量定投 / 策略基准 / 集中度 / 人民币 / 响应式 / 慢网恢复全部通过');
