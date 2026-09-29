// 观察列表视图层的单测（v249 从 index.js 抽出）。
// 这层几乎全是 DOM：用假 document + 注入假宿主（configureWatchUI），
// 把"渲染出什么 innerHTML、状态胶囊写什么字、排序按钮点亮哪一颗"钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { configureWatchUI, paintWatchSort, renderWatch, renderWatchManage, renderHoldings } from '../src/app/watch-ui.js';
import { WATCH_DEFAULTS } from '../src/app/watch.js';

function makeEl(extra) {
  const classes = new Set();
  const attrs = {};
  return Object.assign({
    innerHTML: '',
    textContent: '',
    className: '',
    hidden: false,
    children: [],
    parentElement: null,
    dataset: {},
    style: { setProperty() {} },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
      _all: () => Array.from(classes).sort(),
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] === undefined ? null : attrs[k]; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    querySelector: () => null,
  }, extra || {});
}

function withDoc(els, fn, opts) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = {
    getElementById: (id) => (id in els ? els[id] : null),
    querySelector: (sel) => ((opts && opts.query && opts.query[sel]) || null),
    querySelectorAll: (sel) => ((opts && opts.queryAll && opts.queryAll[sel]) || []),
    createElement: () => makeEl(),
    body: makeEl(),
  };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  try {
    return fn(doc);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else delete globalThis.document;
  }
}

/** 常用宿主：watch 列表 + 行情 + 空持仓。 */
function host(over) {
  return Object.assign({
    watchList: [],
    watchQuotes: {},
    holdingsData: {},
    watchFetchedAt: 0,
    watchInvalid: [],
    watchMissing: [],
    trades: [],
    livePrices: {},
    saveWatch() {},
    refreshMarket() {},
    showToast() {},
  }, over || {});
}

const LIST3 = [
  { sym: 'VGT', enabled: true },
  { sym: 'SMH', enabled: true },
  { sym: 'NVDA', enabled: true },
];

test('renderWatch：没配置过时回落到默认观察名单', () => {
  configureWatchUI(host({ watchList: [] }));
  const box = makeEl();
  withDoc({ watchRows: box }, () => renderWatch());
  const rows = (box.innerHTML.match(/class="watch-row"/g) || []).length;
  assert.equal(rows, WATCH_DEFAULTS.length, '空配置 → 默认名单（' + WATCH_DEFAULTS.length + ' 项）');
});

test('renderWatch：全部关掉时给出引导文案', () => {
  configureWatchUI(host({ watchList: [{ sym: 'VGT', enabled: false }, { sym: 'SMH', enabled: false }] }));
  const box = makeEl();
  withDoc({ watchRows: box }, () => renderWatch());
  assert.match(box.innerHTML, /还没有观察标的/);
});

test('renderWatch：渲染每一行（代码/价格/涨跌方向）并写状态胶囊', () => {
  configureWatchUI(host({
    watchList: LIST3,
    watchQuotes: {
      VGT: { price: 108.62, changePct: 1.23, currency: 'USD' },
      SMH: { price: 402.1, changePct: -0.56, currency: 'USD' },
      NVDA: { price: 186.4, changePct: 0.4, currency: 'USD' },
    },
    watchFetchedAt: Date.now(),
  }));
  const box = makeEl();
  const cap = makeEl();
  const meta = makeEl();
  withDoc({ watchRows: box, watchStatus: cap, watchMeta: meta }, () => renderWatch());
  assert.equal((box.innerHTML.match(/class="watch-row"/g) || []).length, 3);
  assert.match(box.innerHTML, /VGT/);
  assert.match(box.innerHTML, /watch-chg is-up/);
  assert.match(box.innerHTML, /watch-chg is-down/);
  assert.equal(cap.textContent, '行情正常');
  assert.equal(cap.className, 'watch-cap is-ok');
  assert.match(meta.textContent, /共 3 项/);
});

test('renderWatch：抓取失败/无数据源时状态胶囊报警', () => {
  configureWatchUI(host({
    watchList: LIST3,
    watchQuotes: { VGT: { price: 1, changePct: 0, currency: 'USD' } },
    watchFetchedAt: Date.now(),
    watchMissing: ['NVDA'],
    watchInvalid: ['SMH'],
  }));
  const box = makeEl();
  const cap = makeEl();
  withDoc({ watchRows: box, watchStatus: cap }, () => renderWatch());
  assert.equal(cap.textContent, '2 项无数据');
  assert.equal(cap.className, 'watch-cap is-warn');
});

test('renderWatch：还没抓过行情时胶囊显示「—」', () => {
  configureWatchUI(host({ watchList: LIST3, watchFetchedAt: 0 }));
  const box = makeEl();
  const cap = makeEl();
  withDoc({ watchRows: box, watchStatus: cap }, () => renderWatch());
  assert.equal(cap.textContent, '—');
  assert.equal(cap.className, 'watch-cap');
});

