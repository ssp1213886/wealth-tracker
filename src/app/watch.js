// 观察列表 + ETF 前十大构成股的纯逻辑（不碰 DOM，便于单测）。
// 行情由 Worker 的 /api/quotes 与 /api/holdings 提供，这里只做数据整形。

// 用户指定的观察标的：GOLD = 金价（后端映射成 COMEX 黄金期货 GC=F），BTC/ETH/BNB/HYPE = 现货
export const WATCH_DEFAULTS = [
  { sym: 'VGT', kind: 'stock' },
  { sym: 'SMH', kind: 'stock' },
  { sym: 'BTC', kind: 'crypto' },
  { sym: 'IBIT', kind: 'stock' },
  { sym: 'VOO', kind: 'stock' },
  { sym: 'GOLD', kind: 'gold' },
  { sym: 'QQQM', kind: 'stock' },
  { sym: 'NVDA', kind: 'stock' },
  { sym: 'AAPL', kind: 'stock' },
  { sym: 'GOOGL', kind: 'stock' },
  { sym: 'TSLA', kind: 'stock' },
  { sym: 'MSTR', kind: 'stock' },
  { sym: 'CRCL', kind: 'stock' },
  { sym: 'ETH', kind: 'crypto' },
  { sym: 'BNB', kind: 'crypto' },
  { sym: 'HYPE', kind: 'crypto' },
];

// 与 worker 的 CRYPTO_PAIRS 对齐（纯代码即可当币；重名的 SUI/STX/DASH 不在内）
const CRYPTO_SET = new Set(['BTC', 'ETH', 'BNB', 'HYPE', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'LTC', 'DOT', 'TRX', 'XLM', 'TON', 'BCH', 'ETC', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'FIL', 'HBAR', 'ICP', 'ALGO', 'VET', 'AAVE', 'INJ', 'SEI', 'TIA', 'TAO', 'KAS', 'GRT', 'SAND', 'MANA', 'CRV', 'MKR', 'LDO', 'ENS', 'WLD', 'ENA', 'ONDO', 'JUP', 'BONK', 'WIF', 'PYTH', 'POL', 'RUNE', 'SHIB', 'PEPE', 'CRO', 'ZEC', 'XMR', 'EOS', 'FLOW', 'CHZ', 'GALA', 'IMX', 'AXS', 'THETA', 'RENDER']);
const KIND_LABEL = { crypto: '现货', gold: '金价', stock: '' };
// 允许数字开头（如加密的 1INCH / 1INCH-USD）
const SYM_RE = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;

export function kindOf(sym) {
  const upper = String(sym || '').toUpperCase();
  if (upper === 'GOLD') return 'gold';
  if (CRYPTO_SET.has(upper)) return 'crypto';
  return 'stock';
}

export function labelOf(sym) {
  const upper = String(sym || '').toUpperCase();
  const kind = kindOf(upper);
  if (kind === 'gold') return '金价';
  if (upper === 'BTC') return 'BTC 现货';
  if (upper === 'BTCETF') return 'IBIT';
  return upper;
}

export function quoteSymbolOf(sym) {
  return kindOf(sym) === 'gold' ? 'GOLD' : String(sym || '').toUpperCase();
}

// 把存储里的原始数据整形成稳定的列表。
// 语义：**存储里什么都没有时才播种默认列表**；一旦有数据就以存储为准
// （否则用户"移除"掉的默认项会被自动补回来，删不掉）。
export function normalizeWatchlist(raw, defaults = WATCH_DEFAULTS) {
  const bySym = new Map();
  const push = (sym, enabled, order) => {
    const upper = String(sym || '').toUpperCase();
    if (!SYM_RE.test(upper) || bySym.has(upper)) return;
    bySym.set(upper, { sym: upper, kind: kindOf(upper), enabled: enabled !== false, order: Number(order) || 0 });
  };
  (Array.isArray(raw) ? raw : []).forEach((item, index) => {
    if (item && typeof item === 'object') push(item.sym, item.enabled, item.order || index);
  });
  if (!bySym.size) defaults.forEach((item, index) => push(item.sym, true, index));
  return Array.from(bySym.values()).sort((a, b) => a.order - b.order || a.sym.localeCompare(b.sym));
}

