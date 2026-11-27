import { marketDate } from './time.js';

function validRows(timestamps, closes) {
  const times = Array.isArray(timestamps) ? timestamps : [];
  const prices = Array.isArray(closes) ? closes : [];
  const out = [];
  times.forEach(function (value, index) {
    const ts = Number(value);
    const price = Number(prices[index]);
    const date = ts > 0 ? marketDate(new Date(ts * 1000)) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && price > 0) out.push({ date: date, price: price });
  });
  return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
}

/** 只允许目标年份内的行情；整年缺失时返回 null。 */
export function firstCloseInYear(timestamps, closes, year) {
  const target = String(year || '');
  if (!/^\d{4}$/.test(target)) return null;
  const row = validRows(timestamps, closes).find(function (item) { return item.date.slice(0, 4) === target; });
  return row ? row.price : null;
}

/** 只允许目标年份内的行情；整年缺失时返回 null。 */
export function lastCloseInYear(timestamps, closes, year) {
  const target = String(year || '');
  if (!/^\d{4}$/.test(target)) return null;
  const rows = validRows(timestamps, closes);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].date.slice(0, 4) === target) return rows[i].price;
  }
  return null;
}
