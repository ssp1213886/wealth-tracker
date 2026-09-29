// 观察列表与前十大构成股的纯逻辑单测
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCH_DEFAULTS,
  toExposureRows,
  normalizeWatchlist,
  toggleWatch,
  addWatch,
  removeWatch,
  moveWatch,
  toWatchRows,
  toHoldingRows,
  collectQuoteSymbols,
  formatChangePct,
  formatPrice,
  kindOf,
  labelOf,
  quoteSymbolOf,
  WATCH_HELD_OF,
  resolveHeldSymbol,
  mergeWatchlist,
  splitByHolding,
} from '../src/app/watch.js';

test('默认观察列表覆盖用户指定的标的（含 BTC ETF 行）', () => {
  const syms = WATCH_DEFAULTS.map((item) => item.sym);
  assert.deepEqual(syms, ['VGT', 'SMH', 'BTC', 'BTCETF', 'VOO', 'GOLD', 'QQQM', 'NVDA', 'AAPL', 'GOOGL', 'TSLA', 'MSTR', 'CRCL', 'ETH', 'BNB', 'HYPE']);
  assert.equal(kindOf('GOLD'), 'gold');
  assert.equal(kindOf('ETH'), 'crypto');
  assert.equal(kindOf('NVDA'), 'stock');
  // BTCETF：用户观察列表里的「BTC ETF」行；行情代码由 worker 的 QUOTE_ALIAS 映射到 Yahoo 的 BTC
  assert.equal(kindOf('BTCETF'), 'stock', 'BTC ETF 不算加密现货');
  assert.equal(labelOf('GOLD'), '金价');
  assert.equal(labelOf('BTC'), 'BTC 现货');
  assert.equal(labelOf('BTCETF'), 'BTC ETF');
  assert.equal(quoteSymbolOf('GOLD'), 'GOLD');
});

test('normalizeWatchlist：空存储播种默认；有数据时以存储为准（可真正移除）', () => {
  const seeded = normalizeWatchlist([]);
  assert.equal(seeded.length, WATCH_DEFAULTS.length, '空存储时播种全部默认标的');
  assert.ok(seeded.every((item) => item.enabled));

  const list = normalizeWatchlist([
    { sym: 'nvda', enabled: false, order: 0 },
    { sym: 'NVDA', enabled: true, order: 1 },
    { sym: 'IWM', enabled: true, order: 2 },
    { sym: 'bad code', enabled: true, order: 3 },
  ]);
  assert.deepEqual(list.map((i) => i.sym), ['NVDA', 'IWM'], '只保留存储里有的（默认项不会自动补回）');
  assert.equal(list[0].enabled, false, '同一代码以第一次出现为准');
  assert.ok(!list.some((item) => item.sym === 'BAD CODE'), '非法代码被过滤');

  const afterRemove = removeWatch(seeded, 'SMH');
  assert.ok(!normalizeWatchlist(afterRemove).some((i) => i.sym === 'SMH'), '移除后不会再被补回来');
});

test('toggle / add / remove / move 的行为', () => {
  let list = normalizeWatchlist([]);
  list = toggleWatch(list, 'vgt');
  assert.equal(list.find((i) => i.sym === 'VGT').enabled, false);
  list = toggleWatch(list, 'VGT');
  assert.equal(list.find((i) => i.sym === 'VGT').enabled, true);

  assert.equal(addWatch(list, 'bad!'), null, '非法代码拒绝');
  const withNew = addWatch(list, 'IWM');
  assert.ok(withNew.some((i) => i.sym === 'IWM'));
  assert.deepEqual(addWatch(withNew, 'IWM'), withNew, '重复添加不产生新项');

  const removed = removeWatch(list, 'SMH');
  assert.ok(!removed.some((i) => i.sym === 'SMH'));

  const moved = moveWatch(list, 'SMH', -1);
  assert.deepEqual(moved.slice(0, 2).map((i) => i.sym), ['SMH', 'VGT']);
  assert.deepEqual(moveWatch(list, 'VGT', -1), normalizeWatchlist(list), '越界移动保持原样');
});

