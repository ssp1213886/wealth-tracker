// e2e：核心数据流——买入 / 入金 / 卖 CALL 是否既落库又推上（假）云端。
// 断言：本地增量正确、dirty 被清掉、假云端收到对应的键。
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

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });   // 先在非应用页清 SW / 写种子：避免首次加载时 SW 自动 reload 打断初始化
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin, token: 'test' }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_cashlog_v2', '[]');
  localStorage.setItem('wealth_activity_v1', '[]');
  localStorage.setItem('wealth_options_v2', '[]');
});
await fetch(CLOUD + '/_reset').catch(() => {});
await p.goto(BASE + '?flow=' + Date.now(), { waitUntil: 'domcontentloaded' });
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
const snap = () => ev(() => ({
  trades: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
  cash: Number(localStorage.getItem('wealth_cash_v2') || '0'),
  cashLog: JSON.parse(localStorage.getItem('wealth_cashlog_v2') || '[]').length,
  activities: JSON.parse(localStorage.getItem('wealth_activity_v1') || '[]').length,
  options: JSON.parse(localStorage.getItem('wealth_options_v2') || '[]').length,
}));
const failures = [];

/* 启动引导：本地有数据、云端为空 → 必须把本地标脏，并在关闭页面时补推上去。
   v240 抽取同步决策层时漏掉了 saveSyncState(ss)，导致这条链路整段失效（线上 v240–v245），
   所以这里用「关页面后云端必须收到 trades」把它钉住。 */
const bootDirty = await ev(() => (JSON.parse(localStorage.getItem('wealth_sync_state') || '{}').dirty) || {});
if (!bootDirty.trades || !bootDirty.cashBalance) {
  failures.push('启动后本地数据没有标脏（dirty=' + JSON.stringify(bootDirty) + '）');
}
await p.waitForTimeout(1200);
await p.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
await p.waitForTimeout(1500);
{
  const bootCloud = await (await fetch(CLOUD + '/_log')).json();
  const bootKeys = Object.keys(bootCloud.store);
  ['trades', 'cashBalance'].forEach((k) => {
    if (!bootKeys.includes(k)) failures.push('启动时的待同步数据没有补推到云端：缺 ' + k + '（云端只有 ' + (bootKeys.join(',') || '空') + '）');
  });
}

