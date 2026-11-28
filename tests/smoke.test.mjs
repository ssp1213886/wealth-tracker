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
const portfolioConfigSource = fs.readFileSync('src/app/portfolio-config.js', 'utf8').replace(/^export /gm, '');
const indexSource = fs.readFileSync('src/app/index.js', 'utf8').replace(/^import .*$/gm, '');
const appSource =
  utilSource + '\n' + calcSource + '\n' + portfolioConfigSource + '\n' + storeSource + '\n' + syncSource + '\n' +
  renderSource + '\n' + rowsSource + '\n' + timeSource + '\n' + symbolsSource + '\n' + recordsSource + '\n' + chartsSource + '\n' + syncViewSource + '\n' + portfolioViewSource + '\n' + alertsViewSource + '\n' + indexSource;
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
  ETF_SYMS: ['QQQM', 'VGT', 'SMH'],
  TRADE_SYMBOLS: ['QQQM', 'VGT', 'SMH'],
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
  'cleanText',
  'escapeHtml',
  'normalizeDateValue',
  'normalizeTrades',
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
  const afterMarketClose = new Date('2026-07-19T05:00:00+08:00');
  assert.equal(context.marketDate(afterMarketClose), '2026-07-18');
  assert.equal(context.marketDate(new Date('2026-08-01T00:30:00+08:00')).slice(0, 7), '2026-07');
});

test('trade normalization accepts QQQM ticker and rejects retired symbols', () => {
  const rows = context.normalizeTrades([
    { id: 1, symbol: 'qqqm', date: '2026-07-18', shares: 10, price: 261.05 },
    { id: 2, symbol: 'BTC-USD', date: '2026-07-18', shares: 1, price: 118000 },
    { id: 3, symbol: 'BTC', date: '2026-07-18', shares: 1, price: 118000 },
  ]);
  assert.equal(rows.length, 1, '现货 BTC / BTC-USD 都不该通过白名单');
  assert.equal(rows[0].symbol, 'QQQM');
  assert.equal(rows[0].price, 261.05);
});

