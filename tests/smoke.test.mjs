import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { KEYS } from '../src/app/store.js';

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/assets/main.css', 'utf8');
// 前端源码可能分散在 src/app/*（当前只有 index.js 与 util.js）。
// util.js 放在前面：它的最后一个函数后面紧跟 index.js 的第一个函数，
// 这样测试里的"按下一个 function 声明切片"仍能拿到完整函数体。
const utilSource = fs.readFileSync('src/app/util.js', 'utf8').replace(/^export /gm, '');
const calcSource = fs.readFileSync('src/app/calc.js', 'utf8').replace(/^export /gm, '');
const storeSource = fs.readFileSync('src/app/store.js', 'utf8').replace(/^export /gm, '');
const syncSource = fs.readFileSync('src/app/sync.js', 'utf8').replace(/^export /gm, '');
const renderSource = fs.readFileSync('src/app/render.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
const rowsSource = fs.readFileSync('src/app/rows.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
const timeSource = fs.readFileSync('src/app/time.js', 'utf8').replace(/^export /gm, '');
const indexSource = fs.readFileSync('src/app/index.js', 'utf8').replace(/^import .*$/gm, '');
const appSource =
  utilSource + '\n' + calcSource + '\n' + storeSource + '\n' + syncSource + '\n' +
  renderSource + '\n' + rowsSource + '\n' + timeSource + '\n' + indexSource;
const appMarkup = html + '\n' + css + '\n' + appSource;

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = appSource.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const nextNamed = /function\s+[A-Za-z_$][\w$]*\s*\(/g;
  nextNamed.lastIndex = start + marker.length;
  const next = nextNamed.exec(appSource);
  assert.ok(next, `unterminated ${name}`);
  return appSource.slice(start, next.index).trim();
}

const context = vm.createContext({
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  KEYS,
  isFinite,
  isNaN,
  HOME_TIME_ZONE: 'Asia/Shanghai',
  MARKET_TIME_ZONE: 'America/New_York',
  ETF_SYMS: ['VGT', 'SMH', 'BTC'],
  trades: [],
  tradeIdCounter: 1,
});

for (const name of [
  'localDate',
  'zonedDateParts',
  'zonedDate',
  'marketDate',
  'chinaDate',
  'marketClock',
  'dateOrdinal',
  'optionExpiryState',
  'isActiveOption',
  'cleanText',
  'escapeHtml',
  'normalizeDateValue',
  'normalizeTrades',
  'normalizeOptions',
  'parseCSVRow',
  'parseMoneyValue',
  'parseSchwabCSV',
  'sparklinePath',
]) {
  vm.runInContext(extractFunction(name), context);
}

test('inline JavaScript compiles and element IDs are unique', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [, source] of scripts) new vm.Script(source);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('dates and imported text are normalized safely', () => {
  assert.equal(context.normalizeDateValue('7/18/2026'), '2026-07-18');
  assert.equal(context.normalizeDateValue('2026-02-30'), '');
  assert.equal(context.escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});

test('US market dates do not roll over at Beijing midnight', () => {
  const beijingAfterMidnight = new Date('2026-07-19T00:30:00+08:00');
  assert.equal(context.chinaDate(beijingAfterMidnight), '2026-07-19');
  assert.equal(context.marketDate(beijingAfterMidnight), '2026-07-18');
  assert.equal(context.marketClock(beijingAfterMidnight), '12:30');
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.optionExpiryState('2026-07-18', beijingAfterMidnight))),
    { days: 0, expired: false },
  );
  const afterMarketClose = new Date('2026-07-19T05:00:00+08:00');
  assert.equal(context.optionExpiryState('2026-07-18', afterMarketClose).expired, true);
  assert.equal(context.isActiveOption({ expiry: '2026-07-18' }, beijingAfterMidnight), true);
  assert.equal(context.isActiveOption({ expiry: '2026-07-18' }, afterMarketClose), false);
  assert.equal(context.marketDate(new Date('2026-08-01T00:30:00+08:00')).slice(0, 7), '2026-07');
});

