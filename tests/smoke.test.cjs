const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('public/index.html', 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const nextNamed = /function\s+[A-Za-z_$][\w$]*\s*\(/g;
  nextNamed.lastIndex = start + marker.length;
  const next = nextNamed.exec(html);
  assert.ok(next, `unterminated ${name}`);
  return html.slice(start, next.index).trim();
}

const context = vm.createContext({
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
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
  assert.equal(manifest.start_url, '/?v=6');
  assert.equal(manifest.background_color, '#0b0e0c');
  assert.match(worker, /\['VGT', 'SMH', 'BTC', 'SGOV'\]/);
  assert.match(worker, /encodeURIComponent\(quoteSymbol\)/);
  assert.doesNotMatch(worker, /encodeURIComponent\(sym\)/);
  assert.match(serviceWorker, /wealth-v15/);
  assert.match(serviceWorker, /暂时无法连接/);
  assert.match(serviceWorker, /Navigation timeout/);
  assert.match(serviceWorker, /cache\.put\('\/', response\.clone\(\)\)/);
  assert.match(html, /register\('\/sw\.js',\{updateViaCache:'none'\}\)/);
});

test('mobile drawer is explicit, scroll-safe, and uses vector icons', () => {
  assert.match(html, /aria-controls="settingsDrawer"/);
  assert.match(html, /class="menu-open"/);
  assert.match(html, /\.sidebar,\.sidebar\.collapsed\{display:flex!important;flex-direction:column!important/);
  assert.match(html, /\.sidebar>\.sb-section,\.sidebar>\.sb-footer-links\{display:block;flex:0 0 auto!important/);
  assert.match(html, /body\.drawer-open \.bottom-bar,body\.drawer-open \.qa-fab/);
  assert.match(html, /id="settingsData"/);
  assert.match(html, />导入备份<\/button>/);
  assert.match(html, />导出备份<\/button>/);
  assert.match(html, />导入券商 CSV<\/button>/);
  assert.doesNotMatch(html, /class="btn-icon[^"]*" id="btn(?:ExportData|ImportData|ImportCSV)"/);
  assert.match(html, /\.bottom-bar\{height:calc\(56px \+ env\(safe-area-inset-bottom\)\)!important;bottom:0!important;padding:0 4px env\(safe-area-inset-bottom\)!important\}/);
  assert.match(html, /\.bb-btn\{top:2px!important;min-height:52px!important;height:52px!important/);
  assert.match(html, /\.qa-fab\{bottom:calc\(8px \+ env\(safe-area-inset-bottom\)\)!important;width:54px!important;height:54px!important/);
  assert.match(html, /\.main\{padding:0 16px calc\(60px \+ env\(safe-area-inset-bottom\)\)!important\}/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test('mobile portfolio and quick actions prioritize active investing work', () => {
  assert.match(html, /class="sb-portfolio-grid"/);
  assert.match(html, /class="sb-portfolio-insights"/);
  assert.match(html, /已卖 '\+contracts\+' 张 Call/);
  assert.doesNotMatch(html, /距 Covered Call/);
  assert.doesNotMatch(html, /onclick="qaDividend\(\)"/);
  assert.doesNotMatch(html, /function qaDividend\(/);
  assert.match(html, /id="hmDividend"/);
  assert.match(html, /\.qa-grid\{display:grid;grid-template-columns:repeat\(4,1fr\)/);
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
  assert.doesNotMatch(html, /ALERT_SNOOZE_KEY/);
  assert.doesNotMatch(html, /data-alert-snooze=/);
  assert.doesNotMatch(html, /qa-alert-snooze/);
  assert.doesNotMatch(html, /24小时后提醒/);
  assert.doesNotMatch(html, /<button class="qa-alert-item/);
});

test('drawdown visualization exposes current-to-peak distance with desktop space', () => {
  assert.match(html, /id="hmDrawdownWorst"/);
  assert.match(html, /class="drawdown-track"/);
  assert.match(html, /class="drawdown-marker" style="left:'/);
  assert.match(html, /d\.dd>=20\?'var\(--red\)':d\.dd>=10\?'var\(--orange\)'/);
  assert.match(html, /\.goal-row\{grid-column:1\/9!important;grid-row:4!important;height:220px!important/);
  assert.match(html, /\.cc-overview\{grid-column:9\/-1!important;grid-row:4!important;height:220px!important/);
});

test('data health shows cloud sync, backup, and conflict state', () => {
  for (const id of ['sbSyncLast', 'sbBackupLast', 'sbConflictState']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /s\.pendingConflicts=Array\.isArray\(s\.pendingConflicts\)/);
  assert.match(html, /function recordSyncSuccess\(/);
  assert.match(html, /function recordSyncFailure\(/);
  assert.match(html, /function setSyncConflicts\(/);
  assert.match(html, /function recordBackupTime\(/);
  assert.match(html, /syncFetchWithoutHealth=syncFetch/);
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
  assert.match(html, /html\[data-accent="ocean"\]\{--accent:#2867b7/);
  assert.match(html, /\.main\{[^}]*height:100vh!important[^}]*overflow-y:auto!important/);
  assert.doesNotMatch(html, /sparkTransform|paths=\{VGT:/);
  assert.match(html, /historyRange:'1mo'/);
  assert.match(html, /color=getAssetColor\(row\.sym\)/);
  assert.match(html, /for\(var i=-11;i<=0;i\+\+\)/);
  assert.match(html, /#logHeatmap\{display:grid!important/);
  assert.doesNotMatch(html, /\+' · BTC ETF'/);
  assert.match(html, /#holdMetrics\{[^}]*grid-template-columns:1\.12fr repeat\(3,1fr\)!important[^}]*gap:0!important/);
  assert.match(html, /#holdMetrics \.metric\+\.metric\{border-left:1px solid var\(--rule\)!important\}/);
  assert.match(html, /美股非交易时段/);
});