test('Schwab CSV parser handles quotes, sells, duplicates, and ETF allowlist', () => {
  const csv = [
    'Date,Action,Symbol,Quantity,Price',
    '07/18/2026,Buy,QQQM,10,"$261.05"',
    '07/18/2026,Sell,VGT,1,"$113.10"',
    '07/18/2026,Buy,BTC-USD,1,"$118,000.00"',
    '07/18/2026,Buy,QQQM,10,"$261.05"',
  ].join('\n');
  // v244：解析已抽到 records-import.js（纯函数，返回待插入的行；id 与写入留给 index.js 的包装层）
  const parsed = context.parseSchwabCSV(csv, { symbols: ['QQQM', 'VGT', 'SMH'], existingTrades: [] });
  assert.equal(parsed.imported, 2, '重复行与非白名单代码应被剔除');
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].symbol, 'QQQM');
  assert.equal(parsed.rows[0].shares, 10, 'Buy 记正股数');
  assert.equal(parsed.rows[1].symbol, 'VGT');
  assert.equal(parsed.rows[1].shares, -1, 'Sell 记负股数');
  assert.ok(parsed.rows.every((r) => r.id === undefined), '纯函数不分配 id');
  // 与已有交易按「日期|代码|股数|价格」去重
  const dup = context.parseSchwabCSV(csv, { symbols: ['QQQM', 'VGT', 'SMH'], existingTrades: [{ date: '2026-07-18', symbol: 'QQQM', shares: 10, price: 261.05 }] });
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
  assert.equal(manifest.start_url, '/?v=463');
  assert.equal(manifest.background_color, '#f5f6f3');
  assert.match(serviceWorker, /wealth-v463/);
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
  assert.match(appMarkup, /register\('\/sw\.js\?v=463',\{updateViaCache:'none'\}\)/);
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
  assert.match(appMarkup, /#bottomBar\.bottom-bar\{grid-template-columns:1fr 1fr 88px 1fr 1fr!important\}/);
  assert.match(appMarkup, /\.bb-btn\{position:static!important;top:auto!important;left:auto!important;width:100%!important;min-width:0!important;justify-self:stretch!important;height:68px!important;min-height:68px!important/);
  assert.match(appMarkup, /\.sidebar\.open\{transform:translate3d\(0,0,0\)!important\}/);
  assert.match(appMarkup, /transition:none!important\}/);
  // 快捷操作按钮占用底栏中间的独立槽位（左右各两个导航按钮），不再遮挡导航
  assert.match(appMarkup, /#qaFab\.qa-fab\{left:50%!important;right:auto!important;bottom:calc\(32px \+ env\(safe-area-inset-bottom,0px\)\)!important;transform:translateX\(-50%\)!important/);
  assert.match(appMarkup, /#bottomBar #bbAnalysis\{grid-column:4\}/);
  assert.match(appMarkup, /#bottomBar #bbData\{grid-column:5\}/);
  // v254：这条规则上的 !important 被 C1 证明冗余后去掉了（四种组合指纹零差异），断言改为只钉高度
  // v301：触控热区统一提到 ≥44px（Apple HIG）。这里不再钉死具体数值——
  // 钉住「不小于 44px」这条不变量，以后调尺寸不会再误报成回归。
  assert.doesNotMatch(html, /data-tab="option"|id="bbOption"|id="tab-option"/);
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
  /* v372：待办列表里的"已卖 N 张 Call"信息条已移除（它会让"叉掉今天不再提醒"后冒出替身，
     而且它本来就不需要动作）。覆盖情况由期权页的节奏徽章承担，见 prob-view.test.mjs 的「已卖 ✓」两条断言。 */
  assert.doesNotMatch(appMarkup, /已卖 '\+contracts\+' 张 Call/);
  assert.doesNotMatch(appMarkup, /距 Covered Call/);
  assert.doesNotMatch(appMarkup, /onclick="qaDividend\(\)"/);
  assert.doesNotMatch(appMarkup, /function qaDividend\(/);
  assert.match(html, /id="hmDividend"/);
  /* v443：快捷操作从 3 个变 4 个（入金/买入/卖出/记定投），网格同步改成四等分 */
  assert.match(appMarkup, /\.qa-grid\{display:grid!important;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
  assert.match(html, /onclick="qaDca\(\)"/, '快捷操作里必须有"记定投"入口');
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
  assert.doesNotMatch(appSource, /keyup',function\(e\)\{if\(e\.key===' '\|\|e\.key==='Enter'\)\{e\.preventDefault\(\);fire\(\)\}\}/, '键盘不能一按就执行长按确认');
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
    PRICE_SYMBOLS: { IBIT: 'IBIT' },
    readPriceCache: () => ({}),
    // v320：取价改走带截止时间的 fetchWithTimeout，这里两个名字都指向同一个桩
    fetch: priceFetchStub,
    fetchWithTimeout: priceFetchStub,
  });
  // v311：取价的实现改名成 fetchPriceImpl（外面套了一层"并发去重"的 fetchPrice），
  // 这里只测实现体，所以就地改名回 fetchPrice 再注入。
  vm.runInContext('async ' + extractFunction('fetchPriceImpl').replace('function fetchPriceImpl(', 'function fetchPrice('), priceContext);
  const quote = await priceContext.fetchPrice('IBIT');
  assert.match(requestedUrl, /symbol=IBIT&range=1mo$/);
  assert.deepEqual(Array.from(quote.history), [27.9, 28.1, 28.38]);
  assert.equal(quote.prevClose, 28.1);
  assert.ok(Math.abs(quote.change - 0.28) < 1e-9);
  assert.equal(quote.historyRange, '1mo');
  // v311 去重护栏：并发调用同一标的只发一次请求
  let hits = 0;
  const dedupeContext = vm.createContext({
    console, Date, Number, Array, Object, isFinite, encodeURIComponent,
    PRICE_SYMBOLS: { IBIT: 'IBIT' },
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
  const [a, b] = await Promise.all([dedupeContext.fetchPrice('IBIT'), dedupeContext.fetchPrice('IBIT')]);
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
  // v433：核心仓统一从 portfolio-config.js 派生，不能再写死旧三腿或 state.btc。
  assert.doesNotMatch(appMarkup, /\['VGT','SMH','BTC'\]/);
  assert.doesNotMatch(appMarkup, /sym==='IBIT'\?state\.btc/);
  assert.match(appMarkup, /CORE_PORTFOLIO/);
  assert.match(appMarkup, /function legTargets\(\)/);
  assert.match(appMarkup, /#holdMetrics\{[^}]*grid-template-columns:1\.12fr repeat\(3,1fr\)!important[^}]*gap:0!important/);
  assert.match(appMarkup, /#holdMetrics \.metric\+\.metric\{border-left:1px solid var\(--rule\)!important\}/);
  assert.match(appMarkup, /美股非交易时段/);
});

test('图表增强：趋势图 3 年数据、范围切换、十字线与资产曲线网格', () => {
  assert.match(indexSource, /function fetchTrendData\(sym,force\).*range=3y/);
  assert.match(indexSource, /function fetchTrendData\(sym,force\).*5\*60\*1000/);
  assert.match(indexSource, /var j=await fetchTrendData\(sym,force\)/);
  assert.match(indexSource, /granularity!=='1d'/);
  assert.match(indexSource, /趋势数据不是日线/);
  assert.match(indexSource, /fetchMarketRegime\(sym,force\)/);
  assert.match(indexSource, /trendRange=b\.dataset\.trendrange/);
  assert.match(css, /\.trend-tooltip\{/);
  assert.match(css, /\.trend-current-dot\{/);
  assert.match(css, /\.trend-range-chip\.is-on\{/);
  assert.match(css, /\.equity-chart \.eq-grid\{/);
});

/**
 * v336 事故回归：脚本是 `defer` 加载的，执行时 document.readyState 已经是 'interactive'
 * （不是 'loading'）。当时 initProb 用的写法是「不是 loading 就立刻跑」→ run() 在**模块求值
 * 过程中**同步执行 → 调用 updateOtm() → 读 otmSettings（声明在 78 行之后）→ TypeError
 * → 模块从此中断 → 末尾的 bootSplashOut 不执行 → 开屏遮罩永远盖着页面 → **点击没反应**。
 *
 * 两道防线都钉住：① 引导块必须等 DOMContentLoaded；② 它依赖的顶层变量必须声明在前面。
 */
test('index.js：市场趋势初始化等 DOMContentLoaded 后再读取顶层状态', () => {
  assert.match(indexSource, /\(function initMarketTrend\(\)\{/);
  assert.match(indexSource, /if\(document\.readyState==='complete'\)run\(\);else document\.addEventListener\('DOMContentLoaded',run\)/);
  assert.doesNotMatch(indexSource, /initProb|otmSettings|OTM_DEFAULTS/);
});

/**
 * v384：第三腿换成 IBIT 后 "哪些标的能卖 CALL" 有三份名单：前端 OPTION_SYMS、
 * options.js 的兜底、worker 的链白名单。三者必须一致 —— 不一致就会出现
 * "概率卡看不到那一档""录了但持仓里不显示""接口直接 400"这类只在真机上才发现的怪毛病。
 */
test('v394：累计收益率＝一处口径两处显示（累计入金为分母）', () => {
  assert.match(html, /id="msPnlPct"/, '手机汇总条要有百分比元素');
  assert.match(html, /id="hmPnLPctPill"/, '桌面金额旁边要有百分比胶囊');
  assert.match(indexSource, /deposits:totalDeposits\(cashLog\)/, '分母要用累计入金（与年度复盘共用 totalDeposits）');
  assert.match(indexSource, /lastPortfolioTotals=totals/, '手机状态栏必须读同一份计算结果，不能重算');
  assert.match(indexSource, /lastPortfolioTotals\.pct/, '手机状态栏渲染的是同一份 pct');
  assert.match(css, /\.m-pct\[hidden\]\{display:none\}/, '[hidden] 必须显式压掉 display，否则会被 inline-block 顶掉');
  assert.match(css, /\.ms-summary\{min-height:56px/, '汇总条不能写死高度（多一行会被裁）');
});

test('操作台只负责交易，观察列表和趋势图属于分析页', () => {
  const consolePanel = html.slice(html.indexOf('id="tab-console"'), html.indexOf('id="tab-analysis"'));
  const analysisPanel = html.slice(html.indexOf('id="tab-analysis"'), html.indexOf('id="tab-data"'));
  assert.ok(consolePanel.length > 0 && analysisPanel.length > 0, '找不到操作台或分析页');
  assert.equal(consolePanel.indexOf('id="watchCard"'), -1, '观察列表不应继续留在操作台');
  assert.ok(analysisPanel.indexOf('id="watchCard"') > 0, '分析页缺少观察列表');
  assert.ok(analysisPanel.indexOf('id="watchCard"') < analysisPanel.indexOf('market-trend-card'), '观察列表应在市场趋势之前');
  assert.ok(consolePanel.indexOf('console-entry-card') < consolePanel.indexOf('现金管理'), '「买卖操作录入」在「现金管理」之前');
  assert.ok(consolePanel.indexOf('现金管理') < consolePanel.indexOf('id="yearRebalanceCard"'), '「现金管理」在「年度再平衡」之前');
  assert.equal((html.match(/id="watchCard"/g) || []).length, 1, '观察列表只能有一块（搬家用的是剪切，不是复制）');
});

/**
 * v349：概率卡的主结论从"你下次该卖哪一档"（纯日历推算）改成**本期做到哪一步了**：
 *   本期 = 今天之后最近的节奏档；状态 = 记录里有没有这一档的 CALL。
 * 没记就显示"未卖出"—— 绝不拿行情去猜你到底卖没卖。
 */

/**
 * v352：两张卡都在讲"到期日"，用户被绕晕了。分工写到标题上，并各自删掉对方的东西：
 *   被行权概率 = 决策卡（该卖哪一档，★ 只在这儿）
 *   到期日历   = 资料卡（市场有哪些到期日：月度/周度、间距、我的持仓），不再标 ★
 */
test('「组合值多少钱」只有一处口径：月末快照与年度归因都走 portfolioStateAt', () => {
  assert.match(indexSource, /portfolioStateAt\(\{trades:trades,cashLog:cashLog,end:\(Number\(year\)-1\)\+'-12-31'\}\)/, '年度归因的年初快照要用共享实现');
  assert.match(indexSource, /portfolioStateAt\(\{trades:trades,cashLog:cashLog,end:yE\}\)/, '年末快照同理');
  assert.doesNotMatch(indexSource, /if\(t\.date<yS\)sCash\+=cashSigned\(l\)/, '不要回到自己累加现金那一版');
  assert.match(indexSource, /sbTotals=portfolioTotals\(/, '侧边栏总资产也要走共享口径');
  assert.doesNotMatch(indexSource, /hasAny\?totalV\+nc:nc/, '不要再内联算 totalV+nc');
});

test('v440：当前年度归因的年末价必须与首页实时价同源', () => {
  assert.match(
    indexSource,
    /function fetchYearEndPrice\(sym,year\)\{ if\(Number\(year\)===Number\(marketDate\(\)\.slice\(0,4\)\)&&Number\(livePrices\[sym\]\)>0\) return Promise\.resolve\(Number\(livePrices\[sym\]\)\)/,
    '当年的年末价要复用 livePrices，否则年度归因读的是 24 小时缓存的 max 数据'
  );
});

test('v370：行情自动刷新 —— 定时器与"切回前台"都要刷（不能只刷加密那条链路）', () => {
  assert.match(indexSource, /setInterval\(autoRefreshQuotes,300000\)/, '定时器必须接 autoRefreshQuotes');
  assert.doesNotMatch(indexSource, /setInterval\(refreshPrices,/,
    '不能再让定时器直连 refreshPrices —— 它只对加密标的取数，VGT/SMH 永远不会更新');
  assert.match(appSource, /function autoRefreshQuotes\(\)\{[^\n]*refreshMarket\(false\)/,
    'autoRefreshQuotes 必须先走行情总线 refreshMarket（自带 60 秒冷却）');
  assert.match(indexSource, /visibilitychange',function\(\)\{[^\n]*refreshQuotesIfStale\(\)/,
    '切回前台要补刷行情');
  assert.match(appSource, /function refreshQuotesIfStale\(\)\{[^\n]*quotesStale\(watchFetchedAt,Date\.now\(\),QUOTE_STALE_MS\)/,
    '前台补刷要用 quotesStale 判定（5 分钟门槛），不能每次切页都打请求');
});

test('v370：配色圆点在触摸端有 44px 热区，可见圆点仍是 30px', () => {
  assert.match(css, /@media\(pointer:coarse\) and \(max-width:1159\.98px\)\{/,
    '要有触摸端热区媒体查询（≤800 手机 + 801–1159 触摸平板）');
  assert.match(css, /\.accent-dots \.accent-dot\{width:44px!important;height:44px!important/,
    '按钮本体要 ≥44px，真机脚本才不再报"偏小"');
  assert.match(css, /\.accent-dots \.accent-dot::before\{content:"";width:30px;height:30px/,
    '可见圆点仍由 ::before 画 30px（视觉尺寸不能变大）');
});

test('v370：资产曲线卡挂在仪表盘，且复用 range=max 的历史（不新增请求）', () => {
  assert.match(html, /class="card equity-card" id="equityCard"/, '仪表盘要有这张卡');
  assert.match(html, /id="equityChart"/);
  assert.match(html, /id="equityRange"/);
  assert.match(appSource, /function refreshEquityCurve\(\)\{/);
  assert.match(appSource, /var priceByMonth=buildPriceByMonth\(list,ETF_SYMS,months\)/,
    '曲线必须只构建一份月度价格');
  assert.match(appSource, /equitySeries\(\{months:months,trades:trades,cashLog:cashLog,priceByMonth:priceByMonth\}\)/,
    '曲线必须走共享的 equitySeries');
  assert.match(appSource, /policyBenchmarkSeries\(\{months:months,cashLog:cashLog,priceByMonth:priceByMonth/,
    '策略基准必须复用同一份月度价格');
  assert.match(appSource, /Promise\.all\(ETF_SYMS\.map\(function\(s\)\{return fetchMaxData\(s\)/,
    '历史只认 fetchMaxData（请求级缓存，页面开一次只打一次）');
  assert.match(css, /#tab-analysis \.equity-card\{grid-column:1\/-1/,
    '资产曲线应作为分析页的整行卡片');
});

test('资产配置同时展示目标与实际占比，回撤卡包含金额口径', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const appSource = fs.readFileSync('src/app/index.js', 'utf8');
  const portfolioView = fs.readFileSync('src/app/portfolio-view.js', 'utf8');
  assert.match(html, /id="sbVgtCurrent"/);
  assert.match(html, /id="sbSmhCurrent"/);
  assert.match(html, /id="sbQqqmCurrent"/);
  assert.match(appSource, /Current'\)/);
  assert.match(portfolioView, /class="drawdown-value">[^<]*<small>/);
});

test('交易影响预览：只显示占比变化，现金只显示金额', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const appSource = fs.readFileSync('src/app/index.js', 'utf8');
  assert.match(html, /id="tfPrice"[^>]*placeholder="输入成交价"/);
  assert.doesNotMatch(html, /placeholder="580"/);
  assert.match(appSource, /资产占比按持仓市值计算 · 现金仅显示金额/);
  assert.doesNotMatch(appSource, /不计偏离|目标偏离/);
  assert.match(appSource, /priceEl\.placeholder=reference>0/);
});

test('v370：到期提醒角标 —— 开关、权限申请、"只数需要动手的提醒"都接好了', () => {
  assert.match(html, /id="cbAlertBadge"/, '设置页要有角标开关');
  assert.match(html, /id="alertBadgeNote"/, '开关下面要有说明/兜底文案');
  assert.match(appSource, /function bindAlertBadgeToggle\(\)\{/);
  assert.match(appSource, /syncAppBadge\(list\)/, 'refreshCcAlerts 里要写角标');
  assert.match(appSource, /requestPermission/, '权限要在用户手势里申请');
  assert.match(appSource, /applyAppBadge\(navigator,/, '写角标走 alerts-view 的 applyAppBadge');
});

/* ===== v371：角标口径修正 + 期权提醒去冗余 ===== */

test('v371：角标数 = 提醒列表条数（不许再按 severity 过滤 —— v370 就是这么错的）', () => {
  /* 注意：alertsViewSource 里的 `export ` 前缀已经被剥掉了（见文件头的拼装方式） */
  assert.match(alertsViewSource, /function badgeCountOf\(alerts\)\s*\{\s*return \(alerts\s*\|\|\s*\[\]\)\.filter\(Boolean\)\.length;?\s*\}/,
    'badgeCountOf 必须直接数条目');
  /* 只切函数体来断言（不能整文件匹配：updateBellBadge 里本来就有 severity==='critical'，
     那是给铃铛加红点用的，跟角标计数无关） */
  const badgeStart = alertsViewSource.indexOf('function badgeCountOf(alerts){');
  const badgeBody = alertsViewSource.slice(badgeStart, alertsViewSource.indexOf('}', badgeStart) + 1);
  assert.doesNotMatch(badgeBody, /severity/,
    'badgeCountOf 里不许出现 severity：它是排序/配色用的，不是催办判据（v370 就是这么错的）');
  assert.match(alertsViewSource, /const items = list \|\| \[\];[\s\S]*?const count = badgeCountOf\(items\)/,
    '手机端铃铛角标必须与主屏角标共用同一个计数函数');
});

/* ===== v441：云同步 409 死循环 ===== */
test('v441：待确认的冲突键不许自动重推，冲突弹窗必须真的弹出来', () => {
  assert.match(indexSource, /var pc=st\.pendingConflicts\|\|\[\];/, 'buildPushData 要读 pendingConflicts');
  assert.match(indexSource, /pc\.forEach\(function\(k\)\{delete payload\[k\];/, '冲突键要从 payload 里剔除');
  assert.match(indexSource, /if\(diff\.length\)st\.pendingConflicts=Array\.from\(new Set\(\(st\.pendingConflicts\|\|\[\]\)\.concat\(diff\)\)\);/, 'heal 检出差异必须先登记冲突');
  assert.match(indexSource, /showSyncConflict\(diff,r\.data\)/, 'heal 检出差异要直接弹冲突框，不能回到 autoPull 无限重试');
  assert.match(indexSource, /if\(readRaw\(KEYS\.coreMigrationV4\)==='1'\)\{/, '迁移短路必须带条件判断');
  assert.match(indexSource, /if\(!pendingDirtyKeys\(_mst,SYNC_KEYS\)\.length\)/, '没有待推键时必须清标记走真拉取');
  assert.match(indexSource, /if\(!\(_mst\.pendingConflicts\|\|\[\]\)\.length\)\{autoPush\(\);return\}/, '迁移短路必须给未解决冲突让路');
});

test('v441：冲突解决后 dirty 与失败计数都要归零', () => {
  const start = indexSource.indexOf('function pushKeysForce');
  const body = indexSource.slice(start, indexSource.indexOf('\n', start));
  assert.ok(body.indexOf('clearDirty(k)') >= 0 && body.indexOf('var st=loadSyncState();') > body.indexOf('clearDirty(k)'),
    'pushKeysForce 必须先清脏再读快照，否则会把 dirty=true 写回去');
  assert.match(indexSource, /_cs\.failStreak=0;_cs\.lastSyncErrorAt=0;_cs\.lastSyncError=''/, '选择云端后要清失败计数');
  assert.match(indexSource, /SYNC_KEYS\.every\(function\(k\)\{return !\(s&&s\.dirty&&s\.dirty\[k\]\)\}\)\)removeKey\(KEYS\.coreMigrationV4\)/, '全部干净后要清掉迁移标记');
});

/* ===== v442：交接文档 P0/P1/P2 修复 ===== */
test('v442：清除全部数据要覆盖 watchlist 与本地归档/缓存', () => {
  assert.match(indexSource, /var empty=\{trades:\[\],cashBalance:0,cashLog:\[\],state:\{\},activities:\[\],exit_portfolio:'',prices:\{\},watchlist:\[\]\}/);
  const start = indexSource.indexOf('function clearAllData');
  const body = indexSource.slice(start, start + 4000);
  ['wealth_watchlist_v1', 'wealth_records_segment_v1', 'wealth_legacy_core_v4', 'wealth_fx_usd_cny_v1', 'wealth_marketcap_v3']
    .forEach((k) => { assert.ok(body.indexOf(k) >= 0, k + ' 必须一起清掉'); });
  assert.ok(body.indexOf('wealth_clear_snapshot_v1') < 0, '24 小时撤销快照不能被清掉');
});

test('v442：schema.sql 必须是 user_id + key 复合主键', () => {
  const sql = fs.readFileSync('schema.sql', 'utf8');
  assert.match(sql, /user_id INTEGER NOT NULL/);
  assert.match(sql, /PRIMARY KEY \(user_id, key\)/);
  assert.doesNotMatch(sql, /DROP TABLE IF EXISTS data/);
});

test('v444：所有金额统一换算，底层数据永远美元', () => {
  /* 展示层：任何美元金额都走 fmtFull（CNY 模式统一换算） */
  assert.match(rowsSource, /fmtFull\(Math\.abs\(l\.amount\)\)/);
  assert.match(indexSource, /<span>均价<\/span><strong>'\+fmtFull\(avg\)/);
  assert.doesNotMatch(indexSource, /fmtNativeFull\(/, '展示层不再输出美元硬编码');
  /* 存储层：state 里币种永远 USD；切换只改展示 */
  assert.match(indexSource, /displayCurrency:'USD'/);
  assert.doesNotMatch(indexSource, /state\.displayCurrency=next;saveState\(\)/);
  assert.match(indexSource, /configureCurrency\('USD',0\)/, '启动默认美元视图，不等汇率');
  assert.match(indexSource, /正在换算/, '缺汇率时要有正在换算提示');
});
test('v442：QQQM 要进间接持有与市值预取', () => {
  assert.doesNotMatch(indexSource, /\['VGT','SMH'\]/);
  assert.match(indexSource, /ETF_SYMS\.forEach\(function\(etf\)/);
  assert.match(indexSource, /ETF_SYMS\.forEach\(function\(k\)\{var d=holdingsData\[k\]/);
});

test('v442：年度归因补回卖出所得', () => {
  assert.match(indexSource, /as\[t\.symbol\]\+=Math\.abs\(t\.shares\)\*t\.price/);
  assert.match(indexSource, /-ac\[s\]\+as\[s\]/);
});

test('v442：monthlyDCA=0 不能被 || 回退成 2000', () => {
  assert.doesNotMatch(indexSource, /state\.monthlyDCA\|\|2000/);
  assert.match(indexSource, /\(state\.monthlyDCA===undefined\|\|state\.monthlyDCA===null\)\?2000/);
});

test('v442：历史行情失败可重试、range=max 不冒充日线', () => {
  assert.match(indexSource, /maxPriceReq\[k\]=null;return null/);
  const priceSource = fs.readFileSync('src/lib/price.js', 'utf8');
  assert.match(priceSource, /const dailyUsable = dailyTimes\.length > 0/);
  assert.match(priceSource, /if \(!dailyUsable\) return legacyResult/);
});

test('v442：搜索覆盖操作日志、DCA/快照弹层支持 Esc', () => {
  const search = fs.readFileSync('src/app/table-search.js', 'utf8');
  assert.match(search, /id: 'activityLog'/);
  assert.match(indexSource, /else if\(open\.id==='dcaSheet'\)closeDcaSheet\(\)/);
  assert.match(indexSource, /else if\(open\.id==='snapshotSheet'\)closeSnapshotSheet\(\)/);
});

test('v442：备份导入要说明被跳过的交易', () => {
  const backup = fs.readFileSync('src/app/backup.js', 'utf8');
  assert.match(backup, /skippedTrades/);
  assert.match(backup, /跳过 ' \+ skippedTrades \+ ' 笔/);
});

test('v442：云端数据到位后年度归因要自动重算（不能停在 0）', () => {
  assert.match(indexSource, /function refreshAttribution\(\)\{[^}]*calcAttribution\(ay\.value\)/);
  assert.match(indexSource, /renderCashLog\(\);renderActivity\(\);refreshAttribution\(\);/, '拉取应用完必须重算年度归因');
  assert.match(indexSource, /renderHoldings\(\);refreshAttribution\(\)/, '切换币种后归因的格式化也要刷新');
});

/* ===== v443：市值口径 / 每日收益日历 / 敞口精简 / 按压反馈 ===== */
test('v443：每日收益日历要有网格、计算函数和刷新入口', () => {
  assert.match(html, /id="dailyPnlGrid"/);
  assert.match(indexSource, /function computeDailyPnlFromSeries\(/);
  assert.match(indexSource, /function scheduleDailyPnl\(/);
  assert.match(indexSource, /if\(tab==='analysis'\)scheduleDailyPnl\(400\)/, '切到分析页时才加载日历');
  assert.match(indexSource, /refreshAttribution\(\);scheduleDailyPnl\(\);/, '云端拉取后要刷新');
});

test('v443：目标基准要有解释文案', () => {
  assert.match(chartsSource, /eq-benchmark-note/);
  assert.match(chartsSource, /不是收益预测/);
  assert.match(chartsSource, /每年 12 月再平衡/);
});

test('v443：敞口显示前 15 家，且不再重复"前五大底层资产"', () => {
  const watchUi = fs.readFileSync('src/app/watch-ui.js', 'utf8');
  assert.match(watchUi, /toExposureRows\(S\.holdingsData,valueByEtf,15,/);
  const conc = fs.readFileSync('src/app/concentration.js', 'utf8');
  assert.doesNotMatch(conc, /前五大底层资产/);
});

test('v443：全局按压反馈与市值随价滚动', () => {
  assert.match(appMarkup, /\.is-pressed\{transform:scale\(\.97\)/, '按下要有缩放反馈');
  assert.match(indexSource, /function pressFeedback\(\)/);
  const watchUi = fs.readFileSync('src/app/watch-ui.js', 'utf8');
  assert.match(watchUi, /capBasePrice\[key\]/, '市值要按抓取时的基准价滚动');
});
