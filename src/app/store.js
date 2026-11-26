// 本地存储基础设施：key 常量、统一读写（带容错）、数据版本迁移。
import { CORE_SYMBOLS, TARGET_STATE, RETIRED_CORE_SYMBOLS } from './portfolio-config.js';
// 只做"存取"这一件事，不掺业务副作用（同步、备份、刷新 UI 仍由 index.js 负责）。


/* ===== 多用户：本地存储按账号分区 =====
   登录后服务端会下发一个可读的 wt_uid cookie，index.js 在**任何读写之前**调用
   setStorageNamespace(uid) —— 于是所有键都会带上 "u2:" 这样的前缀。
   为什么不做成异步：App 启动时是同步从 localStorage 读初始状态的，
   只有可读 cookie 能在这个时机给出账号。 */
let __ns = '';
export function setStorageNamespace(uid) {
  __ns = uid ? 'u' + uid + ':' : '';
}
export function storageNamespace() {
  return __ns;
}
function prefixed(key) {
  return __ns + key;
}
/** localStorage 的带前缀替身：接口与 localStorage 一致，直接替换调用点即可。 */
export const LS = {
  getItem(key) {
    try { return localStorage.getItem(prefixed(key)); } catch (e) { return null; }
  },
  setItem(key, value) {
    try { localStorage.setItem(prefixed(key), value); return true; } catch (e) { return false; }
  },
  removeItem(key) {
    try { localStorage.removeItem(prefixed(key)); } catch (e) { /* 忽略 */ }
  },
};
/** 当前账号名下的所有键（清空数据/导出备份用，不会碰到别的账号）。 */
export function namespacedKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.indexOf(__ns) === 0) out.push(key.slice(__ns.length));
    }
  } catch (e) { /* 忽略 */ }
  return out;
}

export const KEYS = {
  dashboard: 'wealth_dashboard_v2',
  prices: 'wealth_prices_v2',
  trades: 'wealth_trades_v2',
  cash: 'wealth_cash_v2',
  cashLog: 'wealth_cashlog_v2',
  watchlist: 'wealth_watchlist_v1',
  activity: 'wealth_activity_v1',
  syncState: 'wealth_sync_state',
  syncConfig: 'wealth_sync_cfg',
  recordsSegment: 'wealth_records_segment_v1',
  firstTime: 'wealth_first_time',
  alertSeen: 'wealth_alert_seen_v1',
  schema: 'wealth_schema_v1',
  legacyCoreV4: 'wealth_legacy_core_v4',
  coreMigrationV4: 'wealth_core_migration_v4_pending',
};

// 浏览器存储超限（Safari 无痕模式、配额用尽）统一走这里判断
export function isQuotaError(error) {
  if (!error) return false;
  return error.name === 'QuotaExceededError' || String(error.message || '').indexOf('quota') >= 0;
}

export function readRaw(key) {
  try {
    return localStorage.getItem(prefixed(key));
  } catch (e) {
    return null;
  }
}

export function writeRaw(key, value) {
  try {
    localStorage.setItem(prefixed(key), value);
    return true;
  } catch (e) {
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(prefixed(key));
    return true;
  } catch (e) {
    return false;
  }
}