test('toWatchRows：行情缺失也要出这一行，并给出方向与文案', () => {
  const rows = toWatchRows(
    [{ sym: 'VGT', enabled: true, order: 0 }, { sym: 'ETH', enabled: true, order: 1 }, { sym: 'SMH', enabled: false, order: 2 }],
    { VGT: { price: 126.17, changePct: 0.83, source: 'yahoo' }, ETH: { price: 2657.9, changePct: -1.49, source: 'coingecko' } },
  );
  assert.equal(rows.length, 2, '未启用的标的不展示');
  assert.deepEqual(rows.map((r) => r.sym), ['VGT', 'ETH']);
  assert.equal(rows[0].priceText, '$126.17');
  assert.equal(rows[0].changeText, '+0.83%');
  assert.equal(rows[0].dir, 'up');
  assert.equal(rows[1].changeText, '-1.49%');
  assert.equal(rows[1].dir, 'down');

  const missing = toWatchRows([{ sym: 'CRCL', enabled: true, order: 0 }], {});
  assert.equal(missing[0].priceText, '—');
  assert.equal(missing[0].changeText, '—');
  assert.equal(missing[0].dir, 'flat');
});

test('toHoldingRows：按权重倒序、合并行情', () => {
  const rows = toHoldingRows(
    { list: [{ sym: 'AAPL', name: 'Apple Inc', weight: 15.8 }, { sym: 'NVDA', name: 'NVIDIA Corp', weight: 17.74 }] },
    { NVDA: { price: 225.07, changePct: 1.2 }, AAPL: { price: 341.07, changePct: -0.4 } },
  );
  assert.deepEqual(rows.map((r) => r.sym), ['NVDA', 'AAPL']);
  assert.equal(rows[0].weightText, '17.74%');
  assert.equal(rows[0].changeText, '+1.20%');
  assert.equal(rows[1].changeText, '-0.40%');
});

test('collectQuoteSymbols：合并观察列表与两张榜单并去重', () => {
  const list = normalizeWatchlist([{ sym: 'VGT', enabled: true, order: 0 }, { sym: 'SMH', enabled: false, order: 1 }, { sym: 'GOLD', enabled: true, order: 2 }]);
  const holdings = {
    VGT: { list: [{ sym: 'NVDA' }, { sym: 'AAPL' }] },
    SMH: { list: [{ sym: 'NVDA' }, { sym: 'TSM' }] },
  };
  const symbols = collectQuoteSymbols(list, holdings).sort();
  assert.deepEqual(symbols, ['AAPL', 'GOLD', 'NVDA', 'TSM', 'VGT'].sort());
});

test('格式化：涨跌与价格', () => {
  assert.equal(formatChangePct(1.234), '+1.23%');
  assert.equal(formatChangePct(-1.234), '-1.23%');
  assert.equal(formatChangePct(-0.004), '+0.00%', '不显示 -0.00%');
  assert.equal(formatChangePct(0), '+0.00%');
  assert.equal(formatChangePct(null), '—');
  assert.equal(formatPrice(126.17), '$126.17');
  assert.equal(formatPrice(4231.7), '$4,231.70');
  assert.equal(formatPrice(0), '—');
  assert.equal(formatPrice(undefined), '—');
  assert.equal(formatPrice(0.0934), '$0.0934', '小额币价按数量级多给几位');
  assert.equal(formatPrice(0.00000348), '$0.00000348', '极小币价不再显示成 $0.00');
});

test('toExposureRows：同一标的跨两张榜单合并，并按金额排序 + 覆盖度', () => {
  const ex = toExposureRows(
    { VGT: { list: [{ sym: 'NVDA', name: 'NVIDIA', weight: 17.74 }, { sym: 'AAPL', name: 'Apple', weight: 15.8 }] },
      SMH: { list: [{ sym: 'NVDA', name: 'Nvidia', weight: 19.28 }] } },
    { VGT: 10000, SMH: 5000 },
    10,
  );
  assert.equal(ex.rows.length, 2);
  assert.equal(ex.rows[0].sym, 'NVDA');
  assert.equal(Math.round(ex.rows[0].amount), 2738, '10000*17.74% + 5000*19.28%');
  assert.deepEqual(ex.rows[0].parts, ['VGT 17.74%', 'SMH 19.28%']);
  assert.equal(ex.rows[1].sym, 'AAPL');
  assert.equal(ex.covered.VGT, 33.5);
  assert.equal(ex.restCount, 0);
});