/* 买入 VGT 10 股 @580 */
await ev(() => document.getElementById('bbConsole').click());
await p.waitForTimeout(1500);
const beforeBuy = await snap();
await ev(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('tfDate', '2026-09-28');
  set('tfPrice', '580');
  set('tfShares', '10');
  const buy = Array.from(document.querySelectorAll('.segment[data-trade-type]')).filter((b) => b.getAttribute('data-trade-type') === 'buy')[0];
  if (buy && !buy.classList.contains('active')) buy.click();
  const chip = Array.from(document.querySelectorAll('.asset-chip[data-asset]')).filter((b) => b.getAttribute('data-asset') === 'VGT')[0];
  if (chip && !chip.classList.contains('active')) chip.click();
});
await p.waitForTimeout(400);
const tradePreview = await ev(() => ({
  text: (document.getElementById('tradeImpact') || {}).innerText || '',
  bars: document.querySelectorAll('#tradeImpact .ti-stack').length,
  rows: document.querySelectorAll('#tradeImpact .ti-weight-row').length,
  width: (document.getElementById('tradeImpact') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width,
  bodyWidth: document.body.scrollWidth,
  viewportWidth: innerWidth,
}));
if (!/交易前/.test(tradePreview.text) || !/交易后/.test(tradePreview.text) || !/剩余现金/.test(tradePreview.text) || !/VGT/.test(tradePreview.text)) {
  failures.push('交易影响预览内容不完整：' + JSON.stringify(tradePreview));
}
if (tradePreview.bars !== 2 || tradePreview.rows !== 4 || tradePreview.bodyWidth > tradePreview.viewportWidth) {
  failures.push('交易影响预览结构或移动端溢出异常：' + JSON.stringify(tradePreview));
}
await ev(() => document.getElementById('btnAddTrade').click());
await p.waitForTimeout(2000);
const afterBuy = await snap();
if (afterBuy.trades - beforeBuy.trades !== 1) failures.push('买入没有落库（交易数 ' + beforeBuy.trades + ' → ' + afterBuy.trades + '）');
if (afterBuy.activities - beforeBuy.activities !== 1) failures.push('买入没有写操作日志');

/* 入金 5000 */
const beforeDep = await snap();
await ev(() => {
  const el = document.getElementById('hmCashAmt');
  el.value = '5000';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await p.waitForTimeout(2200);
const afterDep = await snap();
if (afterDep.cash - beforeDep.cash !== 5000) failures.push('入金没有加进现金（' + beforeDep.cash + ' → ' + afterDep.cash + '）');
if (afterDep.cashLog - beforeDep.cashLog !== 1) failures.push('入金没有写资金流水');

/* 卖 CALL VGT @130 x1，权利金 120/张 */
await ev(() => document.getElementById('bbOption').click());
await p.waitForTimeout(1800);
const beforeOpt = await snap();
await ev(() => {
  const set = (id, v) => { const el = document.getElementById(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  set('otype', 'CALL');
  set('osym', 'VGT');
  /* v394：到期日不要写死 —— 写死的日期一过期，这张 CALL 就变"已到期"，断言半年后自己坏掉 */
  const d = new Date(); d.setDate(d.getDate() + 10);
  const pad = (n) => String(n).padStart(2, '0');
  set('oexpiry', d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  set('ostrike', '130');
  set('opremium', '120');
  set('ocontracts', '1');
});
await p.waitForTimeout(500);
await ev(() => document.getElementById('btnAddOption').click());
await p.waitForTimeout(2500);
const afterOpt = await snap();
if (afterOpt.options - beforeOpt.options !== 1) failures.push('卖 CALL 没有落库');
if (afterOpt.cash - beforeOpt.cash !== 120) failures.push('卖 CALL 的权利金没有入账（+' + (afterOpt.cash - beforeOpt.cash) + '，应为 +120）');

/* 期权页：权利金汇总 + 行内状态（v238 把这块计算抽到了 options.js） */
await ev(() => document.getElementById('bbOption').click());
await p.waitForTimeout(1500);
const optUi = await ev(() => ({
  total: (document.getElementById('trev') || {}).textContent,
  month: (document.getElementById('mrev') || {}).textContent,
  status: (document.getElementById('optStatus') || {}).textContent,
  calls: (document.getElementById('ccSub') || {}).textContent,
  nearest: (document.getElementById('ccNearest') || {}).textContent,
  market: (document.getElementById('marketRegime') || {}).textContent,
  rows: document.querySelectorAll('#tab-option tbody tr').length,
}));
if (optUi.total !== '$120.00') failures.push('累计权利金应为 $120.00，实际 ' + optUi.total);
if (optUi.month !== '$120.00') failures.push('本月权利金应为 $120.00，实际 ' + optUi.month);
if (!/天/.test(optUi.status || '')) failures.push('期权状态没显示剩余天数：' + optUi.status);
if (!/CALL/.test(optUi.calls || '')) failures.push('"复投核心仓"那行没显示 CALL 张数：' + optUi.calls);
if (optUi.rows < 1) failures.push('期权行没渲染出来');
if (!/市场状态/.test(optUi.market || '')) failures.push('期权页没显示市场状态提示：' + optUi.market);
if (!/强势/.test(optUi.market || '') || !/10% OTM/.test(optUi.market || '')) {
  failures.push('市场状态没按 2 年日线给出强势/VGT 10% OTM：' + optUi.market);
}
if (!/200 日均线/.test(optUi.market || '') || /200D/.test(optUi.market || '')) {
  failures.push('市场状态还要显示 200D 这种旧文案：' + optUi.market);
}
const regimeExplain = await ev(() => {
  const details = document.querySelector('#marketRegime details.regime-rules');
  const summary = details && details.querySelector('summary');
  const reason = document.querySelector('#marketRegime .regime-reason');
  if (!details || !summary) return { missing: true };
  const before = details.open;
  summary.click();
  return {
    reason: reason ? reason.textContent.trim() : '',
    summary: summary.textContent.trim(),
    before: before,
    open: details.open,
    summaryHeight: summary.getBoundingClientRect().height,
    mobile: window.matchMedia('(max-width: 800px)').matches,
  };
});
if (regimeExplain.missing) failures.push('市场状态缺少判断规则说明');
if (!/下方|上方|高于|低于|趋势/.test(regimeExplain.reason || '')) failures.push('市场状态没有解释当前判断原因：' + regimeExplain.reason);
if (regimeExplain.summary !== '判断规则') failures.push('判断规则入口文案不对：' + regimeExplain.summary);
if (!regimeExplain.open) failures.push('移动端点开判断规则后没有展开');
if (!regimeExplain.mobile) failures.push('端到端场景未按移动端宽度运行');
if (!(regimeExplain.summaryHeight >= 40)) failures.push('移动端判断规则触控高度不足：' + regimeExplain.summaryHeight);
const chartUi = await ev(() => ({
  svg: !!document.querySelector('#trendChart .trend-svg'),
  price: !!document.querySelector('#trendChart .trend-line.is-price'),
  sma50: !!document.querySelector('#trendChart .trend-line.is-sma50'),
  sma200: !!document.querySelector('#trendChart .trend-line.is-sma200'),
  states: document.querySelectorAll('#trendChart .trend-state').length,
  yLabels: document.querySelectorAll('#trendChart .trend-axis-label').length,
  visibleYLabels: [...document.querySelectorAll('#trendChart .trend-axis-label')].filter((el) => el.getBoundingClientRect().height > 0).length,
  rangeTabs: document.querySelectorAll('#trendChart [data-trendrange]').length,
  rangeHeights: [...document.querySelectorAll('#trendChart [data-trendrange]')].map((el) => el.getBoundingClientRect().height),
  area: !!document.querySelector('#trendChart .trend-area'),
  currentPriceLabel: (document.querySelector('#trendChart .trend-current-price') || {}).textContent || '',
  hoverLayer: !!document.querySelector('#trendChart .trend-hover'),
  trendTabs: document.querySelectorAll('#trendTabs [data-trendtab]').length,
  activeTrend: (document.querySelector('#trendTabs .prob-chip.is-on') || {}).textContent || '',
  rangeLabels: [...document.querySelectorAll('#trendChart .trend-range span')].map((el) => el.textContent || ''),
  titleRange: (document.getElementById('trendRangeLabel') || {}).textContent || '',
  titleAsOf: (document.getElementById('trendAsOf') || {}).textContent || '',
  optionCards: [...document.querySelectorAll('#tab-option > .card')].map((el) => el.classList.contains('trend-card') ? 'trend' : el.classList.contains('prob-card') ? 'prob' : ''),
  freshness: (document.getElementById('dataFreshness') || {}).innerText || '',
}));
const chartNative = await ev(() => {
  const shell = document.querySelector('#trendChart .trend-chart-shell');
  const contextmenu = new Event('contextmenu', { bubbles: true, cancelable: true });
  const selectstart = new Event('selectstart', { bubbles: true, cancelable: true });
  shell.dispatchEvent(contextmenu);
  shell.dispatchEvent(selectstart);
  const style = getComputedStyle(shell);
  return {
    userSelect: style.userSelect,
    webkitUserSelect: style.webkitUserSelect || '',
    touchCallout: style.webkitTouchCallout || '',
    touchCalloutSupported: CSS.supports('-webkit-touch-callout', 'none'),
    contextmenuBlocked: contextmenu.defaultPrevented,
    selectstartBlocked: selectstart.defaultPrevented,
  };
});
if (!chartUi.svg || !chartUi.price || !chartUi.sma50 || !chartUi.sma200 || !chartUi.area) failures.push('趋势图线条或面积没有完整渲染');
if (!(chartUi.states >= 200)) failures.push('趋势状态历史不足：' + chartUi.states);
if (chartUi.yLabels !== 5 || chartUi.visibleYLabels !== 3 || chartUi.rangeTabs !== 3 || !chartUi.hoverLayer) failures.push('趋势图坐标轴、范围或悬停层缺失：' + JSON.stringify(chartUi));
if (!/^\$/.test(chartUi.currentPriceLabel)) failures.push('趋势图缺少当前价标签：' + JSON.stringify(chartUi.currentPriceLabel));
if (!/^(6 个月|1 年|2 年)$/.test(chartUi.titleRange) || !/^\d{4}\/\d{2}\/\d{2}$/.test(chartUi.titleAsOf)) failures.push('趋势图标题缺少范围或数据截至日期：' + JSON.stringify({ range: chartUi.titleRange, asOf: chartUi.titleAsOf }));
if (chartUi.rangeHeights.some((height) => height < 40)) failures.push('移动端趋势范围按钮触控高度不足：' + JSON.stringify(chartUi.rangeHeights));
if (chartNative.userSelect !== 'none' || chartNative.webkitUserSelect !== 'none' ||
  (chartNative.touchCalloutSupported && chartNative.touchCallout !== 'none') ||
  !chartNative.contextmenuBlocked || !chartNative.selectstartBlocked) {
  failures.push('趋势图仍可能触发长按选择或复制：' + JSON.stringify(chartNative));
}
if (chartUi.trendTabs !== 3 || chartUi.activeTrend !== 'VGT') failures.push('趋势图缺少三标的切换：' + JSON.stringify(chartUi));
const rangeDates = chartUi.rangeLabels.map((label) => (label.match(/\d{4}\/(0[1-9]|1[0-2])\/\d{2}/) || [])[0] || '');
if (chartUi.rangeLabels.length !== 2 || !/^开始 \d{4}\/(0[1-9]|1[0-2])\/\d{2}$/.test(chartUi.rangeLabels[0]) || !/^截至 \d{4}\/(0[1-9]|1[0-2])\/\d{2}$/.test(chartUi.rangeLabels[1]) || rangeDates.some((date) => date.endsWith('/01/21')) || rangeDates[0] === rangeDates[1]) {
  failures.push('趋势图日期标签异常：' + JSON.stringify(chartUi.rangeLabels));
}
if (chartUi.optionCards.indexOf('trend') < 0 || chartUi.optionCards.indexOf('prob') < 0 || chartUi.optionCards.indexOf('trend') + 1 !== chartUi.optionCards.indexOf('prob')) {
  failures.push('趋势图没有紧挨在被行权概率卡片上方：' + JSON.stringify(chartUi.optionCards));
}
if (!/现价/.test(chartUi.freshness) || !/日线/.test(chartUi.freshness) || !/期权链/.test(chartUi.freshness) || !/22:10 UTC/.test(chartUi.freshness)) {
  failures.push('数据新鲜度信息不完整：' + chartUi.freshness);
}
const paletteAudit = await ev(() => {
  const root = document.documentElement;
  const oldTheme = root.dataset.theme;
  const oldAccent = root.dataset.accent;
  const priceLine = document.querySelector('#trendChart .trend-line.is-price');
  const sma50 = document.querySelector('#trendChart .trend-line.is-sma50');
  const sma200 = document.querySelector('#trendChart .trend-line.is-sma200');
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const rgb = (value) => { probe.style.color = value; return getComputedStyle(probe).color; };
  const accents = ['forest', 'ocean', 'warm', 'plum', 'mono'];
  const themes = ['light', 'dark'];
  const out = {};
  themes.forEach((theme) => {
    root.dataset.theme = theme;
    const rows = accents.map((accent) => {
      root.dataset.accent = accent;
      const style = getComputedStyle(root);
      const accentRgb = getComputedStyle(priceLine).stroke;
      const sma50Rgb = getComputedStyle(sma50).stroke;
      const sma200Rgb = getComputedStyle(sma200).stroke;
      return {
        accent,
        accentRgb,
        sma50Rgb,
        sma200Rgb,
        chartBull: rgb(style.getPropertyValue('--chart-bull').trim()),
        chartBear: rgb(style.getPropertyValue('--chart-bear').trim()),
        sma50Dash: getComputedStyle(sma50).strokeDasharray,
        sma200Dash: getComputedStyle(sma200).strokeDasharray,
      };
    });
    out[theme] = rows;
  });
  probe.remove();
  root.dataset.theme = oldTheme;
  root.dataset.accent = oldAccent;
  return out;
});
for (const theme of ['light', 'dark']) {
  const rows = paletteAudit[theme] || [];
  const unique = (key) => new Set(rows.map((row) => row[key])).size;
  const conflicts = rows.filter((row) => row.accentRgb === row.sma50Rgb || row.accentRgb === row.sma200Rgb ||
    row.accentRgb === row.chartBull || row.accentRgb === row.chartBear || row.chartBull === row.chartBear).map((row) => row.accent);
  if (rows.length !== 5 || unique('sma50Rgb') !== 1 || unique('sma200Rgb') !== 1 ||
    unique('chartBull') !== 1 || unique('chartBear') !== 1 || conflicts.length) {
    failures.push('趋势图固定语义色冲突（' + theme + '）：' + JSON.stringify({ rows, conflicts }));
  }
  if (!rows.length || rows[0].sma50Dash === rows[0].sma200Dash) failures.push('趋势图均线缺少不同线型：' + JSON.stringify(rows));
}
await p.waitForFunction(() => !!document.querySelector('#probMatrix .mx-table'), null, { timeout: 10000 }).catch(() => {});
await p.waitForFunction(() => {
  const el = document.getElementById('sbVgtCurrent');
  return el && /^当前 \d+\.\d%$/.test(el.textContent || '');
}, null, { timeout: 8000 }).catch(() => {});
const visualSummary = await ev(() => ({
  heatCells: document.querySelectorAll('#probMatrix .mx-cell.mx-heat').length,
  riskKey: !!document.querySelector('#probMatrix .mx-risk-key'),
  currentStrike: (document.querySelector('#probMatrix .mx-current-pick') || {}).textContent || '',
  vgtCurrent: (document.getElementById('sbVgtCurrent') || {}).textContent || '',
  drawdownGap: (document.querySelector('#hmDrawdown .drawdown-value small') || {}).textContent || '',
  probText: (document.getElementById('probMatrix') || {}).innerText || '',
  sidebarCurrentHtml: (document.getElementById('sbVgtCurrent') || {}).outerHTML || '',
  hasSidebar: !!document.querySelector('.sidebar'),
  sidebarLegendHtml: (document.querySelector('.sb-mini-legend') || {}).outerHTML || '',
}));
if (!/期权链暂不可用/.test(visualSummary.probText) &&
  (visualSummary.heatCells < 3 || !visualSummary.riskKey || !/当前档/.test(visualSummary.currentStrike))) {
  failures.push('被行权概率缺少热力图或当前档摘要：' + JSON.stringify(visualSummary));
}
if (visualSummary.sidebarCurrentHtml && !/^当前 \d+\.\d%$/.test(visualSummary.vgtCurrent)) {
  failures.push('资产配置没有显示当前实际占比：' + JSON.stringify(visualSummary));
}
if (!/^-\$/.test(visualSummary.drawdownGap)) failures.push('回撤卡没有显示距 52 周高点的金额：' + JSON.stringify(visualSummary));
await ev(() => {
  const svg = document.querySelector('#trendChart .trend-svg');
  const rect = svg.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 1, pointerType: 'mouse',
    clientX: rect.left + rect.width * 0.58, clientY: rect.top + rect.height * 0.45,
  }));
});
await p.waitForTimeout(80);
const trendHover = await ev(() => {
  const tip = document.querySelector('#trendChart .trend-tooltip');
  return { hidden: !tip || tip.hidden, text: tip ? tip.innerText : '' };
});
if (trendHover.hidden || !/VGT/.test(trendHover.text) || !/\$/.test(trendHover.text) || !/50 日/.test(trendHover.text) || !/200 日/.test(trendHover.text)) {
  failures.push('趋势图悬停提示不完整：' + JSON.stringify(trendHover));
}
await ev(() => document.querySelector('.tab-btn[data-tab="holding"]').click());
await p.waitForTimeout(350);
await p.waitForFunction(() => !!document.querySelector('#equityChart .eq-shell'), null, { timeout: 12000 }).catch(() => {});
const equityUi = await ev(() => {
  const shell = document.querySelector('#equityChart .eq-shell');
  const svg = shell && shell.querySelector('.eq-svg');
  if (!svg) return { ready: false };
  const rect = svg.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, pointerId: 1, pointerType: 'mouse',
    clientX: rect.left + rect.width * 0.6, clientY: rect.top + rect.height * 0.45,
  }));
  const tip = shell.querySelector('.eq-tooltip');
  return {
    ready: true,
    label: (shell.querySelector('.eq-end-label') || {}).textContent || '',
    tooltipHidden: !tip || tip.hidden,
    tooltip: tip ? tip.innerText : '',
    userSelect: getComputedStyle(shell).userSelect,
  };
});
if (!equityUi.ready || !/^\$/.test(equityUi.label)) failures.push('资产曲线缺少固定当前值标签：' + JSON.stringify(equityUi));
if (equityUi.tooltipHidden || !/资产/.test(equityUi.tooltip) || !/净入金/.test(equityUi.tooltip) || !/收益率/.test(equityUi.tooltip)) failures.push('资产曲线悬停详情不完整：' + JSON.stringify(equityUi));
if (equityUi.userSelect !== 'none') failures.push('资产曲线仍允许选择文字：' + equityUi.userSelect);
await ev(() => document.querySelector('.tab-btn[data-tab="option"]').click());
await p.waitForTimeout(350);
await ev(() => document.querySelector('#trendChart [data-trendrange="2y"]').click());
await p.waitForTimeout(450);
const trend2y = await ev(() => ({
  active: (document.querySelector('#trendChart [data-trendrange].is-on') || {}).dataset?.trendrange || '',
  states: document.querySelectorAll('#trendChart .trend-state').length,
}));
if (trend2y.active !== '2y' || trend2y.states < 480) failures.push('趋势图 2 年窗口异常：' + JSON.stringify(trend2y));
await ev(() => document.querySelector('#trendChart [data-trendrange="1y"]').click());
await p.waitForTimeout(300);
await ev(() => document.querySelector('#trendTabs [data-trendtab="IBIT"]').click());
await p.waitForTimeout(600);
const trendSwitch = await ev(() => ({
  symbol: (document.getElementById('trendSymbol') || {}).textContent || '',
  probabilityTab: (document.querySelector('#probTabs .prob-chip.is-on') || {}).textContent || '',
}));
if (trendSwitch.symbol !== 'IBIT' || trendSwitch.probabilityTab !== 'IBIT') failures.push('趋势图切换没有同步 IBIT：' + JSON.stringify(trendSwitch));
await ev(() => document.querySelector('#trendTabs [data-trendtab="VGT"]').click());
await p.waitForTimeout(400);
await ev(() => document.getElementById('bbHoldings').click());
await p.waitForTimeout(400);
const maBefore = await ev(() => {
  const list = document.getElementById('mobileAlerts');
  const ack = list && list.querySelector('[data-alert-dismiss="macross:9001"]');
  return {
    text: list ? list.innerText : '',
    ack: !!ack,
    ackHeight: ack ? ack.getBoundingClientRect().height : 0,
  };
});
if (!/VGT 上穿 200 日均线/.test(maBefore.text || '')) failures.push('均线穿越提醒没有显示：' + maBefore.text);
if (!maBefore.ack) failures.push('均线穿越提醒缺少确认按钮');
if (!(maBefore.ackHeight >= 40)) failures.push('移动端均线提醒按钮触控高度不足：' + maBefore.ackHeight);
await ev(() => { const b = document.querySelector('#mobileAlerts [data-alert-dismiss="macross:9001"]'); if (b) b.click(); });
await p.waitForTimeout(700);
const maAfter = await ev(() => ({
  text: (document.getElementById('mobileAlerts') || {}).textContent || '',
}));
if (/VGT 上穿 200 日均线/.test(maAfter.text)) {
  failures.push('确认均线穿越后列表没有清空：' + JSON.stringify(maAfter));
}
await ev(() => document.getElementById('bbOption').click());
await p.waitForTimeout(400);
await p.setViewportSize({ width: 320, height: 700 });
await p.waitForTimeout(300);
const pwa320 = await ev(() => {
  const summary = document.querySelector('#marketRegime details.regime-rules summary');
  const regime = document.getElementById('marketRegime');
  return {
    mobile: window.matchMedia('(max-width: 800px)').matches,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    summaryHeight: summary ? summary.getBoundingClientRect().height : 0,
    regimeWidth: regime ? regime.getBoundingClientRect().width : 0,
    trendWidth: (document.querySelector('#trendChart .trend-svg') || {getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width,
    tabs: document.querySelectorAll('.bb-btn').length,
  };
});
if (!pwa320.mobile) failures.push('320px 场景没有命中移动端样式');
if (pwa320.overflow > 0) failures.push('320px 出现横向溢出：' + pwa320.overflow);
if (!(pwa320.summaryHeight >= 40)) failures.push('320px 判断规则触控高度不足：' + pwa320.summaryHeight);
if (!(pwa320.regimeWidth > 0 && pwa320.regimeWidth <= 320)) failures.push('320px 市场状态卡宽度异常：' + pwa320.regimeWidth);
if (!(pwa320.trendWidth > 0 && pwa320.trendWidth <= 320)) failures.push('320px 趋势图宽度异常：' + pwa320.trendWidth);
if (pwa320.tabs !== 4) failures.push('320px 底部 PWA 导航数量异常：' + pwa320.tabs);

/* 云端是否真的收到 */
await p.waitForTimeout(1500);
const cloud = await (await fetch(CLOUD + '/_log')).json();
const keys = Object.keys(cloud.store);
['trades', 'cashBalance', 'cashLog', 'activities', 'optionTrades'].forEach((k) => {
  if (!keys.includes(k)) failures.push('假云端没收到 ' + k + '（收到：' + keys.join(',') + '）');
});
const pushes = cloud.log.map((x) => x.keys.join('+'));
if (!pushes.some((k) => k.includes('trade'))) failures.push('没有任何一次推送包含 trades');

await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

console.log('数据流：买入 ' + beforeBuy.trades + '→' + afterBuy.trades + ' 笔 · 现金 ' + beforeDep.cash + '→' + afterDep.cash + ' · 期权 ' + beforeOpt.options + '→' + afterOpt.options);
console.log('期权页：累计权利金 ' + optUi.total + ' · 本月 ' + optUi.month + ' · 状态 "' + optUi.status + '" · 市场 "' + optUi.market + '" · 最近到期 "' + optUi.nearest + '"');
console.log('推送记录：' + pushes.join('  |  '));
if (errors.length) failures.push('页面报错：' + errors.join(' | '));
if (failures.length) {
  console.error('数据流测试失败：\n  - ' + failures.join('\n  - '));
  throw new Error('flows-data failed');
}
console.log('✓ 买入 / 入金 / 卖 CALL 都正确落库并同步');
