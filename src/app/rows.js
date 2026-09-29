// 列表行渲染：把"数据 → HTML"这段最容易出错的逻辑抽成纯函数。
// 只依赖传入的参数，不读全局状态，因此可以直接单测（结构、转义、符号、空态）。
import { fmtFull, fmtShares, cashSigned } from './util.js';
import { emptyStateHTML, escapeHtml } from './render.js';

/* ---------------- 交易历史 ---------------- */

// 按日期时间倒序 + 可选按标的过滤
export function selectTrades(trades, symbol) {
  let list = [].concat(trades).sort(function (a, b) {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    return (b.time || '').localeCompare(a.time || '');
  });
  if (symbol) list = list.filter((t) => t.symbol === symbol);
  return list;
}

export function buildTradeRow(t) {
  const sym = t.tag === 'assign'
    ? '<strong style="color:var(--blue)">' + t.symbol + '</strong>'
    : '<strong>' + t.symbol + '</strong>';
  const direction = t.shares > 0
    ? '<span class="trade-dir is-buy">买入</span>'
    : '<span class="trade-dir is-sell">卖出</span>';
  return '<tr><td data-cell="date">' + t.date + (t.time ? ' ' + t.time : '') + '</td>' +
    '<td data-cell="sym">' + sym + '</td>' +
    '<td data-cell="qty">' + direction + '<span class="trade-qty">' + fmtShares(t.shares) + ' 股</span></td>' +
    '<td data-cell="price">$' + t.price.toFixed(2) + '</td>' +
    '<td data-cell="amount">' + fmtFull(Math.abs(t.shares) * t.price) + '</td>' +
    '<td data-cell="actions"><button class="trade-del" data-id="' + t.id + '">×</button></td></tr>';
}

export function buildTradeRows(list) {
  if (!list.length) {
    return '<tr><td colspan="6">' + emptyStateHTML({
      title: '还没有交易记录',
      hint: '在操作台录入第一笔交易',
      compact: true,
      icon: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>',
    }) + '</td></tr>';
  }
  return list.map(buildTradeRow).join('');
}

/* ---------------- 资金流水 ---------------- */

// 按类型过滤并倒序（最新在前）
export function selectCashLogs(cashLog, filter) {
  const list = [];
  for (let i = 0; i < cashLog.length; i += 1) {
    if (!filter || cashLog[i].type.indexOf(filter) >= 0) list.push(cashLog[i]);
  }
  return list.slice().reverse();
}

// 累计入金 / 出金（用于卡片底部汇总行）
export function cashTotals(cashLog) {
  let totalIn = 0;
  let totalOut = 0;
  (cashLog || []).forEach((l) => {
    if (l.type.indexOf('入金') >= 0) totalIn += l.amount;
    else if (l.type.indexOf('出金') >= 0) totalOut += l.amount;
  });
  return { totalIn, totalOut };
}

/**
 * 记录页顶部汇总：累计入金 / 累计卖出 / 累计买入。
 * 口径说明：入金判定与 cashTotals 统一用「类型里含"入金"」（历史实现里这里用的是严格相等，
 * 两处口径不一致；实际类型都是 App 自己写死的字符串，行为相同，统一后更保险）。
 */
export function dataPageTotals(trades, cashLog) {
  var deposit = 0;
  var bought = 0;
  var sold = 0;
  (cashLog || []).forEach(function (l) {
    if (l && String(l.type || '').indexOf('入金') >= 0) deposit += Number(l.amount) || 0;
  });
  (trades || []).forEach(function (t) {
    if (!t) return;
    var shares = Number(t.shares) || 0;
    var price = Number(t.price) || 0;
    if (shares > 0) bought += shares * price;
    else if (shares < 0) sold += Math.abs(shares) * price;
  });
  return { deposit: deposit, bought: bought, sold: sold };
}

/** 记录页表格搜索：单行文本是否命中（空查询 = 全部命中；大小写/首尾空格不敏感）。 */
export function matchRowText(text, query) {
  var q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  return String(text == null ? '' : text).toLowerCase().indexOf(q) >= 0;
}

/** 搜索计数文案：空查询不显示条数。 */
export function searchCountText(matched, query) {
  var q = String(query == null ? '' : query).trim();
  return q ? matched + ' 条' : '';
}

function cashTypeStyle(type) {
  const bg = type.indexOf('入金') >= 0 ? 'var(--accent-l)'
    : type.indexOf('权利金') >= 0 ? 'rgba(74,143,212,.12)'
      : type.indexOf('股息') >= 0 ? 'rgba(232,136,12,.12)' : 'rgba(230,53,43,.12)';
  const color = type.indexOf('入金') >= 0 ? 'var(--accent-d)'
    : type.indexOf('权利金') >= 0 ? 'var(--blue)'
      : type.indexOf('股息') >= 0 ? 'var(--orange)' : 'var(--red)';
  return 'background:' + bg + ';color:' + color +
    ';padding:2px 8px;border-radius:4px;font-size:.65rem;font-weight:500;';
}

export function buildCashLogRow(l) {
  const type = escapeHtml(l.type);
  const dt = escapeHtml(l.date + (l.time ? ' ' + l.time : ''));
  const sign = cashSigned(l) < 0 ? -1 : 1;
  return '<tr><td data-cell="date">' + dt + '</td>' +
    '<td data-cell="type"><span style="display:inline-block;' + cashTypeStyle(l.type) + '">' + type + '</span></td>' +
    '<td data-cell="amount" class="' + (sign < 0 ? 'cash-neg' : 'cash-pos') + '">' +
    (sign < 0 ? '-' : '+') + fmtFull(Math.abs(l.amount)) + '</td>' +
    '<td data-cell="actions"><button class="trade-del" data-clog="' + l.id + '" aria-label="删除流水">×</button></td></tr>';
}

export function buildCashLogRows(list) {
  if (!list.length) {
    return '<tr><td colspan=4>' + emptyStateHTML({
      title: '暂无资金流水',
      hint: '入金、出金、股息会记录在这里',
      compact: true,
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M17 8.5A4 4 0 0 0 12.5 6h-1a3 3 0 0 0 0 6h1a3 3 0 0 1 0 6h-1A4 4 0 0 1 7 15.5"/></svg>',
    }) + '</td></tr>';
  }
  return list.map(buildCashLogRow).join('');
}