export function toggleWatch(list, sym) {
  const upper = String(sym || '').toUpperCase();
  return normalizeWatchlist(list).map((item) =>
    item.sym === upper ? { ...item, enabled: !item.enabled } : item,
  );
}

export function addWatch(list, sym) {
  const upper = String(sym || '').trim().toUpperCase();
  if (!SYM_RE.test(upper)) return null;
  const current = normalizeWatchlist(list);
  if (current.some((item) => item.sym === upper)) return current;
  return [...current, { sym: upper, kind: kindOf(upper), enabled: true, order: current.length }];
}

export function removeWatch(list, sym) {
  const upper = String(sym || '').toUpperCase();
  return normalizeWatchlist(list).filter((item) => item.sym !== upper);
}

export function moveWatch(list, sym, delta) {
  const upper = String(sym || '').toUpperCase();
  const items = normalizeWatchlist(list).slice();
  const index = items.findIndex((item) => item.sym === upper);
  const next = index + (Number(delta) || 0);
  if (index < 0 || next < 0 || next >= items.length) return items;
  const [item] = items.splice(index, 1);
  items.splice(next, 0, item);
  return items.map((row, i) => ({ ...row, order: i }));
}

export function formatChangePct(value) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const rounded = Number(num.toFixed(2));
  // 避免显示成 "-0.00%"
  if (rounded === 0) return '+0.00%';
  return (rounded > 0 ? '+' : '') + rounded.toFixed(2) + '%';
}

const CURRENCY_SIGN = { USD: '$', KRW: '₩', EUR: '€', JPY: '¥', GBP: '£', HKD: 'HK$', CAD: 'C$', AUD: 'A$' };

// 按行情自带的货币符号显示（如 SKHYV 是韩元计价），未知货币标在数字前
export function formatPrice(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const cur = String(currency || 'USD').toUpperCase();
  const sign = CURRENCY_SIGN[cur] !== undefined ? CURRENCY_SIGN[cur] : cur + ' ';
  if (cur !== 'KRW' && cur !== 'JPY' && num < 1) {
    // 小额币价（BONK / PEPE / SHIB 这类）按数量级多给几位，否则一律显示成 $0.00
    const small = num >= 0.01 ? 4 : num >= 0.0001 ? 6 : 8;
    return sign + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: small });
  }
  const digits = cur === 'KRW' || cur === 'JPY' ? 0 : 2;
  return sign + num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// 行情时间：同一交易日只显示 HH:mm，跨天补上 MM-DD（避免误以为是实时）