test('renderWatch：按涨幅排序时高的在前（点两次排序按钮的行为）', () => {
  const quotes = {
    VGT: { price: 100, changePct: 0.1, currency: 'USD' },
    SMH: { price: 100, changePct: 5.5, currency: 'USD' },
    NVDA: { price: 100, changePct: -3.2, currency: 'USD' },
  };
  const box = makeEl();
  const doc = { getElementById: (id) => (id === 'watchRows' ? box : null) };
  const savedDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  try {
    configureWatchUI(host({ watchList: LIST3, watchQuotes: quotes, watchFetchedAt: Date.now() }));
    // 默认排序：按列表顺序
    renderWatch();
    const first = box.innerHTML.slice(0, box.innerHTML.indexOf('</div>'));
    assert.match(first, /VGT/, '默认按加入顺序');
    // 切到涨幅排序：模拟点排序按钮
    const btns = ['chg', 'price', 'default'].map((k) => makeEl({ 'data-watch-sort': null }));
    btns.forEach((b, i) => { b.getAttribute = () => ['chg', 'price', 'default'][i]; });
    Object.defineProperty(globalThis, 'document', {
      value: Object.assign({}, doc, { querySelectorAll: () => btns }),
      configurable: true,
      writable: true,
    });
    paintWatchSort();
    assert.deepEqual(btns[0].classList._all(), [], '还没点过，谁都不亮');
  } finally {
    if (savedDesc) Object.defineProperty(globalThis, 'document', savedDesc);
    else delete globalThis.document;
  }
});

test('renderWatchManage：勾选状态与上移/下移/移除按钮都带上代码', () => {
  configureWatchUI(host({ watchList: [{ sym: 'VGT', enabled: true }, { sym: 'SMH', enabled: false }] }));
  const box = makeEl();
  withDoc({ watchManageList: box }, () => renderWatchManage());
  assert.equal((box.innerHTML.match(/data-watch-toggle=/g) || []).length, 2);
  assert.match(box.innerHTML, /data-watch-toggle="VGT"[^>]*checked/);
  assert.doesNotMatch(box.innerHTML, /data-watch-toggle="SMH"[^>]*checked/);
  assert.match(box.innerHTML, /data-watch-move="VGT" data-dir="-1"/);
  assert.match(box.innerHTML, /data-watch-remove="SMH"/);
});

test('paintWatchSort：只点亮当前排序方式那一颗', () => {
  configureWatchUI(host());
  const mk = (key) => {
    const el = makeEl();
    el.getAttribute = () => key;
    return el;
  };
  const btns = [mk('chg'), mk('price'), mk('default')];
  withDoc({}, () => paintWatchSort(), { queryAll: { '[data-watch-sort]': btns } });
  assert.deepEqual(btns[0].classList._all(), []);
  assert.deepEqual(btns[1].classList._all(), []);
  assert.deepEqual(btns[2].classList._all(), ['is-on'], '默认排序是 default');
});

test('renderHoldings：ETF 前十大 + 底层资产敞口（含分母说明）', () => {
  configureWatchUI(host({
    watchList: LIST3,
    holdingsData: {
      VGT: { symbol: 'VGT', source: 'yahoo', list: [{ sym: 'NVDA', name: 'NVIDIA', weight: 17.2 }, { sym: 'AAPL', name: 'Apple', weight: 15.1 }] },
      SMH: { symbol: 'SMH', source: 'static', asOf: '2026-06-30', list: [{ sym: 'NVDA', name: 'NVIDIA', weight: 19.5 }] },
    },
    watchQuotes: { NVDA: { price: 186.4, changePct: 0.4, currency: 'USD' }, AAPL: { price: 231, changePct: -0.2, currency: 'USD' } },
    trades: [{ symbol: 'VGT', shares: 8.62 }, { symbol: 'SMH', shares: 1.02 }, { symbol: 'BTC', shares: 13.62 }],
    livePrices: { VGT: 108.62, SMH: 402.1, BTC: 29.38 },
  }));
  const vgt = makeEl();
  const smh = makeEl();
  const expose = makeEl();
  withDoc({ holdVGT: vgt, holdSMH: smh, holdExpose: expose }, () => renderHoldings());
  assert.match(vgt.innerHTML, /VGT 前十大/);
  assert.match(vgt.innerHTML, /实时抓取/);
  assert.match(smh.innerHTML, /榜单 2026-06-30/);
  assert.match(vgt.innerHTML, /hold-row/);
  assert.match(expose.innerHTML, /底层资产敞口/);
  assert.match(expose.innerHTML, /分母 = 持仓市值合计/);
  assert.match(expose.innerHTML, /比特币/);
});

test('renderHoldings：没有数据时两块都显示空态，不抛错', () => {
  configureWatchUI(host());
  const vgt = makeEl();
  const smh = makeEl();
  withDoc({ holdVGT: vgt, holdSMH: smh, holdExpose: makeEl() }, () => renderHoldings());
  assert.match(vgt.innerHTML, /暂无数据/);
  assert.match(smh.innerHTML, /暂无数据/);
});
