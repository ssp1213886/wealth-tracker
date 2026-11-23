// 市场状态提示：50/200 日均线、强势/弱势/中性判定、按标的给出的 OTM 建议。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanCloses, simpleMovingAverage, classifyRegime, regimeFromChartPayload,
  adviceForRegime, REGIME_LABELS,
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
  const wrapped = {
    ok: true,
    data: { chart: { result: [{ indicators: { quote: [{ close: closes }] } }] } },
  };
  assert.equal(regimeFromChartPayload(wrapped).regime, 'bull');
  assert.equal(regimeFromChartPayload(null).regime, 'unknown');
});

test('adviceForRegime：强牛市 IBIT 不卖 Call，其余标的给对应 OTM', () => {
  assert.deepEqual(adviceForRegime('VGT', 'bull'), { otm: 10, text: '建议 10% OTM' });
  assert.deepEqual(adviceForRegime('SMH', 'bull'), { otm: 8, text: '建议 8% OTM' });
  assert.deepEqual(adviceForRegime('IBIT', 'bull'), { otm: null, text: '暂不卖 Call' });
  assert.equal(adviceForRegime('IBIT', 'neutral').text, '建议 12%～15% OTM');
  assert.equal(adviceForRegime('IBIT', 'bear').otm, 10);
  assert.equal(adviceForRegime('VGT', 'unknown').otm, null);
});
