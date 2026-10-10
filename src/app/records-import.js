// 记录/交易域的纯逻辑：本地数据的规整（导入/云端/备份都走这里）+ Schwab CSV 解析。
// 不碰 DOM、不写存储；CSV 解析只返回待插入的行，id 与写入由调用方处理，因此可以离线单测。
import { cleanText } from './util.js';
import { normalizeDateValue } from './time.js';

/** 允许的交易标的（核心仓三只）。index.js 的 ETF_SYMS 也引用这里，避免两处维护。 */
export const TRADE_SYMBOLS = ['VGT', 'SMH', 'IBIT'];

/**
 * 规整交易记录：标的必须在允许名单内、日期合法、股数非 0、价格 > 0，否则整条丢弃。
 * id 缺失或重复时补一个；方向由股数正负决定（tag='assign' 表示被行权自动生成的那笔）。
 */
export function normalizeTrades(list, symbols) {
  const allowed = (Array.isArray(symbols) && symbols.length) ? symbols : TRADE_SYMBOLS;
  if (!Array.isArray(list)) return [];
  const used = {};
  return list.map(function (t, i) {
    const sym = cleanText(t && t.symbol, 12).toUpperCase();
    const date = normalizeDateValue(t && t.date);
    const shares = Number(t && t.shares);
    const price = Number(t && t.price);
    if (!allowed.includes(sym) || !date || !isFinite(shares) || shares === 0 || !isFinite(price) || price <= 0) return null;
    let id = Number(t.id);
    if (!isFinite(id) || used[id]) id = Date.now() + i + Math.random();
    used[id] = 1;
    return { id: id, symbol: sym, date: date, time: cleanText(t.time, 12), shares: shares, price: price, type: shares < 0 ? 'sell' : 'buy', tag: t.tag === 'assign' ? 'assign' : '' };
  }).filter(Boolean);
}

/** 规整资金流水：日期与类型必填、金额必须是有限数。 */
export function normalizeCashLogs(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (l, i) {
    const date = normalizeDateValue(l && l.date);
    const amount = Number(l && l.amount);
    const type = cleanText(l && l.type, 40);
    if (!date || !type || !isFinite(amount)) return null;
    return { id: Number(l.id) || Date.now() + i + Math.random(), date: date, time: cleanText(l.time, 12), type: type, amount: amount };
  }).filter(Boolean);
}

/** 规整操作日志：只保留最近 200 条（与写入时的上限一致）。 */
export function normalizeActivities(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-200).map(function (a, i) {
    const date = normalizeDateValue(a && a.date);
    if (!date) return null;
    return {
      id: Number(a.id) || Date.now() + i + Math.random(),
      date: date,
      time: cleanText(a.time, 12),
      action: cleanText(a.action, 120),
      detail: cleanText(a.detail, 240),
    };
  }).filter(Boolean);
}

/** 解析一行 CSV（支持引号包裹、字段内逗号、双引号转义）。 */
export function parseCSVRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 金额文本 → 数字：去掉 $ 与千分位逗号，无法解析按 0。 */
export function parseMoneyValue(v) {
  return Number(cleanText(v, 40).replace(/[$,]/g, '').replace(/"/g, '')) || 0;
}

/**
 * 解析 Schwab 风格 CSV：自动找表头（英文或中文列名），逐行抽成交易。
 * 返回 { rows, imported }；rows 里**不含 id**，由调用方分配并写入（保持原实现的插入顺序）。
 * 与已有交易按「日期|代码|股数|价格」去重；找不到必需表头时抛错（调用方提示用户）。
 */
export function parseSchwabCSV(text, opts) {
  const o = opts || {};
  const symbols = (Array.isArray(o.symbols) && o.symbols.length) ? o.symbols : TRADE_SYMBOLS;
  const existing = Array.isArray(o.existingTrades) ? o.existingTrades : [];
  const now = o.now instanceof Date ? o.now : new Date();
  const lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  const seen = {};
  existing.forEach(function (t) {
    seen[[t.date, t.symbol, t.shares, t.price].join('|')] = true;
  });
  const rows = [];
  // 被跳过的行要能说清楚原因：以前全是 `continue`，用户只看到"已导入 N 笔"，
  // 不知道有几行没进来、为什么（v318 补：交给调用方给行级反馈）
  const skipped = { badDate: 0, symbol: 0, qty: 0, price: 0, dup: 0 };
  let colMap = {};
  let headerFound = false;
  for (let i = 0; i < lines.length; i += 1) {
    const row = parseCSVRow(lines[i]);
    if (!headerFound) {
      colMap = { date: -1, sym: -1, qty: -1, price: -1, action: -1 };
      for (let ci = 0; ci < row.length; ci += 1) {
        const h = row[ci].toLowerCase();
        if (h.indexOf('date') >= 0 || h === '日期') colMap.date = ci;
        if (h.indexOf('symbol') >= 0 || h.indexOf('ticker') >= 0 || h === '代码' || h === '标的') colMap.sym = ci;
        if (h.indexOf('action') >= 0 || h.indexOf('description') >= 0 || h === '方向') colMap.action = ci;
        if (h.indexOf('quantity') >= 0 || h.indexOf('shares') >= 0 || h.indexOf('数量') >= 0 || h.indexOf('qty') >= 0) colMap.qty = ci;
        if (h.indexOf('price') >= 0 || h === '价格' || h === '成交价') colMap.price = ci;
      }
      if (colMap.date >= 0 && colMap.sym >= 0 && colMap.qty >= 0 && colMap.price >= 0) headerFound = true;
      continue;
    }
    const date = normalizeDateValue(row[colMap.date]);
    const sym = cleanText(row[colMap.sym], 12).toUpperCase();
    const qty = Math.abs(parseMoneyValue(row[colMap.qty]));
    const price = parseMoneyValue(row[colMap.price]);
    const action = colMap.action >= 0 ? cleanText(row[colMap.action], 80).toLowerCase() : '';
    if (!date) { skipped.badDate += 1; continue; }
    if (!symbols.includes(sym)) { skipped.symbol += 1; continue; }
    if (qty <= 0) { skipped.qty += 1; continue; }
    if (price <= 0) { skipped.price += 1; continue; }
    const isSell = action.indexOf('sell') >= 0 || action.indexOf('sold') >= 0 || action.indexOf('卖') >= 0;
    const shares = isSell ? -qty : qty;
    const fingerprint = [date, sym, shares, price].join('|');
    if (seen[fingerprint]) { skipped.dup += 1; continue; }
    seen[fingerprint] = true;
    rows.push({
      symbol: sym,
      date: date,
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      shares: shares,
      price: price,
      type: isSell ? 'sell' : 'buy',
    });
  }
  if (!headerFound) throw new Error('未找到 Date、Symbol、Quantity、Price 列');
  return { rows: rows, imported: rows.length, skipped: skipped };
}

/**
 * 把上面那份"被跳过"的统计翻成一句人话（没有跳过时返回空串）。
 * 纯文本、不碰 DOM，所以直接单测。
 */
export function csvSkipSummary(skipped) {
  const s = skipped || {};
  const label = { badDate: '日期无法识别', symbol: '标的不在核心仓', qty: '股数无效', price: '价格无效', dup: '与已有记录重复' };
  const parts = [];
  let total = 0;
  Object.keys(label).forEach(function (k) {
    const n = Number(s[k]) || 0;
    if (n > 0) { parts.push(label[k] + ' ' + n); total += n; }
  });
  if (!parts.length) return '';
  return '跳过 ' + total + ' 行：' + parts.join('、');
}
