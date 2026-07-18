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
  ETF_SYMS: ['VGT', 'SMH', 'BTC'],
  trades: [],
  tradeIdCounter: 1,
});

for (const name of [
  'localDate',
  'cleanText',
  'escapeHtml',
  'normalizeDateValue',
  'normalizeTrades',
  'normalizeOptions',
  'parseCSVRow',
  'parseMoneyValue',
  'parseSchwabCSV',
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
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.start_url, /^\//);
  assert.match(worker, /\['VGT', 'SMH', 'BTC', 'SGOV'\]/);
  assert.match(worker, /encodeURIComponent\(quoteSymbol\)/);
  assert.doesNotMatch(worker, /encodeURIComponent\(sym\)/);
});

test('desktop UI states stay data-consistent and scrollable', () => {
  assert.match(html, /html\[data-accent="ocean"\]\{--accent:#2867b7/);
  assert.match(html, /\.main\{[^}]*height:100vh!important[^}]*overflow-y:auto!important/);
  assert.match(html, /sparkTransform=ch2<0\?' transform="translate\(0 22\) scale\(1 -1\)"'/);
  assert.match(html, /isFlat=Math\.abs\(ch2\)<\.0001/);
  assert.match(html, /color=getAssetColor\(row\.sym\)/);
  assert.match(html, /for\(var i=-11;i<=0;i\+\+\)/);
  assert.match(html, /#logHeatmap\{display:grid!important/);
  assert.match(html, /美股非交易时段/);
});
