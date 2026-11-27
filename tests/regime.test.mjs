// 市场状态提示：50/200 日均线与强势/弱势/中性判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanCloses, simpleMovingAverage, classifyRegime, regimeFromChartPayload,
  seriesFromChartPayload, chartDataGranularity, regimeReason, REGIME_LABELS,
} from '../src/app/regime.js';

function series(before, after, split) {
  const at = split == null ? 150 : split;
  return Array.from({ length: 200 }, (_, i) => (i < at ? before : after));
}

test('cleanCloses / simpleMovingAverage：过滤缺失值，样本不足返回 null', () => {
  assert.deepEqual(cleanCloses([1, null, 2, NaN, 3, 0, -1]), [1, 2, 3]);
  assert.equal(simpleMovingAverage([1, 2, 3, 4], 2), 3.5);
  assert.equal(simpleMovingAverage([1, 2], 3), null);
  assert.equal(simpleMovingAverage(null, 2), null);
});

test('classifyRegime：强势、弱势、中性按 2% 缓冲带判定', () => {
  const bull = classifyRegime(series(100, 120));
  assert.equal(bull.regime, 'bull');
  assert.equal(bull.samples, 200);
  assert.ok(bull.spot > bull.sma200);

  const bear = classifyRegime(series(120, 90));
  assert.equal(bear.regime, 'bear');
  assert.ok(bear.spot < bear.sma200);

  const neutral = classifyRegime(series(100, 102));
  assert.equal(neutral.regime, 'neutral');

  const unknown = classifyRegime(Array.from({ length: 199 }, () => 100));
  assert.equal(unknown.regime, 'unknown');
  assert.equal(REGIME_LABELS[unknown.regime], '数据不足');
});

test('regimeFromChartPayload：兼容 /api/price 的 {ok,data} 包装', () => {
  const closes = series(100, 120);
  const timestamps = closes.map(function (_, i) { return 1000 + i * 86400; });
  const wrapped = {
    ok: true,
    data: { chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }] } },
  };
  const info = regimeFromChartPayload(wrapped);
  assert.equal(info.regime, 'bull');
  assert.equal(info.closes.length, 200);
  assert.equal(info.timestamps.length, 200);
  assert.deepEqual(seriesFromChartPayload(wrapped).timestamps.slice(0, 2), [1000, 1000 + 86400]);
  assert.equal(regimeFromChartPayload(null).regime, 'unknown');
});

test('chartDataGranularity：只读取 Yahoo 元数据，不猜测日线', () => {
  const payload = { data: { chart: { result: [{ meta: { dataGranularity: '1wk' } }] } } };
  assert.equal(chartDataGranularity(payload), '1wk');
  assert.equal(chartDataGranularity({ data: { chart: { result: [{}] } } }), '');
});

test('regimeReason：说明当前状态，尤其解释中性为何不是弱势', () => {
  assert.match(regimeReason({ spot: 120, sma50: 118, sma200: 100 }, 'bull'), /高于 200 日均线 2% 以上/);
  assert.match(regimeReason({ spot: 80, sma50: 90, sma200: 100 }, 'bear'), /低于 200 日均线 2% 以下/);
  assert.match(
    regimeReason({ spot: 97, sma50: 119, sma200: 110 }, 'neutral'),
    /现价已在 200 日均线下方.*50 日均线仍高于 200 日均线.*尚未确认弱势/,
  );
  assert.match(
    regimeReason({ spot: 115, sma50: 105, sma200: 110 }, 'neutral'),
    /现价仍在 200 日均线上方.*50 日均线低于 200 日均线.*尚未确认强势/,
  );
  assert.match(regimeReason({}, 'unknown'), /数据不足/);
});