export function readJSON(key, fallback) {
  try {
    const raw = readRaw(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch (e) {
    return false;
  }
}

export const DATA_SCHEMA = 4;

// 迁移链：每次数据结构变化时，往 steps 里加一个新版本号对应的函数即可。
// onError 用于把迁移异常交给上层上报（store 本身不依赖具体的日志实现）。
export function runMigrations(onError) {
  const from = Number(readRaw(KEYS.schema) || 0) || 0;
  if (from >= DATA_SCHEMA) return from;

  const steps = {
    // v1 → v2：清掉早期用 localStorage 持久化的"提醒已读"标记（现在改成仅本次会话有效）
    1: () => removeKey(KEYS.alertSeen),
    // v2 → v3：移除已退役的期权模块，只清测试数据，不动交易、现金和持仓。
    2: () => {
      ['wealth_options_v2', 'otmSettings', 'ccSchedule', 'wealth_opt_ping_v1', 'otm76_migrated_v1', 'cc_schedule_reset_v2']
        .forEach((key) => removeKey(key));
    },
    // v3 → v4：核心仓改为 QQQM/VGT/SMH。旧测试数据先归档，再让新组合从空仓开始；
    // 定投、路线图和目标等参数保留，避免把一次标的迁移扩大成“恢复出厂设置”。
    4: () => {
      const current = readJSON(KEYS.dashboard, null);
      // 全新安装没有旧 dashboard 时不能把测试种子/首次数据当“旧核心仓”清掉。
      if (from < 3 && (!current || typeof current !== 'object' || 'qqqm' in current)) return;
      const archive = {
        archivedAt: new Date().toISOString(),
        state: readRaw(KEYS.dashboard),
        trades: readRaw(KEYS.trades),
        cashBalance: readRaw(KEYS.cash),
        cashLog: readRaw(KEYS.cashLog),
        watchlist: readRaw(KEYS.watchlist),
        prices: readRaw(KEYS.prices),
      };
      writeRaw(KEYS.legacyCoreV4, JSON.stringify(archive));

      const nextState = Object.assign({}, current && typeof current === 'object' ? current : {}, TARGET_STATE);
      delete nextState.btc;
      delete nextState.sgovTarget;
      writeRaw(KEYS.dashboard, JSON.stringify(nextState));

      [KEYS.trades, KEYS.cash, KEYS.cashLog].forEach((key) => removeKey(key));

      const rawWatch = readJSON(KEYS.watchlist, null);
      if (Array.isArray(rawWatch)) {
        const removed = new Set([...RETIRED_CORE_SYMBOLS, 'BTC']);
        const watch = rawWatch
          .filter((item) => item && !removed.has(String(item.sym || '').toUpperCase()))
          .map((item) => Object.assign({}, item));
        if (!watch.some((item) => String(item.sym || '').toUpperCase() === 'QQQM')) {
          watch.unshift({ sym: 'QQQM', kind: 'stock', enabled: true, order: 0 });
        }
        watch.forEach((item, index) => { item.order = index; });
        writeRaw(KEYS.watchlist, JSON.stringify(watch));
      }

      const prices = readJSON(KEYS.prices, null);
      if (prices && typeof prices === 'object') {
        const cleaned = Object.assign({}, prices);
        [...RETIRED_CORE_SYMBOLS, 'BTC'].forEach((sym) => { delete cleaned[sym]; });
        writeRaw(KEYS.prices, JSON.stringify(cleaned));
      }

      // 新组合需要主动写回云端；清掉旧版本号可避免旧设备/旧云端目标反向覆盖。
      const syncState = readJSON(KEYS.syncState, null);
      if (syncState && typeof syncState === 'object') {
        const next = Object.assign({}, syncState);
        next.dirty = Object.assign({}, syncState.dirty || {});
        next.cloudTs = Object.assign({}, syncState.cloudTs || {});
        ['trades', 'cashBalance', 'cashLog', 'state', 'watchlist', 'prices'].forEach((key) => {
          next.dirty[key] = true;
          delete next.cloudTs[key];
        });
        writeRaw(KEYS.syncState, JSON.stringify(next));
        // 已登录的老用户：下一次 autoPull 先推新组合，避免旧云端数据触发假冲突。
        writeRaw(KEYS.coreMigrationV4, '1');
      }
    },
  };

  for (let v = from + 1; v <= DATA_SCHEMA; v += 1) {
    try {
      if (steps[v]) steps[v]();
    } catch (error) {
      if (typeof onError === 'function') onError('migration v' + v, error && error.stack);
    }
  }

  writeRaw(KEYS.schema, String(DATA_SCHEMA));
  return DATA_SCHEMA;
}
