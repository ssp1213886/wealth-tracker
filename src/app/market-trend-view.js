import { escapeHtml } from './render.js';
import { REGIME_LABELS, regimeReason } from './regime.js';

function fmtPrice(value) {
  const n = Number(value);
  return n > 0 ? '$' + n.toFixed(2) : '—';
}

/** 市场状态条：只描述趋势，不再给期权或 OTM 建议。 */
export function marketRegimeHtml(info, symbol, opts) {
  const c = opts || {};
  const d = info || {};
  const regime = REGIME_LABELS[d.regime] ? d.regime : 'unknown';
  const label = REGIME_LABELS[regime];
  const trendText = regime === 'bull' ? '趋势偏强' : regime === 'bear' ? '趋势偏弱' : regime === 'neutral' ? '趋势中性' : '等待更多数据';
  let detail = '';
  if (!info && c.loading) {
    detail = '读取历史日线，计算 50 日和 200 日均线…';
  } else if (!info && c.error) {
    detail = '行情暂不可用，稍后自动重试';
  } else if (regime === 'unknown') {
    detail = '日线不足 200 个交易日，暂不判断长期趋势';
  } else {
    detail = '现价 ' + fmtPrice(d.spot) +
      ' · 50 日均线 ' + fmtPrice(d.sma50) +
      ' · 200 日均线 ' + fmtPrice(d.sma200);
  }
  const reason = info ? '<div class="regime-reason">' + escapeHtml(regimeReason(d, regime)) + '</div>' : '';
  const rules = '<details class="regime-rules">' +
    '<summary>判断规则</summary>' +
    '<div class="regime-rules-body">' +
      '<div><b>强势</b>：现价高于 200 日均线 2% 以上，且 50 日均线高于 200 日均线。</div>' +
      '<div><b>弱势</b>：现价低于 200 日均线 2% 以下，且 50 日均线低于 200 日均线。</div>' +
      '<div><b>中性</b>：其余情况，常见于趋势转换或震荡阶段。</div>' +
    '</div></details>';
  const title = '市场状态按 50 日和 200 日均线判断，数据取日线收盘；仅描述趋势，不构成交易建议。';
  return '<div class="regime-main" title="' + escapeHtml(title) + '">' +
    '<span class="regime-kicker">' + escapeHtml(String(symbol || '').toUpperCase()) + ' 市场状态</span>' +
    '<span class="regime-badge is-' + regime + '">' + escapeHtml(label) + '</span>' +
    '<strong class="regime-advice">' + escapeHtml(trendText) + '</strong>' +
    '</div><div class="regime-detail">' + escapeHtml(detail) + '</div>' + reason + rules;
}

export function renderMarketRegime(doc, symbol, info, opts) {
  const el = doc.getElementById('marketRegime');
  if (el) el.innerHTML = marketRegimeHtml(info, symbol, opts);
}