export function formatQuoteTime(ms) {
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return '';
  const d = new Date(num);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return hh + ':' + mm;
  return String(d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hh + ':' + mm;
}

// 观察列表行：只有 enabled 的展示；行情缺失时也要出这一行（显示 —），不能凭空消失
export function toWatchRows(list, quotes) {
  const source = quotes || {};
  return normalizeWatchlist(list)
    .filter((item) => item.enabled)
    .map((item) => {
      const quote = source[quoteSymbolOf(item.sym)] || null;
      return {
        sym: item.sym,
        label: labelOf(item.sym),
        kind: item.kind,
        price: quote ? quote.price : null,
        priceText: quote ? formatPrice(quote.price, quote.currency) : '—',
        changePct: quote ? quote.changePct : null,
        changeText: quote ? formatChangePct(quote.changePct) : '—',
        dir: quote && Number.isFinite(Number(quote.changePct)) ? (Number(quote.changePct) >= 0 ? 'up' : 'down') : 'flat',
        source: quote ? quote.source : null,
        timeText: quote && quote.asOf ? formatQuoteTime(quote.asOf) : (quote && quote.marketState === '24/7' ? '实时' : ''),
      };
    });
}

// 前十大构成股：权重来自榜单（静态兜底或实时解析），涨跌来自行情
export function toHoldingRows(holdings, quotes) {
  const rows = (holdings && Array.isArray(holdings.list)) ? holdings.list : [];
  const source = quotes || {};
  return rows.map((item) => {
    const quote = source[quoteSymbolOf(item.sym)] || null;
    return {
      sym: item.sym,
      name: item.name || item.sym,
      weight: Number(item.weight) || 0,
      weightText: (Number(item.weight) || 0).toFixed(2) + '%',
      priceText: quote ? formatPrice(quote.price, quote.currency) : '—',
      changeText: quote ? formatChangePct(quote.changePct) : '—',
      dir: quote && Number.isFinite(Number(quote.changePct)) ? (Number(quote.changePct) >= 0 ? 'up' : 'down') : 'flat',
      timeText: quote && quote.asOf ? formatQuoteTime(quote.asOf) : '',
    };
  }).sort((a, b) => b.weight - a.weight);
}

/* ---------------- 观察列表的"状态机"：归属映射 / 云端并集 / 持仓-关注分组 ---------------- */

/**
 * 行情与持仓的归属映射：v373 起第三腿是 IBIT（它自己就是持仓代码）。
 * BTCETF 只剩过渡别名（还没迁移的老观察列表行）→ 指到 IBIT；BTC 那行是加密现货（空串 = 不属于你的持仓）。
 */
export const WATCH_HELD_OF = { BTCETF: 'IBIT', BTC: '' };

/** 某个观察标的对应的"底层代码"；返回 '' 表示它只是行情关注项，不算持仓。 */
export function resolveHeldSymbol(sym, heldOf) {
  const map = heldOf || WATCH_HELD_OF;
  const upper = String(sym || '').toUpperCase();
  if (Object.prototype.hasOwnProperty.call(map, upper)) return map[upper];
  return upper;
}

/**
 * 云端观察列表合并：**并集**，绝不丢标的。
 * 云端项在前、本地独有的补在后面，按代码去重，最后统一走 normalizeWatchlist。
 * （历史决策：并集意味着"A 设备删掉的标的"会在 B 设备拉取时被并回来，换取"绝不丢"。）
 */
export function mergeWatchlist(local, cloud) {
  const seen = new Set();
  const merged = [];
  const push = (item) => {
    const sym = item && item.sym ? String(item.sym).toUpperCase() : '';
    if (!sym || seen.has(sym)) return;
    seen.add(sym);
    merged.push(item);
  };
  (Array.isArray(cloud) ? cloud : []).forEach(push);
  (Array.isArray(local) ? local : []).forEach(push);
  return normalizeWatchlist(merged);
}

/**
 * 按"持有市值"把观察列表分成 持仓组 / 关注组，并给出持仓合计。
 * - valueOf(item) 返回持有市值，用于"持仓合计"
 * - isHeldOf(item) 可选，判定是否算持仓；默认按 value > 0
 *   ⚠️ 线上必须传"持有股数 > 0"而不是"> 0 市值"：拿不到现价（停牌/盘前/接口失败）时
 *   市值会算成 0，用市值判定会把持仓行错误地丢进"关注"组（v237 曾这样回归，靠样式指纹抓到）。
 */
export function splitByHolding(items, valueOf, isHeldOf) {
  const held = [];
  const watch = [];
  let total = 0;
  (Array.isArray(items) ? items : []).forEach((item) => {
    const value = Number(valueOf ? valueOf(item) : 0) || 0;
    const isHeld = typeof isHeldOf === 'function' ? !!isHeldOf(item) : value > 0;
    if (isHeld) {
      held.push(item);
      total += value;
    } else {
      watch.push(item);
    }
  });
  return { held, watch, total };
}

// 一次请求要拿的所有行情代码（观察列表 + 两张榜单，去重）
export function collectQuoteSymbols(list, holdingsBySymbol) {
  const set = new Set();
  normalizeWatchlist(list).filter((item) => item.enabled).forEach((item) => set.add(quoteSymbolOf(item.sym)));
  Object.keys(holdingsBySymbol || {}).forEach((key) => {
    const holdings = holdingsBySymbol[key];
    (holdings && holdings.list ? holdings.list : []).forEach((item) => set.add(quoteSymbolOf(item.sym)));
  });
  return Array.from(set);
}

// 底层资产敞口：把两张榜单里同一标的的敞口相加（如 NVDA 同时在 VGT 与 SMH 里）。
// - 不重复计算：ETF 自身不作为一行，只出现"成分股 + 其余成分股"
// - extras 用于"单一底层资产"（如 IBIT → 比特币 100%），与穿透行混排并按金额倒序
// - etfRest 给出每支 ETF 未被榜单覆盖的部分，保证合计能对上分母
export function toExposureRows(holdingsBySymbol, valueByEtf, limit = 10, extras = []) {
  const map = new Map();
  const covered = {};
  Object.keys(holdingsBySymbol || {}).forEach((etf) => {
    const value = Number(valueByEtf && valueByEtf[etf]) || 0;
    const list = (holdingsBySymbol[etf] && holdingsBySymbol[etf].list) || [];
    covered[etf] = Number(list.reduce((sum, item) => sum + (Number(item.weight) || 0), 0).toFixed(1));
    if (value <= 0) return;
    list.forEach((item) => {
      const weight = Number(item.weight) || 0;
      if (weight <= 0) return;
      const row = map.get(item.sym) || { sym: item.sym, name: item.name, amount: 0, parts: [] };
      row.amount += (value * weight) / 100;
      row.parts.push(etf + ' ' + weight.toFixed(2) + '%');
      row.kind = 'pierce';
      map.set(item.sym, row);
    });
  });
  (Array.isArray(extras) ? extras : []).forEach((item) => {
    const amount = Number(item && item.amount) || 0;
    if (amount <= 0) return;
    const key = String((item && item.sym) || '');
    if (!key) return;
    const row = map.get(key) || { sym: key, name: item.name || key, amount: 0, parts: [] };
    row.amount += amount;
    row.parts.push(item.note || '直接持有');
    row.kind = 'direct';
    row.sourceText = item.note || '直接持有';
    map.set(key, row);
  });
  const etfRest = Object.keys(holdingsBySymbol || {}).map((etf) => {
    const value = Number((valueByEtf && valueByEtf[etf]) || 0);
    // 金额用未舍入的覆盖度算（否则四舍五入会在合计上对不上分母），显示时才取 1 位小数
    const rawSum = ((holdingsBySymbol[etf] && holdingsBySymbol[etf].list) || [])
      .reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
    const missPct = Math.max(0, 100 - rawSum);
    return {
      label: etf + ' 其余成分股',
      amount: (value * missPct) / 100,
      missPct: Number(missPct.toFixed(1)),
      kind: 'rest',
      sourceText: '榜单外 ' + Number(missPct.toFixed(1)) + '%',
    };
  }).filter((row) => row.amount > 0);
  const all = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  const base = Object.keys(valueByEtf || {}).reduce((sum, key) => sum + (Number(valueByEtf[key]) || 0), 0) +
    (Array.isArray(extras) ? extras.reduce((sum, item) => sum + (Number(item && item.amount) || 0), 0) : 0);
  const shareOf = (amount) => (base > 0 ? Number(((amount / base) * 100).toFixed(1)) : null);
  const restAmount = Number(all.slice(limit).reduce((sum, row) => sum + row.amount, 0).toFixed(2));
  return {
    // sourceText 统一在这里补齐：穿透行用各 ETF 的权重拼出来（表格里不再显示，点开详情才用）
    rows: all.slice(0, limit).map((row) => ({
      ...row,
      share: shareOf(row.amount),
      sourceText: row.sourceText || row.parts.join(' + '),
    })),
    rest: restAmount,
    restCount: Math.max(0, all.length - limit),
    restShare: all.length > limit ? shareOf(restAmount) : null,
    // 其余成分股也要给出"占我持仓的比例"（之前漏了，只给了"榜单外 X%"，两者含义不同）
    etfRest: etfRest.map((row) => ({ ...row, share: shareOf(row.amount) })),
    covered,
    base,
  };
}

export { KIND_LABEL };

/**
 * 行情是否已经"过期"（v370）。
 *
 * 用途：决定"切回前台 / 定时器到点"要不要补刷行情。抽成纯函数是为了能钉住判定边界 ——
 * 以前这段逻辑散在回调里，v307 合并行情总线时定时器只覆盖了加密那条链路，
 * 结果 VGT/SMH 开着页面也不刷新（见 maintenance.md 的行情总线一节）。
 *
 * 规则：没拉过（lastAt 非法/为 0）→ 算过期；maxAgeMs 非法 → 算过期（宁可多拉一次）。
 */
export function quotesStale(lastAt, now, maxAgeMs) {
  const last = Number(lastAt) || 0;
  const at = Number(now) || 0;
  const max = Number(maxAgeMs) || 0;
  if (!(max > 0)) return true;
  if (!(last > 0)) return true;
  return at - last >= max;
}
