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
} from '../src/app/watch.js';

test('默认观察列表覆盖用户指定的 15 个标的', () => {
  const syms = WATCH_DEFAULTS.map((item) => item.sym);
  assert.deepEqual(syms, ['VGT', 'SMH', 'BTC', 'VOO', 'GOLD', 'QQQM', 'NVDA', 'AAPL', 'GOOGL', 'TSLA', 'MSTR', 'CRCL', 'ETH', 'BNB', 'HYPE']);
  assert.equal(kindOf('GOLD'), 'gold');
  assert.equal(kindOf('ETH'), 'crypto');
  assert.equal(kindOf('NVDA'), 'stock');
  assert.equal(labelOf('GOLD'), '金价');
  assert.equal(labelOf('BTC'), 'BTC 现货');
  assert.equal(quoteSymbolOf('GOLD'), 'GOLD');
});

test('normalizeWatchlist：空存储播种默认；有数据时以存储为准（可真正移除）', () => {
  const seeded = normalizeWatchlist([]);
  assert.equal(seeded.length, WATCH_DEFAULTS.length, '空存储时播种 15 个默认标的');
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
