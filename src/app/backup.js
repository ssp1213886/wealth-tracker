// 备份的纯逻辑：导出数据的组装 + 导入计划（校验 / 归一 / 摘要 / 价格清洗）。
// 不碰 DOM、不写存储 —— confirm 弹窗与逐字段写回仍由 index.js 负责。
// v252 从 index.js 抽出：这条是数据安全路径，抽出来后"导错版本、导坏字段"都能离线测。

import { normalizeTrades, normalizeCashLogs, normalizeActivities } from './records-import.js';
import { normalizeOptions, DEFAULT_OPTION_SYMBOLS } from './options.js';
import { normalizeWatchlist } from './watch.js';

/** 导入时接受的主题/配色白名单（其它值一律忽略，避免脏数据写进 localStorage）。 */
export const ACCENT_CHOICES = ['forest', 'ocean', 'warm', 'plum', 'mono'];

/**
 * 组装导出的完整备份对象。
 * 传进来的值已经是"要写进文件的样子"（归一化在调用方完成），这里只固定字段名与顺序。
 */
export function buildBackupPayload(input) {
  const i = input || {};
  return {
    version: i.appDataVersion,
    date: i.date,
    state: i.state,
    trades: i.trades,
    cashBalance: i.cashBalance,
    cashLog: i.cashLog,
    activities: i.activities,
    optionTrades: i.optionTrades,
    otmSettings: i.otmSettings,
    exitPortfolio: i.exitPortfolio,
    watchlist: i.watchlist,
    prices: i.prices,
    theme: i.theme,
    accent: i.accent,
  };
}

/**
 * 导入时的价格缓存清洗：只留白名单里的标的、丢掉非法价；
 * 纯数字写法补成 {price, source:'import', time}，对象写法只覆盖 price。
 */
export function cleanBackupPrices(prices, symbols) {
  const clean = {};
  if (!prices || typeof prices !== 'object') return clean;
  (Array.isArray(symbols) ? symbols : []).forEach(function (sym) {
    const p = prices[sym];
    const n = Number(p && p.price !== undefined ? p.price : p);
    if (!isFinite(n) || n <= 0) return;
    clean[sym] = typeof p === 'object' ? Object.assign({}, p, { price: n }) : { price: n, source: 'import', time: Date.now() };
  });
  return clean;
}

/**
 * 把一份备份文件算成"导入计划"：
 *   ok:false        校验没过（error 给用户看的原因）
 *   next            归一化后的四个列表（缺字段时沿用当前值）
 *   has             每个字段"这份备份里到底有没有"（决定要不要覆盖）
 *   summary         确认弹窗里那段"交易 N 笔 / 流水 N 条 …"
 *   otm / exitValue / prices  需要额外清洗的字段
 *
 * ctx：{ appDataVersion, etfSymbols, current:{trades,cashLog,optionTradesRaw,activitiesRaw,watchlist} }
 */
export function planBackupImport(data, ctx) {
  const cfg = ctx || {};
  const cur = cfg.current || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '不是有效的备份文件' };
  }
  if (Number(data.version) > cfg.appDataVersion) {
    return { ok: false, error: '备份版本高于当前应用，请先更新应用' };
  }
  const hasNotes = 'activities' in data || 'notes' in data;
  const hasOtm = !!(data.otmSettings && typeof data.otmSettings === 'object');
  const exitValue = data.exitPortfolio !== undefined ? data.exitPortfolio : data.exit_portfolio;
  const next = {
    trades: 'trades' in data ? normalizeTrades(data.trades, cfg.etfSymbols) : cur.trades,
    cashLog: 'cashLog' in data ? normalizeCashLogs(data.cashLog) : cur.cashLog,
    optionTrades: 'optionTrades' in data
      ? normalizeOptions(data.optionTrades, cfg.optionSymbols || DEFAULT_OPTION_SYMBOLS)
      : normalizeOptions(cur.optionTradesRaw, cfg.optionSymbols || DEFAULT_OPTION_SYMBOLS),
    activities: hasNotes ? normalizeActivities(data.activities || data.notes) : normalizeActivities(cur.activitiesRaw),
    watchlist: 'watchlist' in data ? normalizeWatchlist(data.watchlist) : normalizeWatchlist(cur.watchlist),
  };
  const summary = '交易 ' + next.trades.length + ' 笔\n'
    + '资金流水 ' + next.cashLog.length + ' 条\n'
    + '期权 ' + next.optionTrades.length + ' 个\n'
    + '操作日志 ' + next.activities.length + ' 条\n'
    + '观察列表 ' + next.watchlist.length + ' 项';
  return {
    ok: true,
    next: next,
    summary: summary,
    has: {
      state: 'state' in data,
      trades: 'trades' in data,
      cashBalance: 'cashBalance' in data,
      cashLog: 'cashLog' in data,
      activities: hasNotes,
      optionTrades: 'optionTrades' in data,
      otmSettings: hasOtm,
      exit: exitValue !== undefined,
      watchlist: 'watchlist' in data,
      prices: !!(data.prices && typeof data.prices === 'object'),
      theme: data.theme === 'dark' || data.theme === 'light',
      accent: ACCENT_CHOICES.indexOf(data.accent) >= 0,
    },
    otm: hasOtm ? {
      vgt: Math.max(1, Math.min(20, Number(data.otmSettings.vgt) || 7)),
      smh: Math.max(1, Math.min(20, Number(data.otmSettings.smh) || 6)),
      // v384：IBIT 进期权后，OTM 默认 10%（近月 IV≈36%，按 0.7–0.8σ 对齐）
      ibit: Math.max(1, Math.min(20, Number(data.otmSettings.ibit) || 10)),
    } : null,
    exitValue: exitValue,
    prices: cleanBackupPrices(data.prices, cfg.etfSymbols),
  };
}
