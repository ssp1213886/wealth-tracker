const DEFAULT_SYMBOLS = ['VGT', 'SMH', 'IBIT'];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(value, total) {
  return total > 0 ? value / total * 100 : 0;
}

export function tradeImpact(input) {
  const o = input || {};
  const symbols = (Array.isArray(o.symbols) && o.symbols.length ? o.symbols : DEFAULT_SYMBOLS).map(String);
  const trades = Array.isArray(o.trades) ? o.trades : [];
  const prices = o.prices || {};
  const symbol = String(o.symbol || symbols[0]).toUpperCase();
  const type = o.type === 'sell' ? 'sell' : 'buy';
  const shares = Math.max(0, num(o.shares));
  const price = Math.max(0, num(o.price));
  const cashBefore = num(o.cash);
  const heldBefore = {};
  symbols.forEach(function (sym) { heldBefore[sym] = 0; });
  trades.forEach(function (trade) {
    const sym = String(trade && trade.symbol || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(heldBefore, sym)) heldBefore[sym] += num(trade.shares);
  });
  const heldAfter = Object.assign({}, heldBefore);
  const hasTrade = shares > 0 && price > 0;
  const tradeAmount = hasTrade ? shares * price : 0;
  if (hasTrade) heldAfter[symbol] = (heldAfter[symbol] || 0) + (type === 'buy' ? shares : -shares);
  const cashAfter = cashBefore + (type === 'sell' ? tradeAmount : -tradeAmount);
  const priceOf = function (sym) {
    return num(prices[sym]) || (sym === symbol && price > 0 ? price : 0);
  };
  const missingPrices = symbols.filter(function (sym) {
    return Math.abs(heldBefore[sym]) > 1e-9 && !(priceOf(sym) > 0);
  });
  const beforeValues = {};
  const afterValues = {};
  symbols.forEach(function (sym) {
    beforeValues[sym] = heldBefore[sym] * priceOf(sym);
    afterValues[sym] = heldAfter[sym] * priceOf(sym);
  });
  const holdingsBefore = symbols.reduce(function (sum, sym) { return sum + beforeValues[sym]; }, 0);
  const holdingsAfter = symbols.reduce(function (sum, sym) { return sum + afterValues[sym]; }, 0);
  const rows = symbols.map(function (sym) {
    const beforePct = pct(beforeValues[sym], holdingsBefore);
    const afterPct = pct(afterValues[sym], holdingsAfter);
    return {
      sym: sym,
      beforeValue: beforeValues[sym],
      afterValue: afterValues[sym],
      beforePct: beforePct,
      afterPct: afterPct,
    };
  });
  return {
    type: type,
    symbol: symbol,
    shares: shares,
    price: price,
    hasTrade: hasTrade,
    ready: holdingsBefore > 0 || holdingsAfter > 0 || cashBefore > 0 || hasTrade,
    missingPrices: missingPrices,
    amount: tradeAmount,
    cashBefore: cashBefore,
    cashAfter: cashAfter,
    holdingsBefore: holdingsBefore,
    holdingsAfter: holdingsAfter,
    rows: rows,
    remainingShares: type === 'sell' ? Math.max(0, heldAfter[symbol] || 0) : null,
  };
}