test('trade normalization accepts BTC ETF ticker and rejects spot symbols', () => {
  const rows = context.normalizeTrades([
    { id: 1, symbol: 'btc', date: '2026-07-18', shares: 10, price: 28.38 },
    { id: 2, symbol: 'BTC-USD', date: '2026-07-18', shares: 1, price: 118000 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'BTC');
  assert.equal(rows[0].price, 28.38);
});

test('option IDs cannot inject markup or inline handlers', () => {
  const rows = context.normalizeOptions([
    { id: '\" onclick=alert(1)', sym: 'VGT', type: 'CALL', strike: 120, premium: 150, contracts: 1, expiry: '2026-08-21' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(typeof rows[0].id, 'number');
  assert.ok(Number.isFinite(rows[0].id));
});

test('Schwab CSV parser handles quotes, sells, duplicates, and ETF allowlist', () => {
  context.trades.length = 0;
  context.tradeIdCounter = 1;
  const csv = [
    'Date,Action,Symbol,Quantity,Price',
    '07/18/2026,Buy,BTC,10,"$28.38"',
    '07/18/2026,Sell,VGT,1,"$113.10"',
    '07/18/2026,Buy,BTC-USD,1,"$118,000.00"',
    '07/18/2026,Buy,BTC,10,"$28.38"',
  ].join('\n');
  assert.equal(context.parseSchwabCSV(csv), 2);
  assert.equal(context.trades.length, 2);
  assert.equal(context.trades[0].symbol, 'BTC');
  assert.equal(context.trades[1].shares, -1);
});

test('PWA metadata and worker quote boundary stay valid', () => {
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const serviceWorker = fs.readFileSync('public/sw.js', 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.start_url, /^\//);
  assert.equal(manifest.start_url, '/?v=140');
  assert.equal(manifest.background_color, '#f5f6f3');
  assert.match(serviceWorker, /wealth-v140/);
  assert.match(serviceWorker, /暂时无法连接/);
  assert.match(serviceWorker, /Navigation timeout/);
  assert.match(serviceWorker, /cache\.put\('\/', response\.clone\(\)\)/);
  assert.match(appMarkup, /register\('\/sw\.js\?v=140',\{updateViaCache:'none'\}\)/);
  assert.doesNotMatch(html, /viewport-fit=cover/);
  assert.match(html, /interactive-widget=resizes-content/);
});

test('mobile drawer is explicit, scroll-safe, and uses vector icons', () => {
  assert.match(html, /aria-controls="settingsDrawer"/);
  assert.match(html, /class="menu-open"/);
  assert.match(appMarkup, /\.sidebar,\.sidebar\.collapsed\{display:flex!important;flex-direction:column!important/);
  assert.match(appMarkup, /\.sidebar>\.sb-section,\.sidebar>\.sb-footer-links\{display:block;flex:0 0 auto!important/);
  assert.match(appMarkup, /body\.drawer-open \.bottom-bar,body\.drawer-open \.qa-fab/);
  assert.match(html, /id="settingsData"/);
  assert.match(html, />导入备份<\/button>/);
  assert.match(html, />导出备份<\/button>/);
  assert.match(html, />导入券商 CSV<\/button>/);
  assert.doesNotMatch(html, /class="btn-icon[^"]*" id="btn(?:ExportData|ImportData|ImportCSV)"/);
  // 底部栏定位取最终生效规则（历史覆盖层已在 v47 收敛，被遮蔽的重复声明已移除）
  assert.match(appMarkup, /#bottomBar\.bottom-bar\{left:0!important;right:0!important;bottom:0!important;height:calc\(72px \+ env\(safe-area-inset-bottom,0px\)\)!important;border-top:1px solid var\(--rule\)!important\}/);
  assert.match(appMarkup, /#bottomBar\.bottom-bar\{display:grid!important;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
  assert.match(appMarkup, /\.bb-btn\{position:static!important;top:auto!important;left:auto!important;width:100%!important;min-width:0!important;justify-self:stretch!important;height:68px!important;min-height:68px!important/);
  assert.match(appMarkup, /\.sidebar\.open\{transform:translate3d\(0,0,0\)!important\}/);
  assert.match(appMarkup, /transition:none!important\}/);
  // 快捷操作按钮占用底栏中间的独立槽位（左右各两个导航按钮），不再遮挡导航
  assert.match(appMarkup, /#qaFab\.qa-fab\{left:50%!important;right:auto!important;bottom:calc\(32px \+ env\(safe-area-inset-bottom,0px\)\)!important;transform:translateX\(-50%\)!important/);
  assert.match(appMarkup, /#bottomBar #bbOption\{grid-column:4\}/);
  assert.match(appMarkup, /#tab-option \.option-type-segment\{height:42px!important/);
  assert.match(appMarkup, /\.segmented-control\{height:42px;margin-bottom:10px;border-radius:14px\}/);
  // 旧版的 FAB 底部居中规则已被右上角实现完全覆盖，不再要求其文本存在
  assert.match(appMarkup, /\.main\{padding:0 16px calc\(120px \+ env\(safe-area-inset-bottom,0px\)\)!important\}/);
  assert.doesNotMatch(appMarkup, /fonts\.googleapis\.com/);
});

test('mobile portfolio and quick actions prioritize active investing work', () => {
  assert.match(html, /class="sb-portfolio-grid"/);
  assert.match(html, /class="sb-portfolio-insights"/);
  assert.match(appMarkup, /已卖 '\+contracts\+' 张 Call/);
  assert.doesNotMatch(appMarkup, /距 Covered Call/);
  assert.doesNotMatch(appMarkup, /onclick="qaDividend\(\)"/);
  assert.doesNotMatch(appMarkup, /function qaDividend\(/);
  assert.match(html, /id="hmDividend"/);
  assert.match(appMarkup, /\.qa-grid\{display:grid!important;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
});

test('reminders deduplicate and sort by severity without snooze controls', () => {
  const alertContext = vm.createContext({
    Date,
    String,
    Array,
    Object,
    Set,
    ALERT_SEVERITY_SCORE: { critical: 4, high: 3, medium: 2, low: 1 },
  });
  vm.runInContext(extractFunction('normalizeAlerts'), alertContext);
  const result = alertContext.normalizeAlerts([
    { id: 'call:VGT', severity: 'medium', title: 'VGT normal' },
    { id: 'dca:2026-07', severity: 'low', title: 'DCA' },
    { id: 'call:VGT', severity: 'critical', title: 'VGT urgent' },
    { id: 'call:SMH', severity: 'high', title: 'SMH expiry' },
  ]);
  assert.deepEqual(Array.from(result, (item) => item.id), ['call:VGT', 'call:SMH', 'dca:2026-07']);
  assert.equal(result[0].severity, 'critical');
  assert.doesNotMatch(appMarkup, /ALERT_SNOOZE_KEY/);
  assert.doesNotMatch(appMarkup, /data-alert-snooze=/);
  assert.doesNotMatch(appMarkup, /qa-alert-snooze/);
  assert.doesNotMatch(appMarkup, /24小时后提醒/);
  assert.doesNotMatch(appMarkup, /<button class="qa-alert-item/);
});

test('drawdown visualization exposes current-to-peak distance with desktop space', () => {
  assert.match(html, /id="hmDrawdownWorst"/);
  assert.match(appSource, /class="drawdown-track"/);
  assert.match(appSource, /class="drawdown-marker" style="left:/);
  assert.match(appMarkup, /d\.dd>=20\?'var\(--red\)':d\.dd>=10\?'var\(--orange\)'/);
  assert.match(appMarkup, /\.goal-row\{grid-column:1\/9!important;grid-row:4!important;height:220px!important/);
  assert.match(appMarkup, /\.cc-overview\{grid-column:9\/-1!important;grid-row:4!important;height:220px!important/);
});

test('data health shows cloud sync, backup, and conflict state', () => {
  for (const id of ['sbSyncLast', 'sbBackupLast', 'sbConflictState']) {
    assert.match(appMarkup, new RegExp(`id="${id}"`));
  }
  assert.match(appMarkup, /s\.pendingConflicts=Array\.isArray\(s\.pendingConflicts\)/);
  assert.match(appMarkup, /function recordSyncSuccess\(/);
  assert.match(appMarkup, /function recordSyncFailure\(/);
  assert.match(appMarkup, /function setSyncConflicts\(/);
  assert.match(appMarkup, /function recordBackupTime\(/);
  assert.match(appMarkup, /syncFetchWithoutHealth=syncFetch/);
});

test('market sparkline is built from real cached history points', () => {
  assert.equal(context.sparklinePath([1]), '');
  const path = context.sparklinePath([10, 12, 11, 15]);
  assert.match(path, /^M1\.0 /);
  assert.match(path, /L57\.0 2\.0$/);
});

test('price refresh requests one-month history and retains valid closes', async () => {
  let requestedUrl = '';
  const priceContext = vm.createContext({
    console,
    Date,
    Number,
    Array,
    Object,
    isFinite,
    encodeURIComponent,
    PRICE_SYMBOLS: { BTC: 'BTC' },
    readPriceCache: () => ({}),
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ ok: true, data: { chart: { result: [{
          meta: { regularMarketPrice: 28.38, chartPreviousClose: 28.41 },
          indicators: { quote: [{ close: [27.9, null, 28.1, 28.38] }] },
        }] } } }),
      };
    },
  });
  vm.runInContext('async ' + extractFunction('fetchPrice'), priceContext);
  const quote = await priceContext.fetchPrice('BTC');
  assert.match(requestedUrl, /symbol=BTC&range=1mo$/);
  assert.deepEqual(Array.from(quote.history), [27.9, 28.1, 28.38]);
  assert.equal(quote.prevClose, 28.1);
  assert.ok(Math.abs(quote.change - 0.28) < 1e-9);
  assert.equal(quote.historyRange, '1mo');
});

test('desktop UI states stay data-consistent and scrollable', () => {
  assert.match(appMarkup, /\[data-accent="ocean"\]\{--accent:#2867b7/);
  assert.match(appMarkup, /\.main\{[^}]*height:100dvh!important[^}]*overflow-y:auto!important/);
  assert.doesNotMatch(appMarkup, /sparkTransform|paths=\{VGT:/);
  assert.match(appMarkup, /historyRange:'1mo'/);
  assert.match(appMarkup, /color=getAssetColor\(row\.sym\)/);
  assert.match(appMarkup, /for\(var i=-11;i<=0;i\+\+\)/);
  assert.match(appMarkup, /#logHeatmap\{display:grid!important/);
  assert.doesNotMatch(appMarkup, /\+' · BTC ETF'/);
  assert.match(appMarkup, /#holdMetrics\{[^}]*grid-template-columns:1\.12fr repeat\(3,1fr\)!important[^}]*gap:0!important/);
  assert.match(appMarkup, /#holdMetrics \.metric\+\.metric\{border-left:1px solid var\(--rule\)!important\}/);
  assert.match(appMarkup, /美股非交易时段/);
});