test('toExposureRows：单一底层资产（比特币）计入、其余成分股补齐、ETF 自身不出现', () => {
  const ex = toExposureRows(
    { VGT: { list: [{ sym: 'NVDA', name: 'NVIDIA', weight: 17.74 }, { sym: 'AAPL', name: 'Apple', weight: 15.8 }] },
      SMH: { list: [{ sym: 'NVDA', name: 'Nvidia', weight: 19.28 }] } },
    { VGT: 10000, SMH: 5000 },
    10,
    [{ sym: '比特币', amount: 1133, note: 'BTC 100%（直接持有）' }],
  );
  const syms = ex.rows.map((r) => r.sym);
  assert.ok(syms.includes('比特币'), '比特币应计入');
  assert.ok(!syms.includes('VGT') && !syms.includes('SMH'), 'ETF 自身不能作为一行（否则重复计算）');
  assert.equal(ex.rows[0].sym, 'NVDA');
  assert.equal(Math.round(ex.rows.find((r) => r.sym === '比特币').amount), 1133);
  assert.deepEqual(ex.rows.find((r) => r.sym === '比特币').parts, ['BTC 100%（直接持有）']);
  // 数据层自带行类型与来源文案（界面不再显示，供点开详情使用）
  assert.equal(ex.rows.find((r) => r.sym === '比特币').kind, 'direct');
  assert.equal(ex.rows.find((r) => r.sym === 'NVDA').kind, 'pierce');
  assert.equal(ex.rows.find((r) => r.sym === 'NVDA').sourceText, 'VGT 17.74% + SMH 19.28%');
  assert.equal(ex.etfRest[0].kind, 'rest');
  assert.equal(ex.etfRest[0].sourceText, '榜单外 66.5%');
  // 其余成分股：VGT 未覆盖 66.46% × 10000 + SMH 未覆盖 32.46% × 5000
  const vgtRest = ex.etfRest.find((r) => r.label === 'VGT 其余成分股');
  assert.equal(Math.round(vgtRest.amount), 6646);
  assert.equal(vgtRest.missPct, 66.5);
  // 其余成分股必须也有"占持仓比例"（曾漏掉，只显示榜单外比例）
  assert.equal(vgtRest.share, 41.2, '6646 / 16133 ≈ 41.2%');
  // 分母 = 持仓市值合计（含 BTC）
  assert.equal(ex.base, 16133);
  // 各行 + 其余成分股 ≈ 分母（允许四舍五入误差）
  const sum = ex.rows.reduce((s, r) => s + r.amount, 0) + ex.etfRest.reduce((s, r) => s + r.amount, 0);
  assert.ok(Math.abs(sum - ex.base) < 2, '合计应等于分母，实际差 ' + (sum - ex.base));
  // 占比合计 = 100%（四舍五入误差 ±0.3）
  const shareSum = ex.rows.reduce((s, r) => s + (r.share || 0), 0) + ex.etfRest.reduce((s, r) => s + (r.share || 0), 0);
  assert.ok(Math.abs(shareSum - 100) < 0.3, '占比合计应为 100%，实际 ' + shareSum);
});

test('resolveHeldSymbol：BTCETF 归到 BTC，BTC 现货不算持仓，其它按自身', () => {
  assert.deepEqual(WATCH_HELD_OF, { BTCETF: 'BTC', BTC: '' });
  assert.equal(resolveHeldSymbol('BTCETF'), 'BTC');
  assert.equal(resolveHeldSymbol('btcetf'), 'BTC', '大小写不敏感');
  assert.equal(resolveHeldSymbol('BTC'), '', '现货 BTC 不参与持仓');
  assert.equal(resolveHeldSymbol('NVDA'), 'NVDA');
  assert.equal(resolveHeldSymbol(''), '');
  assert.equal(resolveHeldSymbol('VGT', { VGT: 'QQQ' }), 'QQQ', '可传入自定义映射');
});

