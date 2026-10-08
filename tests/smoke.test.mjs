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
// 观察列表搜索名单已抽到 symbols.js（v234）；断言仍按"源码里能看到名单"来钉，所以这里要带上它
const symbolsSource = fs.readFileSync('src/app/symbols.js', 'utf8').replace(/^export /gm, '');
// 期权纯计算已抽到 options.js（v238）；它按函数名切片做断言，所以要一起拼进来
const optionsSource = fs.readFileSync('src/app/options.js', 'utf8').replace(/^export /gm, '');
// 记录域规整与 CSV 解析已抽到 records-import.js（v244），同样按函数名切片
const recordsSource = fs.readFileSync('src/app/records-import.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
// 图表数据整形已抽到 charts.js（v245）
const chartsSource = fs.readFileSync('src/app/charts.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
// 同步视图层已抽到 sync-view.js（v247）：状态条/数据健康/失败横幅/冲突弹窗的渲染
const syncViewSource = fs.readFileSync('src/app/sync-view.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
// 持仓视图层已抽到 portfolio-view.js（v250）：指标卡/盈亏明细/持仓表/目标进度/回撤面板/行情胶囊
const portfolioViewSource = fs.readFileSync('src/app/portfolio-view.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
// 待办提醒视图层已抽到 alerts-view.js（v253）：normalizeAlerts 等按函数名切片做断言
const alertsViewSource = fs.readFileSync('src/app/alerts-view.js', 'utf8').replace(/^export /gm, '').replace(/^import .*$/gm, '');
const indexSource = fs.readFileSync('src/app/index.js', 'utf8').replace(/^import .*$/gm, '');
const appSource =
  utilSource + '\n' + calcSource + '\n' + storeSource + '\n' + syncSource + '\n' +
  renderSource + '\n' + rowsSource + '\n' + timeSource + '\n' + symbolsSource + '\n' + optionsSource + '\n' + recordsSource + '\n' + chartsSource + '\n' + syncViewSource + '\n' + portfolioViewSource + '\n' + alertsViewSource + '\n' + indexSource;
const appMarkup = html + '\n' + css + '\n' + appSource;

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = appSource.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  // v320：也要认 `async function name(` —— 否则新加的异步函数会让"上一个函数"的切片尾部残留一个 `async `，
  // 在 vm 里直接 `ReferenceError: async is not defined`（加 fetchWithTimeout 时踩到）
  const nextNamed = /(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/g;
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
  TRADE_SYMBOLS: ['VGT', 'SMH', 'BTC'],
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
  const csv = [
    'Date,Action,Symbol,Quantity,Price',
    '07/18/2026,Buy,BTC,10,"$28.38"',
    '07/18/2026,Sell,VGT,1,"$113.10"',
    '07/18/2026,Buy,BTC-USD,1,"$118,000.00"',
    '07/18/2026,Buy,BTC,10,"$28.38"',
  ].join('\n');
  // v244：解析已抽到 records-import.js（纯函数，返回待插入的行；id 与写入留给 index.js 的包装层）
  const parsed = context.parseSchwabCSV(csv, { symbols: ['VGT', 'SMH', 'BTC'], existingTrades: [] });
  assert.equal(parsed.imported, 2, '重复行与非白名单代码应被剔除');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].symbol, 'BTC');
  assert.equal(parsed.rows[0].shares, 10, 'Buy 记正股数');
  assert.equal(parsed.rows[1].symbol, 'VGT');
  assert.equal(parsed.rows[1].shares, -1, 'Sell 记负股数');
  assert.ok(parsed.rows.every((r) => r.id === undefined), '纯函数不分配 id');
  // 与已有交易按「日期|代码|股数|价格」去重
  const dup = context.parseSchwabCSV(csv, { symbols: ['VGT', 'SMH', 'BTC'], existingTrades: [{ date: '2026-07-18', symbol: 'BTC', shares: 10, price: 28.38 }] });
  assert.equal(dup.imported, 1);
  // 包装层仍负责分配 id 并写入 trades（结构性断言）
  assert.match(indexSource, /parseSchwabCSVIn\(text,\{symbols:ETF_SYMS,existingTrades:trades\}\)/);
});

test('PWA metadata and worker quote boundary stay valid', () => {
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const serviceWorker = fs.readFileSync('public/sw.js', 'utf8');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.start_url, /^\//);
  assert.equal(manifest.start_url, '/?v=360');
  assert.equal(manifest.background_color, '#f5f6f3');
  assert.match(serviceWorker, /wealth-v360/);
  assert.match(serviceWorker, /暂时无法连接/);
  // v273：导航改成「缓存优先 + 后台更新」——以前是网络优先 + 3.5 秒竞速，
  // 冷启动（iOS 重开 PWA）要等满超时才回落缓存，用户看到的就是白屏。
  assert.doesNotMatch(serviceWorker, /Navigation timeout/);
  // v318：壳子缓存只能顶「App 壳子路径」。以前对任何导航都先返回 caches.match('/')，
  // 于是同作用域的 /guide 被顶掉（点「使用文档」看到的还是 App）。
  assert.match(serviceWorker, /var isShellPath = \(url\.pathname === '\/' \|\| url\.pathname === '\/index\.html'\)/);
  assert.match(serviceWorker, /\(isShellPath \? caches\.match\('\/'\) : caches\.match\(request\)\)\.then\(function\(cached\)/);
  assert.match(serviceWorker, /cache\.put\('\/', response\.clone\(\)\)/);
  // 新版本接管时不再整页 reload（那会在启动瞬间再白一次）
  assert.doesNotMatch(appSource, /controllerchange[\s\S]{0,200}location\.reload/);
  // iOS 独立 PWA 的启动画面：缺了它冷启动就是一片纯白
  assert.match(html, /rel="apple-touch-startup-image"/);
  assert.match(appMarkup, /register\('\/sw\.js\?v=360',\{updateViaCache:'none'\}\)/);
  assert.doesNotMatch(html, /viewport-fit=cover/);
  assert.match(html, /interactive-widget=resizes-content/);
});

test('登录门禁：Worker 接了门禁/登录页，SW 不会把登录页当成 App 壳子缓存', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const serviceWorker = fs.readFileSync('public/sw.js', 'utf8');
  const assets = fs.readFileSync('src/lib/assets.js', 'utf8');
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');

  // 静态资源默认由资源层直发、不经过 Worker，不开这个开关门禁就是摆设
  assert.match(wrangler, /run_worker_first\s*=\s*true/);
  assert.match(worker, /'\/api\/login'/);
  assert.match(worker, /readSession/);
  // 多用户：同步按会话里的 userId 分区，登录是用户名 + 密码
  assert.match(worker, /\/api\/accounts/);
  assert.match(worker, /handleSyncGet\(env, account\.id\)/);
  // 同步必须走 activeAccount：禁用/重置密码能立刻踢掉旧会话
  assert.match(worker, /async function activeAccount/);
  assert.match(worker, /activeAccount\(request, env\)/);
  assert.match(worker, /findAccountByUsername/);
  const syncLib = fs.readFileSync('src/lib/sync.js', 'utf8');
  assert.match(syncLib, /WHERE user_id = \?/);
  assert.match(worker, /X-WT-Shell/);
  // 只拦"要 HTML 的导航"，资产放行 —— 否则 SW 预缓存 '/' 会把登录页存成壳子
  assert.match(worker, /function needsAuth\(request, pathname\)/);
  // 壳子标记 + SW 只缓存带标记的导航 + 登录页走网络
  assert.match(serviceWorker, /X-WT-Shell/);
  assert.match(serviceWorker, /url\.pathname === '\/login'/);
  assert.match(assets, /no-store/);
});

test('观察列表搜索内置名单 = S&P100 ∪ 纳斯达克100（167 条）', () => {
  // 名单由维基百科成分表的「代码列 + 公司列」解析生成；这里钉住几支只有纳斯达克100 才有的票，
  // 防止再退回"其实只有 S&P100 + 几个杂项"的状态。
  const must = [
    ['APP', 'AppLovin'],
    ['ARM', 'Arm Holdings'],
    ['ABNB', 'Airbnb'],
    ['CRWD', 'CrowdStrike'],
    ['DDOG', 'Datadog'],
    ['MELI', 'Mercado Libre'],
    ['PYPL', 'PayPal'],
    ['REGN', 'Regeneron Pharmaceuticals'],
    ['VRTX', 'Vertex Pharmaceuticals'],
    ['WDAY', 'Workday, Inc.'],
  ];
  must.forEach(([sym, name]) => {
    assert.ok(appMarkup.includes('["' + sym + '","' + name + '"]'), '内置名单缺少 ' + sym + ' ' + name);
  });
  // 名单已抽到 src/app/symbols.js（v234），声明可能是 const/var，两种都认
  const idxLine = appMarkup.split('\n').find((l) => /^(var|const) IDX=\[/.test(l.trim()));
  assert.ok(idxLine, '找不到内置名单 IDX');
  const entries = (idxLine.match(/\["[A-Z0-9.\-]+","/g) || []).length;
  assert.equal(entries, 167, '内置名单条数');
  ['["MRX","', '["OBX","', '["UK","', '["DAX","'].forEach((junk) => {
    assert.ok(!appMarkup.includes(junk), '内置名单混入杂项：' + junk);
  });
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
  // v254：这条规则上的 !important 被 C1 证明冗余后去掉了（四种组合指纹零差异），断言改为只钉高度
  // v301：触控热区统一提到 ≥44px（Apple HIG）。这里不再钉死具体数值——
  // 钉住「不小于 44px」这条不变量，以后调尺寸不会再误报成回归。
  assert.match(appMarkup, /#tab-option \.option-type-segment\{height:48px/);
  assert.match(appMarkup, /\.segmented-control\{height:48px;margin-bottom:10px;border-radius:14px\}/);
  const segH = Number((appMarkup.match(/\.segmented-control\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:2px;height:(\d+)px/) || [])[1]);
  assert.ok(segH >= 44, '分段控件高度必须 ≥44px（触控热区），实际 ' + segH);
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
  // 上次成功推送：只有 push 方向才更新，且要有独立状态行
  assert.match(appMarkup, /id="sbPushRow"/);
  assert.match(appMarkup, /id="sbLastPush"/);
  assert.match(appSource, /if\(s\.lastSyncDirection==='push'\)s\.lastPushAt=s\.lastSyncAt;/);
  // v247：四行状态类的判定与写入搬到 sync-view.js（纯函数 healthRowStatuses + applyHealthRows，另有单测）
  assert.match(appSource, /const HEALTH_ROW_IDS = \{ cloud: 'sbCloudRow', backup: 'sbBackupRow', push: 'sbPushRow', conflict: 'sbConflictRow' \};/);
  assert.match(appSource, /function healthRowStatuses\(summary, lastSyncErrorAt\)/);
  assert.match(appSource, /push: !configured \? '' : \(failed && erroredAt > pushAt\) \? 'error' : pushAt \? 'ok' : 'warn'/);
  // 上传 / 下载两条通道各自记时间，命名与侧边栏按钮统一
  assert.match(appSource, /else if\(s\.lastSyncDirection==='pull'\)s\.lastPullAt=s\.lastSyncAt;/);
  assert.match(appSource, /s\.lastPullAt=Number\(s\.lastPullAt\)\|\|0/);
  assert.match(html, /最近成功下载/);
  assert.match(html, /上次成功上传/);
  assert.match(appMarkup, /s\.pendingConflicts=Array\.isArray\(s\.pendingConflicts\)/);
  assert.match(appMarkup, /function recordSyncSuccess\(/);
  assert.match(appMarkup, /function recordSyncFailure\(/);
  assert.match(appMarkup, /function setSyncConflicts\(/);
  assert.match(appMarkup, /function recordBackupTime\(/);
  assert.match(appMarkup, /syncFetchWithoutHealth=syncFetch/);
});

test('sync status bar covers uploading, done, and failure states', () => {
  assert.match(html, /id="syncBar"/);
  // 胶囊是纯指示：不放按钮（失败的可操作出口是横幅与数据健康），这样三态宽度才真正一致
  assert.doesNotMatch(html, /id="syncBarRetry"/);
  assert.doesNotMatch(html, /id="syncBarClose"/);
  assert.doesNotMatch(appSource, /syncBarRetry|syncBarClose|initSyncBar/);
  assert.match(appMarkup, /\.sync-bar\.is-busy\{/);
  assert.match(appMarkup, /\.sync-bar\.is-ok\{/);
  assert.match(appMarkup, /\.sync-bar\.is-err\{/);
  assert.match(appSource, /function setSyncBar\(state,text\)/);
  // v247：三态的类名/图标/自动收起时长搬到 sync-view.js 的 syncBarAttrs（另有单测钉住 2.2s / 8s / 30s）
  assert.match(appSource, /icon: state === 'ok' \? '✓' : state === 'err' \? '!' : ''/);
  assert.match(appSource, /holdMs: state === 'ok' \? 2200 : state === 'err' \? 8000 : state === 'busy' \? 30000 : 0/);
  assert.match(appSource, /function applySyncBar\(doc, state, text\)/);
  assert.match(appSource, /function healPushConflict\(/);
  assert.match(appSource, /function flushDirtyOnHide\(/);
  assert.match(appSource, /function pushKeysForce\(/);
  // 409 不再直接甩给用户，先自动核对
  assert.doesNotMatch(appSource, /status===409\)\{autoPull\(\);showToast\('云端已有更新/);

  // 悬浮胶囊：覆盖式（不占流、不推内容）、居中、避开左上角 ☰
  assert.match(appMarkup, /\.sync-bar\{position:fixed;top:calc\(56px \+ env\(safe-area-inset-top,0px\)\);left:50%/);
  assert.match(appMarkup, /transform:translate3d\(-50%,-10px,0\)/);
  assert.match(appMarkup, /max-width:calc\(100vw - 132px\)/);
  assert.match(appMarkup, /\.sync-bar\.show\{opacity:1;pointer-events:auto;transform:translate3d\(-50%,0,0\)\}/);
  assert.doesNotMatch(appMarkup, /\.sync-bar\{margin-left:50px\}/, '旧的避让式左缩进应已删除');
  // 三态图标
  assert.match(html, /class="sb-ic"/);
  // v247：图标与停留时长都搬到 sync-view.js 的 syncBarAttrs（上面已断言 2200/8000/30000 映射）
  assert.match(appSource, /icon: state === 'ok' \? '✓' : state === 'err' \? '!' : ''/);
  assert.match(appSource, /setTimeout\(function\(\)\{setSyncBar\(''\)\},r\.holdMs\)/, '成功态停留 2.2 秒（时长由 syncBarAttrs 给）');

  // 三态尺寸要落在同一档：统一最小宽度 + 图标盒统一 13px（转圈在盒内画 11px 的环）
  assert.match(appMarkup, /justify-content:center;gap:8px;min-width:132px/);
  assert.match(appMarkup, /\.sync-bar\.is-busy \.sb-ic::before\{content:'';width:11px;height:11px/);
  assert.doesNotMatch(appMarkup, /\.sync-bar\.is-busy \.sb-ic\{width:11px/, '转圈不再缩小图标盒');
  // 失败态用"视觉重量"表达紧急度：红色光晕 + 中心放大（几何尺寸不变）
  assert.match(appMarkup, /\.sync-bar\.is-err\{[^}]*box-shadow:0 0 0 3px color-mix\(in srgb,var\(--red\) 26%,transparent\)/);
  assert.match(appMarkup, /\.sync-bar\.show\.is-err\{transform:translate3d\(-50%,0,0\) scale\(1\.04\)\}/);
  assert.match(appMarkup, /\.sync-bar\.is-ok\{[^}]*box-shadow:0 4px 14px rgba\(10,20,14,\.10\)\}/);
  // 胶囊文案统一缩短，避免同一条提示忽大忽小
  assert.match(appSource, /'正在下载…':'正在上传…'/);
  assert.doesNotMatch(appSource, /正在上传到云端/);
  assert.doesNotMatch(appSource, /同步失败 · 数据仅存本机/);
  // 失败态 8 秒后自动收起（横幅继续常驻）
  // v247：时长改由 sync-view.js 的 syncBarAttrs 给出（8000），index.js 只负责起计时器
  assert.match(appSource, /holdMs: state === 'ok' \? 2200 : state === 'err' \? 8000 : state === 'busy' \? 30000 : 0/);
  assert.match(appSource, /if\(r\.holdMs\)syncBarTimer=setTimeout\(function\(\)\{setSyncBar\(''\)\},r\.holdMs\)/);
});

// v316：同步请求必须"有始有终"。网络黑洞时（VPN 掉线 / SNI 被拦）fetch 可以永远不返回，
// 没有硬超时的话状态条就永远停在 busy —— 用户看到的就是一条永不消失的"正在下载"。
test('syncFetch：请求永不返回时按硬超时收尾，正常返回时不被超时打断', { timeout: 5000 }, async () => {
  function syncCtx(fetchImpl) {
    const ctx = vm.createContext({
      console, Date, Error, DOMException, AbortController, setTimeout, clearTimeout,
      SYNC_TIMEOUT_MS: 40,
      syncCfg: { url: 'https://example.test', token: '' },
      location: { origin: 'https://example.test' },
      logSwallowed: () => {},
      fetch: fetchImpl,
    });
    vm.runInContext(extractFunction('syncFetch'), ctx);
    return ctx;
  }

  // ① 永不返回 → 必须靠超时收尾，并且真的把请求中断掉
  let aborted = false;
  const hung = syncCtx((url, opts) => new Promise((resolve, reject) => {
    const sig = opts && opts.signal;
    assert.ok(sig, '同步请求必须带 AbortSignal，否则中断不了');
    sig.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
  }));
  await assert.rejects(async () => { await hung.syncFetch('GET'); }, (e) => e && e.name === 'AbortError');
  assert.equal(aborted, true, '超时后必须真的把请求中断');

  // ② 正常返回 → 拿到结果，且事后再也不会因为超时被中断
  let abortedOnSuccess = false;
  const ok = syncCtx((url, opts) => {
    opts.signal.addEventListener('abort', () => { abortedOnSuccess = true; });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ts: 1234 }) });
  });
  assert.equal((await ok.syncFetch('GET')).ts, 1234);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(abortedOnSuccess, false, '成功返回后不该再触发超时中断');
});

test('同步失败不再挂死在 busy：没有 stall 兜底，失败原因说人话', () => {
  // v314 的 20 秒 stall 兜底只改文案、不结束状态，是"永久正在下载"的直接来源
  assert.doesNotMatch(appSource, /stallTimer/);
  assert.doesNotMatch(appSource, /仍在同步…（网络较慢）/);
  // 硬超时 + 可行动的失败文案
  // v321：两套超时集中到 util.js（同步 15 秒 / 普通 10 秒），不再散落在 index.js 里
  assert.match(appSource, /const SYNC_TIMEOUT_MS = 15000;/);
  assert.match(appSource, /const FETCH_TIMEOUT_MS = 10000;/);
  assert.match(appSource, /opts\.signal=ctrl\.signal/);
  assert.match(appSource, /连不上云端 · 稍后自动重试/);
  assert.match(appSource, /当前离线 · 数据已存本机/);
  // 网络恢复（VPN 重连 / 切回 WiFi）后自动补一次同步
  assert.match(appSource, /addEventListener\('online',function\(\)\{try\{autoPull\(\)/);
  // 包装层依赖的局部变量必须还在：done() 里若引用未声明的名字会抛 ReferenceError，
  // 整条成功收尾（写状态 / 标脏 / 推送）会被 autoPull 的空 catch 吞掉 —— 修 v316 时真踩过
  assert.match(appSource, /var spinTimer=setTimeout\(clearSpin,12000\);/);
  assert.match(appSource, /var done=function\(\)\{clearTimeout\(spinTimer\);clearSpin\(\)\}/);
  // v317：失败文案只留一处来源（sync-view.js 的 syncFailureText），状态条与 toast 共用它 ——
  // 以前 POST 失败会用自己的说法覆盖掉拉取那句，同一件事在屏幕上先后出现两种说法
  assert.equal(appSource.split('连不上云端 · 稍后自动重试').length - 1, 1, '只有 syncFailureText 定义一次文案');
  assert.doesNotMatch(appSource, /网络异常，同步失败/);
  assert.match(appSource, /var st=syncFailureText\(error,/);
  assert.match(appSource, /var failText=syncFailureText\(error,offline\)/);
  // v319/v320：现金占比的口径与文案只能有一份，且桌面指标卡（hmTotal / hmCashPct）**只能由视图层写**。
  // updateMobStatusBar 是手机状态栏函数，历史上它自写了一份公式、还把总资产 ≤0 硬写成 0，
  // 会把 renderMetricsTop 刚写好的「—」覆盖回「0.00%」。（cashPctOf/cashPctText 由各自单测钉住）
  assert.match(appSource, /function renderCashTotals\(doc, totalAssets, netCash\)/);
  assert.match(appSource, /renderCashTotals\(document,totalV\+nc,nc\)/);
  assert.doesNotMatch(indexSource, /hmTotal|hmCashPct/, '桌面指标卡的总资产/现金占比只能由视图层写');
  assert.doesNotMatch(appSource, /nc\/\(totalV\+nc\)\*100:0/, '不许再出现自写的占比公式');
  // v320：客户端网络调用统一走带截止时间的 fetchWithTimeout —— 链路黑洞时不允许再出现"永久进行中"
  // （只放行 3 处裸 fetch：/api/log 上报、页面卸载时的 keepalive 补推、syncFetch 本身，它自带 15 秒硬超时）
  const bareFetches = (indexSource.match(/(?<![a-zA-Z.])fetch\(/g) || []).length;
  assert.equal(bareFetches, 3, '裸 fetch 只允许 3 处，实际 ' + bareFetches + ' 处');
  assert.ok((indexSource.match(/fetchWithTimeout\(/g) || []).length >= 15, '其余网络调用都要走 fetchWithTimeout');
  // v321：危险操作的"长按确认"对键盘同样成立 —— 以前 keydown 阻止默认 + keyup 直接 fire()，
  // 等于键盘一次按键就执行了本该按住才生效的破坏性操作（读屏用户常用 Enter/Space 激活按钮）。
  assert.doesNotMatch(appSource, /keyup',function\(e\)\{if\(e\.key===' '\|\|e\.key==='Enter'\)\{e\.preventDefault\(\);fire\(\)\}\}/, '键盘不能一按就执行长按确认');
  assert.match(appSource, /if\(!held\)startHold\(e\)/);
  // 焦点管理：打开时记住、关闭时归还；Tab 圈在弹层里
  assert.match(appSource, /var prevFocus=document\.activeElement/);
  assert.match(appSource, /prevFocus\.focus\(\)/);
  assert.match(appSource, /e\.key==='Tab'/);
});

test('sync feedback has a single channel per event', () => {
  // 自动推送不再弹 toast（由顶部提示条负责），只有用户手动点上传才弹
  assert.doesNotMatch(appSource, /已同步到云端/);
  assert.match(appSource, /已上传到云端/);
  assert.match(appSource, /function syncPushImpl\(data\)\{return syncFetch\('POST',data\)/);
  // 设置面板的圆点已移除，"已上传 hh:mm" 那行小字保留
  assert.doesNotMatch(html, /id="syncDot"/);
  assert.doesNotMatch(appSource, /syncDot/);
  assert.match(appSource, /el\.textContent='已上传 '\+new Date\(\)\.toLocaleTimeString/);
});

test('form controls share one native-looking spec', () => {
  // 依据 mobile-native 硬规则：输入框字号 <16px 会让 iOS 聚焦时缩放整个页面
  assert.match(appMarkup, /#tab-data \.collapsible-header select\{width:auto!important;min-height:44px!important;padding:0 28px 0 10px!important;border-radius:12px!important;font-size:16px!important\}/);
  assert.match(appMarkup, /\.header-tools select\{height:44px;min-height:44px;padding:0 28px 0 10px/);
  assert.match(appMarkup, /\.attribution-card #attrYear\{height:44px;min-height:44px;padding:0 28px 0 10px/);
  // 自绘下拉箭头 / 日期图标线性化 / 数字框去掉桌面上下箭头
  assert.match(appMarkup, /select\{-webkit-appearance:none;appearance:none;background-image:url\("data:image\/svg\+xml/);
  assert.match(appMarkup, /input\[type=date\]::-webkit-calendar-picker-indicator\{width:16px;height:16px;padding:0;margin-right:8px;opacity:\.5/);
  assert.match(appMarkup, /input\[type=date\]\{min-width:0;max-width:100%\}/, '日期框不得超出所在栅格单元');
  // 侧边栏底部显示构建版本，用户可自行确认手机跑的是哪一版
  assert.match(html, /id="sbBuild"/);
  assert.match(appSource, /sbBuildEl\.textContent=APP_BUILD/);
  // iOS 的 input[type=date] 有最小固有宽度，会把相邻字段挤开：
  // ① 栅格项允许收缩 ② 触摸设备改用自绘外观（原生日历按钮隐藏）
  assert.match(appMarkup, /\.field-grid>\*,\.option-field-grid>\*,[^{]*\.tf-group\{min-width:0\}/);
  assert.match(appMarkup, /@media \(pointer:coarse\)\{/);
  assert.match(appMarkup, /input\[type=date\]\{-webkit-appearance:none;appearance:none;width:100%;min-width:0;background-image:url\("data:image\/svg\+xml/);
  assert.match(appMarkup, /input\[type=date\]::-webkit-calendar-picker-indicator\{display:none\}/);
  // 有值时不再画日历图标（否则日期末尾会与图标重叠；iOS 原生也是只显示值）
  assert.match(appMarkup, /input\[type=date\]\.has-val\{background-image:none\}/);
  assert.match(appSource, /classList\.toggle\('has-val',!!el\.value\)/);
  assert.match(appMarkup, /input\[type=number\]::-webkit-inner-spin-button\{-webkit-appearance:none;appearance:none;margin:0\}/);
  // iOS 不支持 input[type=month]，定投起点改成 年 + 月 两个下拉
  assert.doesNotMatch(html, /type="month"/);
  assert.match(html, /id="roadmapStartYear"/);
  assert.match(html, /id="roadmapStartMonth"/);
  assert.match(appSource, /state\.roadmapStart=rsY\.value\+'-'\+rsM\.value/);
  assert.match(appMarkup, /\.settings-split\{display:grid;grid-template-columns:1fr 1fr;gap:8px\}/);
});

test('market sparkline is built from real cached history points', () => {
  assert.equal(context.sparklinePath([1]), '');
  const path = context.sparklinePath([10, 12, 11, 15]);
  assert.match(path, /^M1\.0 /);
  assert.match(path, /L57\.0 2\.0$/);
});

test('price refresh requests one-month history and retains valid closes', async () => {
  let requestedUrl = '';
  const priceFetchStub = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ ok: true, data: { chart: { result: [{
        meta: { regularMarketPrice: 28.38, chartPreviousClose: 28.41 },
        indicators: { quote: [{ close: [27.9, null, 28.1, 28.38] }] },
      }] } } }),
    };
  };
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
    // v320：取价改走带截止时间的 fetchWithTimeout，这里两个名字都指向同一个桩
    fetch: priceFetchStub,
    fetchWithTimeout: priceFetchStub,
  });
  // v311：取价的实现改名成 fetchPriceImpl（外面套了一层"并发去重"的 fetchPrice），
  // 这里只测实现体，所以就地改名回 fetchPrice 再注入。
  vm.runInContext('async ' + extractFunction('fetchPriceImpl').replace('function fetchPriceImpl(', 'function fetchPrice('), priceContext);
  const quote = await priceContext.fetchPrice('BTC');
  assert.match(requestedUrl, /symbol=BTC&range=1mo$/);
  assert.deepEqual(Array.from(quote.history), [27.9, 28.1, 28.38]);
  assert.equal(quote.prevClose, 28.1);
  assert.ok(Math.abs(quote.change - 0.28) < 1e-9);
  assert.equal(quote.historyRange, '1mo');
  // v311 去重护栏：并发调用同一标的只发一次请求
  let hits = 0;
  const dedupeContext = vm.createContext({
    console, Date, Number, Array, Object, isFinite, encodeURIComponent,
    PRICE_SYMBOLS: { BTC: 'BTC' },
    readPriceCache: () => ({}),
    // v320：取价走带截止时间的 fetchWithTimeout，两个名字都指向同一个计数桩
    fetchWithTimeout: async () => {
      hits += 1;
      return { ok: true, json: async () => ({ ok: true, data: { chart: { result: [{ meta: { regularMarketPrice: 30, previousClose: 29 }, indicators: { quote: [{ close: [29, 30] }] } }] } } }) };
    },
  });
  vm.runInContext('var priceReq={};', dedupeContext);   // 包装层依赖的并发表
  vm.runInContext(extractFunction('fetchPrice'), dedupeContext);
  vm.runInContext('async ' + extractFunction('fetchPriceImpl'), dedupeContext);
  const [a, b] = await Promise.all([dedupeContext.fetchPrice('BTC'), dedupeContext.fetchPrice('BTC')]);
  assert.equal(hits, 1, '并发取同一个标的应该只发一次请求，实际 ' + hits + ' 次');
  assert.equal(a, b, '两次调用应共享同一个结果对象');
});

test('desktop UI states stay data-consistent and scrollable', () => {
  assert.match(appMarkup, /\[data-accent="ocean"\]\{--accent:#2867b7/);
  assert.match(appMarkup, /\.main\{[^}]*height:100dvh!important[^}]*overflow-y:auto!important/);
  assert.doesNotMatch(appMarkup, /sparkTransform|paths=\{VGT:/);
  assert.match(appMarkup, /historyRange:'1mo'/);
  assert.match(appMarkup, /color=getAssetColor\(row\.sym\)/);
  // v245：12 个月纪律热力的月度数据已抽到 charts.js，这里钉"模块函数 + 调用点"
  assert.match(appMarkup, /function disciplineMonths\(input\)/);
  assert.match(appMarkup, /disciplineMonths\(\{trades:trades,dca:dca,symbols:ETF_SYMS\}\)/);
  // v254：display:grid 的 !important 同上被去掉；base 规则（第 885 行）本来就是 display:grid
  assert.match(appMarkup, /#logHeatmap\{display:grid/);
  assert.doesNotMatch(appMarkup, /\+' · BTC ETF'/);
  assert.match(appMarkup, /#holdMetrics\{[^}]*grid-template-columns:1\.12fr repeat\(3,1fr\)!important[^}]*gap:0!important/);
  assert.match(appMarkup, /#holdMetrics \.metric\+\.metric\{border-left:1px solid var\(--rule\)!important\}/);
  assert.match(appMarkup, /美股非交易时段/);
});

/**
 * v336 事故回归：脚本是 `defer` 加载的，执行时 document.readyState 已经是 'interactive'
 * （不是 'loading'）。当时 initProb 用的写法是「不是 loading 就立刻跑」→ run() 在**模块求值
 * 过程中**同步执行 → 调用 updateOtm() → 读 otmSettings（声明在 78 行之后）→ TypeError
 * → 模块从此中断 → 末尾的 bootSplashOut 不执行 → 开屏遮罩永远盖着页面 → **点击没反应**。
 *
 * 两道防线都钉住：① 引导块必须等 DOMContentLoaded；② 它依赖的顶层变量必须声明在前面。
 */
test('index.js：引导块不得在模块求值中读到未赋值的顶层变量（v336 点击无反应回归）', () => {
  const lines = indexSource.split('\n');
  const find = (re) => lines.findIndex((l) => re.test(l));
  const initProb = find(/^\(function initProb/);
  const otmSettings = find(/^var otmSettings=/);
  assert.ok(initProb > 0, '找不到 initProb');
  assert.ok(otmSettings > 0, '找不到 otmSettings');
  assert.ok(otmSettings < initProb, 'otmSettings 必须先于 initProb 赋值（initProb 会同步调 updateOtm）');

  // defer 场景下 readyState 是 'interactive'，只有 'complete'（脚本被动态注入）才允许立刻跑
  const tail = lines.slice(initProb - 1);
  const endIdx = tail.findIndex((l) => /^\}\)\(\);/.test(l));
  const block = tail.slice(0, endIdx + 1).join('\n');
  assert.ok(endIdx > 0, '找不到 initProb 的结尾');
  assert.match(block, /if\(document\.readyState==='complete'\)run\(\);else document\.addEventListener\('DOMContentLoaded',run\)/,
    'initProb 必须等 DOMContentLoaded —— 用「不是 loading 就立刻跑」会在 defer 下读到未赋值的变量');
  assert.doesNotMatch(block, /readyState==='loading'\)\s*\{?\s*document\.addEventListener\('DOMContentLoaded',\s*run\)/,
    '这种写法在 defer 下会同步执行，不要再回来');

  // updateOtm 自身留了兜底：万一顺序又被人改坏，也不至于让整页死掉
  assert.match(indexSource, /function updateOtm\(\)\{if\(!otmSettings\)otmSettings=\{vgt:7,smh:6\}/,
    'updateOtm 要有 otmSettings 兜底，避免再次"读 undefined 直接崩"');
});

/**
 * v339 曾在方案里写下「点列头直接设 OTM，去掉 +/- 按钮」，结果只剩下 3/5/7/10/15 五档，
 * 想设 6%/8% 就没辙了 —— 用户马上报「没有加减号」。两个入口各有各的用处，都留着：
 *   · 加减号 = 微调（每次 1%，adjOtm 钳到 1~20%）
 *   · 点列头 = 快速跳到五档预设
 * 删掉哪一个，用户都会再报一次「调不了 OTM」。
 */
test('期权页：OTM 加减号与「看什么」视角都在，且加减号接回 adjOtm', () => {
  ['probOtmSym', 'probOtmMinus', 'probOtmVal', 'probOtmPlus', 'probSpot', 'probNote'].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), '缺了 #' + id);
  });
  // v359：OTM% / 列头目标价 / 格里的实际档位全是相对现价算的，把现价摆在 OTM 旁边当参照
  assert.match(indexSource, /getElementById\('probSpot'\)/, '要渲染现价');
  assert.match(indexSource, /现价 \$/, '现价文案要写明是"现价"');
  // 接线：两个按钮都要真的调 adjOtm（少了它按钮就是个点了没反应的 <button>）
  assert.match(indexSource, /getElementById\('probOtmMinus'\)[\s\S]{0,140}adjOtm\(probTab,-1\)/,
    '减号没接回 adjOtm');
  assert.match(indexSource, /getElementById\('probOtmPlus'\)[\s\S]{0,140}adjOtm\(probTab,1\)/,
    '加号没接回 adjOtm');
  // 切 VGT / SMH 时标签与数值要跟着变，否则 SMH 那页会顶着「VGT OTM」
  assert.match(indexSource, /getElementById\('probOtmSym'\)[\s\S]{0,100}probTab\+' OTM'/, 'OTM 标签没跟着标的切');
  assert.match(indexSource, /getElementById\('probOtmVal'\)[\s\S]{0,100}otm\+'%'/, 'OTM 数值没跟着设置刷新');
});

/**
 * v328–v335 有过「节奏设置」界面，点「月度」会把 ccSchedule 写进本机存储；v336 把入口删了，
 * 但那份值还留在老设备上 —— 于是 SMH 会被算成 10-16 该处理 / 11-20 该卖 / 持有 35 天
 * （正确值是 10-30 → 11-20 = 21 天）。v343 起一次性清掉它，回落到代码里的固定策略。
 */
test('index.js：清掉残留的「节奏设置」本机缓存（SMH 被算成月度 35 天的根因）', () => {
  const reset = indexSource.indexOf("CC_RESET_KEY='cc_schedule_reset_v1'");
  const load = indexSource.indexOf('(function loadCcSchedule');
  assert.ok(reset > 0, '找不到一次性清理块');
  assert.ok(load > reset, '清理必须发生在 loadCcSchedule 读存储之前，否则又被旧值覆盖回来');
  assert.match(indexSource, /LS\.removeItem\(CC_KEY\)/, '要真的把残留删掉，只写标记没用');
  // 只清本机偏好，不许顺手把投资数据一起干掉
  assert.doesNotMatch(indexSource.slice(reset, load), /removeItem\('(trades|cashLog|state|optionTrades)'\)/,
    '清理块只能碰 ccSchedule');
});

/**
 * 手机上矩阵列多，要横向滚动。但滚动必须由**外层容器**承担：
 * 一旦把 .mx-table 设成 display:block、再让 thead/tbody 各自 display:table，
 * 两个表格盒会各算一遍列宽，表头与数据列错位（v344 实测最大差 40px）。
 */
test('CSS：概率矩阵的横向滚动挂在外层容器，表格本身不许拆成两个表格盒', () => {
  assert.match(css, /#probMatrix\{overflow-x:auto/, '横向滚动要挂在 #probMatrix 上');
  assert.doesNotMatch(css, /\.mx-table\{min-width:/, '不要再给矩阵写 min-width —— 它会强制多滚一截，放得下就该不滚');
  assert.doesNotMatch(css, /\.mx-table\{display:block/, '把表格设成 block 会让表头和数据各算一遍列宽');
  assert.doesNotMatch(css, /\.mx-table thead,\.mx-table tbody\{display:table/, 'thead/tbody 不许各自变成表格盒');
});

/**
 * 用户的常用区间是 5%~8%（VGT 默认 7%、SMH 默认 6%），3%/10%/15% 那些档平时不看。
 * 默认列固定 5/6/7/8 四档；调到区间外时换成"离当前值最近的 4 档"，当前档永远在表里。
 */
test('index.js：矩阵默认列是 5/6/7/8 四档，且当前 OTM 永远在表里', () => {
  assert.match(indexSource, /var base=\[5,6,7,8\],c=Number\(cur\)/, '默认列改成常用区间 5~8（每 1% 一档）');
  assert.match(indexSource, /\.slice\(0,4\)/, '列数固定 4 —— 手机上少拖一点');
  const fn = indexSource.slice(indexSource.indexOf('function matrixOtms'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /Math\.abs\(a-c\)-Math\.abs\(b-c\)/, '区间外要按"离当前值最近"挑，而不是硬塞');
});

/**
 * v346：观察列表移到操作台最前面（一进操作页先看到行情，而不是先看到录入表）。
 * 顺序纯靠 HTML 位置决定，挪回去不会有任何报错、只会静静地变回原样，所以要钉住。
 */
test('操作台：观察列表置顶，顺序为 观察列表 → 买卖操作录入 → 现金管理 → 年度再平衡', () => {
  const panel = html.slice(html.indexOf('id="tab-console"'), html.indexOf('id="tab-option"'));
  assert.ok(panel.length > 0, '找不到操作台面板');
  const at = (needle) => panel.indexOf(needle);
  assert.ok(at('id="watchCard"') > 0, '操作台里没有观察列表');
  assert.ok(at('id="watchCard"') < at('console-entry-card'), '观察列表要排在「买卖操作录入」之前');
  assert.ok(at('console-entry-card') < at('现金管理'), '「买卖操作录入」在「现金管理」之前');
  assert.ok(at('现金管理') < at('id="yearRebalanceCard"'), '「现金管理」在「年度再平衡」之前');
  assert.equal((html.match(/id="watchCard"/g) || []).length, 1, '观察列表只能有一块（搬家用的是剪切，不是复制）');
});

/**
 * v349：概率卡的主结论从"你下次该卖哪一档"（纯日历推算）改成**本期做到哪一步了**：
 *   本期 = 今天之后最近的节奏档；状态 = 记录里有没有这一档的 CALL。
 * 没记就显示"未卖出"—— 绝不拿行情去猜你到底卖没卖。
 */
test('index.js：本期状态由「今天 + 记录」推出，且卡片上要写出节奏（VGT 按月 / SMH 每3周）', () => {
  assert.match(indexSource, /function ccPeriod\(sym\)/, '缺 ccPeriod');
  assert.match(indexSource, /function ccSold\(sym,expiry\)/, '缺 ccSold');
  assert.match(indexSource, /o\.sym===sym&&o\.type==='CALL'&&o\.expiry===expiry&&!o\.archived/,
    '"已卖出"只能按记录判（同标的、同到期日的 CALL、未归档）');
  assert.match(indexSource, /fixed:roll\.date/, '★ 要标在「该卖」那一档（结论行主行说的同一档）');
  assert.match(indexSource, /ruleLabel:period\.label/, '节奏名（每月第三个周五 / 每 3 周的周五）要传到卡片上');
  assert.match(indexSource, /sold:ccSold\(probTab,roll\.date\)/, '状态挂在「该卖」那一档上（吸附后的挂牌日）');
});

/**
 * v352：两张卡都在讲"到期日"，用户被绕晕了。分工写到标题上，并各自删掉对方的东西：
 *   被行权概率 = 决策卡（该卖哪一档，★ 只在这儿）
 *   到期日历   = 资料卡（市场有哪些到期日：月度/周度、间距、我的持仓），不再标 ★
 */
test('期权页：两张卡的分工写在标题上，节奏 ★ 只在「被行权概率」卡', () => {
  assert.match(html, /<h3>被行权概率<span class="card-sub">该卖哪一档<\/span><\/h3>/, '概率卡要写清它是决策卡');
  assert.match(html, /<h3>到期日历<span class="card-sub">市场有哪些到期日<\/span><\/h3>/, '日历卡要写清它是资料卡');
  assert.doesNotMatch(html, /★ = 按固定节奏该卖的档位/, '日历卡里不再重复 ★ 的说明');
  assert.doesNotMatch(indexSource, /fixed\[sym\]/, '日历卡不再收「节奏那一档」——★ 归概率卡');
  // indexSource 是剥掉 import 行的版本，所以这里只能钉"在用它"（唯一来源由 audit 的跨模块 import 规则兜底）
  assert.match(indexSource, /isMonthlyExpiry/, 'isMonthlyExpiry 已抽到 prob.js，矩阵行头与日历卡共用同一份判断');
});

/**
 * v353：卡片上的日期是纯日历推算（每月第三个周五 / 每 3 周），但市场并不总照日历走
 * —— 假期周会把周五的到期日挪到周四，那天市场上根本没有合约。
 * 所以两个日期（该卖的到期日、卖出日）都必须先吸附到链里真实挂牌的档位上。
 */
test('index.js：节奏档要先吸附到真实挂牌到期日，链没到时按日历显示、不编「已顺延」', () => {
  assert.match(indexSource, /snapToListed\(period\.date,listed\)/, '卖出日要吸附');
  assert.match(indexSource, /var rollRaw=ccRollExpiry\(probTab\)[\s\S]{0,80}snapToListed\(rollRaw,listed\)/, '该卖的到期日要吸附');
  assert.match(indexSource, /shiftNote:roll\.shifted\?\([^)]*rollRaw/, '顺延提示里的日期要用「该卖」那一档的节奏日，别写成本期');
  assert.match(indexSource, /function listedExpiries\(chain\)/, '要取链里真实挂牌的到期日列表');
  assert.match(indexSource, /shiftNote:roll\.shifted/, '顺延了要写在结论行上，不能悄悄换日期');
});

/**
 * v356：到期日历原本默认只筛「月度档」，可 VGT 和 SMH 的市场月度档**本来就是同几天**
 * （每月第三个周五）—— 于是两张标的的日历看起来一模一样，SMH 的周度档全被滤掉了。
 * 改成：默认列**周五档**的前 3 个，并且永远带上该标的的节奏档。
 */
test('到期日历：默认列「周五档」而不是「月度档」，并永远带上该标的的节奏档', () => {
  assert.match(indexSource, /all\.filter\(function\(e\)\{return weekdayOf\(e\.date\)===5\}\)\.slice\(0,3\)/,
    '默认要按周五筛（VGT 全是周五；SMH 才留下周度档）');
  assert.match(indexSource, /var beat=ccRollExpiry\(sym\)/, '日历要知道该标的的节奏档');
  assert.match(indexSource, /picked=picked\.concat\(\[hitStep\]\)/, '节奏档必须并进默认视图，否则 SMH 会跟 VGT 一样');
  assert.doesNotMatch(indexSource, /all\.filter\(function\(e\)\{return isMonthlyExpiry\(e\.date\)\}\)\.slice\(0,3\)/,
    '不要再按"月度档"筛默认视图');
});
