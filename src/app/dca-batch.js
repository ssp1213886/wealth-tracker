import { CORE_SYMBOLS } from './portfolio-config.js';
import { normalizeDateValue } from './time.js';

function hasValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

/**
 * 规整一次“券商成交后”的批量定投记录。
 *
 * 这里不计算建议股数，也不替用户生成成交：
 *   - 明确填写股数或价格的空行跳过；
 *   - 只填了股数/价格其中一项，该行报错；
 *   - 至少要有 1 笔有效成交；
 *   - 返回的是待写入的普通交易，不引入新的持久化结构。
 */
export function parseDcaBatch(input) {
  const source = input || {};
  const date = normalizeDateValue(source.date);
  const inputRows = Array.isArray(source.rows) ? source.rows : [];
  const rows = [];
  const errors = [];

  if (!date) {
    errors.push({ symbol: '', field: 'date', message: '请选择有效的成交日期' });
  }

  CORE_SYMBOLS.forEach(function (symbol) {
    const raw = inputRows.find(function (row) {
      return String(row && row.symbol || '').toUpperCase() === symbol;
    }) || {};
    const sharesRaw = raw.shares;
    const priceRaw = raw.price;
    const hasShares = hasValue(sharesRaw) && String(sharesRaw).trim() !== '';
    const hasPrice = hasValue(priceRaw) && String(priceRaw).trim() !== '';

    if (!hasShares && !hasPrice) return;
    if (!hasShares || !hasPrice) {
      errors.push({
        symbol: symbol,
        field: !hasShares ? 'shares' : 'price',
        message: symbol + ' 请同时填写股数和成交价',
      });
      return;
    }

    const shares = Number(sharesRaw);
    const price = Number(priceRaw);
    if (!Number.isFinite(shares) || shares <= 0) {
      errors.push({ symbol: symbol, field: 'shares', message: symbol + ' 股数必须大于 0' });
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      errors.push({ symbol: symbol, field: 'price', message: symbol + ' 成交价必须大于 0' });
      return;
    }

    rows.push({
      symbol: symbol,
      shares: shares,
      price: price,
      amount: Number((shares * price).toFixed(6)),
    });
  });

  if (!errors.length && !rows.length) {
    errors.push({ symbol: '', field: 'rows', message: '请至少填写一笔实际成交' });
  }

  const total = Number(rows.reduce(function (sum, row) {
    return sum + row.amount;
  }, 0).toFixed(6));

  return {
    ok: errors.length === 0,
    empty: rows.length === 0 && !inputRows.some(function (row) {
      return hasValue(row && row.shares) || hasValue(row && row.price);
    }),
    date: date,
    rows: rows,
    total: total,
    errors: errors,
  };
}