test('mergeWatchlist：并集、云端在前、按代码去重、不丢本地独有', () => {
  const local = [{ sym: 'VGT', enabled: true, order: 0 }, { sym: 'IWM', enabled: true, order: 1 }];
  const cloud = [{ sym: 'vgt', enabled: false, order: 5 }, { sym: 'SMH', enabled: true, order: 6 }];
  const merged = mergeWatchlist(local, cloud);
  const syms = merged.map((x) => x.sym);
  assert.deepEqual(syms.slice().sort(), ['IWM', 'SMH', 'VGT'], '三方都在，一个不丢');
  // 顺序按 order 字段（normalizeWatchlist 的既有语义）：IWM(1) → VGT(5) → SMH(6)
  assert.deepEqual(syms, ['IWM', 'VGT', 'SMH']);
  assert.equal(merged.filter((x) => x.sym === 'VGT')[0].enabled, false, '重复项以云端那份为准');
});

test('mergeWatchlist：容忍脏数据（null / 缺 sym / 非数组）', () => {
  // 两边都没有 → 与 normalizeWatchlist([]) 一样会播种默认列表（这是既有语义，不是 bug）
  assert.deepEqual(mergeWatchlist(null, null).map((x) => x.sym), normalizeWatchlist([]).map((x) => x.sym));
  const merged = mergeWatchlist([{ sym: 'VGT' }, null, {}, { sym: '' }], [{ bad: 1 }]);
  assert.deepEqual(merged.map((x) => x.sym), ['VGT']);
  assert.equal(mergeWatchlist([{ sym: 'vgt' }], 'not-an-array').length, 1);
});

test('splitByHolding：有持仓市值的进持仓组并合计，其余进关注组，顺序不变', () => {
  const items = [{ sym: 'VGT' }, { sym: 'BTC' }, { sym: 'SMH' }, { sym: 'IWM' }];
  const valueOf = (it) => ({ VGT: 1000, SMH: 0, BTC: 0, IWM: 500 }[it.sym] || 0);
  const groups = splitByHolding(items, valueOf);
  assert.deepEqual(groups.held.map((x) => x.sym), ['VGT', 'IWM']);
  assert.deepEqual(groups.watch.map((x) => x.sym), ['BTC', 'SMH']);
  assert.equal(groups.total, 1500);
});

test('splitByHolding：现价拿不到（0）时落到关注组，脏数据不炸', () => {
  const g1 = splitByHolding([{ sym: 'VGT' }], () => 0);
  assert.equal(g1.held.length, 0);
  assert.equal(g1.watch.length, 1);
  assert.equal(g1.total, 0);
  const g2 = splitByHolding(null, () => 1);
  assert.deepEqual(g2, { held: [], watch: [], total: 0 });
  const g3 = splitByHolding([{ sym: 'A' }, { sym: 'B' }], (it) => (it.sym === 'A' ? 'abc' : -5));
  assert.equal(g3.held.length, 0, '非法/负值都算关注');
  assert.equal(g3.watch.length, 2);
});

test('splitByHolding：可按"持有股数"判定持仓，市值只用于合计（v237 回归的护栏）', () => {
  // 有持仓但拿不到现价 → 市值 0，也必须留在"持仓"组（线上就是这么用的）
  const items = [{ sym: 'VGT' }, { sym: 'BTCETF' }, { sym: 'IWM' }];
  const shares = { VGT: 8.62, BTCETF: 13.62, IWM: 0 };
  const price = { VGT: 0, BTCETF: 0, IWM: 100 };   // 前两只没行情
  const groups = splitByHolding(
    items,
    (it) => shares[it.sym] * (price[it.sym] || 0),
    (it) => shares[it.sym] > 0,
  );
  assert.deepEqual(groups.held.map((x) => x.sym), ['VGT', 'BTCETF'], '没行情的持仓仍属持仓组');
  assert.deepEqual(groups.watch.map((x) => x.sym), ['IWM']);
  assert.equal(groups.total, 0, '合计按市值算，无行情就是 0');
});
