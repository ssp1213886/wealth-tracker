// 市场状态提示的纯计算：用 1 年日线计算 50/200 日均线，并给出卖 CALL 的 OTM 建议。
// 这里只产生"建议"，绝不写 otmSettings、交易或期权记录。

export const REGIME_LABELS = {
  bull: '强势',
  neutral: '中性',
  bear: '弱势',
  unknown: '数据不足',
};

const OTM_ADVICE = {
  bull: {
    VGT: { otm: 10, text: '建议 10% OTM' },
    SMH: { otm: 8, text: '建议 8% OTM' },
    IBIT: { otm: null, text: '暂不卖 Call' },
  },
  neutral: {
    VGT: { otm: 7, text: '建议 7% OTM' },
    SMH: { otm: 6, text: '建议 6% OTM' },
    IBIT: { otm: 12, text: '建议 12%～15% OTM' },
  },
  bear: {
    VGT: { otm: 7, text: '建议 7% OTM' },
    SMH: { otm: 6, text: '建议 6% OTM' },
    IBIT: { otm: 10, text: '建议 10% OTM；权利金合适再卖' },
  },
};

/** 清掉空值/非有限值；不能用 0 占位，否则会把均线算歪。 */
export function cleanCloses(values) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(function (value) { return Number.isFinite(value) && value > 0; });
}

/** 简单移动平均；样本不足返回 null。 */
export function simpleMovingAverage(values, period) {
  const list = cleanCloses(values);
  const n = Math.floor(Number(period));
  if (!(n > 0) || list.length < n) return null;
  let sum = 0;
  for (let i = list.length - n; i < list.length; i += 1) sum += list[i];
  return sum / n;
}

/**
 * 强势：现价高于 200 日均线 2% 以上，且 50 日均线高于 200 日均线。
 * 弱势：现价低于 200 日均线 2% 以下，且 50 日均线低于 200 日均线。
 * 其余（含均线附近反复穿越）都归中性，避免每天翻转。
 */
export function classifyRegime(values, opts) {
  const list = cleanCloses(values);
  const bufferPct = Number(opts && opts.bufferPct);
  const buffer = Number.isFinite(bufferPct) && bufferPct >= 0 ? bufferPct : 0.02;
  const sma50 = simpleMovingAverage(list, 50);
  const sma200 = simpleMovingAverage(list, 200);
  const spot = list.length ? list[list.length - 1] : null;
  if (!(spot > 0) || !(sma50 > 0) || !(sma200 > 0)) {
    return { regime: 'unknown', spot: spot, sma50: sma50, sma200: sma200, samples: list.length };
  }
  let regime = 'neutral';
  if (spot > sma200 * (1 + buffer) && sma50 > sma200) regime = 'bull';
  else if (spot < sma200 * (1 - buffer) && sma50 < sma200) regime = 'bear';
  return { regime: regime, spot: spot, sma50: sma50, sma200: sma200, samples: list.length };
}

/** 从 `/api/price` 返回体（{ok,data} 或原始 Yahoo chart）提取收盘序列。 */
export function regimeFromChartPayload(payload) {
  const root = payload && payload.data ? payload.data : payload;
  const result = root && root.chart && root.chart.result && root.chart.result[0];
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  return classifyRegime(quote && quote.close);
}

/** 每只标的在不同状态下的建议（null 表示这轮不卖）。 */
export function adviceForRegime(symbol, regime) {
  const sym = String(symbol || '').toUpperCase();
  const key = OTM_ADVICE[regime] ? regime : 'unknown';
  if (key === 'unknown') return { otm: null, text: '使用当前 OTM 设置' };
  const row = OTM_ADVICE[key][sym];
  return row ? { otm: row.otm, text: row.text } : { otm: null, text: '使用当前 OTM 设置' };
}
