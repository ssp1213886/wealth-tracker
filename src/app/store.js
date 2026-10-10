// 本地存储基础设施：key 常量、统一读写（带容错）、数据版本迁移。
// 只做"存取"这一件事，不掺业务副作用（同步、备份、刷新 UI 仍由 index.js 负责）。
import { convertLegacyBtcTrade } from './util.js';
import { normalizeCore } from './core-config.js';


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
  options: 'wealth_options_v2',
  watchlist: 'wealth_watchlist_v1',
  activity: 'wealth_activity_v1',
  syncState: 'wealth_sync_state',
  syncConfig: 'wealth_sync_cfg',
  recordsSegment: 'wealth_records_segment_v1',
  firstTime: 'wealth_first_time',
  alertSeen: 'wealth_alert_seen_v1',
  optPing: 'wealth_opt_ping_v1',
  schema: 'wealth_schema_v1',
};

/* ===== v2 → v3（v373）：第三腿从 Grayscale 的 BTC ETF 换成 iShares 的 IBIT =====
   **不是只改代码**：两个基金 1 股 ≠ 1 股，股数与每股价格要按比例换算（只改代码会让市值凭空 +28.5%）。
   换算系数与规则见 util.js 的 convertLegacyBtcTrade —— 唯一实现，交易归一化与 CSV 导入共用同一份。
   做三件事，缺一不可：
     ① 迁移前的原始值原样存一份到本机备份键（不同步）—— 出问题能在本机回滚；
     ② 改完记一份"动了哪些键"，交给 index.js 在启动后标脏推云（否则云端还是旧数据，换设备一拉就变回去）；
     ③ 幂等：重复跑不会把 IBIT 再改一遍（认的是 BTC→IBIT，第二次没有 BTC 可改）。
   为什么系数写死：迁移在本机离线执行（拿不到行情），而且两台设备必须算出同一份数据。 */
const IBIT_BACKUP_KEY = 'wealth_pre_ibit_migration_v1';
const IBIT_DIRTY_KEY = 'wealth_ibit_migration_dirty_v1';

function renameSymbolInList(raw, key) {
  if (!raw) return '';
  let list;
  try { list = JSON.parse(raw); } catch (e) { return ''; }
  if (!Array.isArray(list)) return '';
  let hit = 0;
  const next = list.map(function (row) {
    if (!row || typeof row !== 'object') return row;
    if (String(row[key] || '').toUpperCase() !== 'BTC') return row;
    hit += 1;
    return Object.assign({}, row, { [key]: 'IBIT' });
  });
  if (!hit) return '';
  return JSON.stringify(next);
}

/** 交易列表：逐条走 convertLegacyBtcTrade（BTC → IBIT + 股数/价格换算）。 */
function convertTradeList(raw) {
  if (!raw) return '';
  let list;
  try { list = JSON.parse(raw); } catch (e) { return ''; }
  if (!Array.isArray(list)) return '';
  let hit = 0;
  const next = list.map(function (row) {
    const after = convertLegacyBtcTrade(row);
    if (after !== row) hit += 1;
    return after;
  });
  if (!hit) return '';
  return JSON.stringify(next);
}

/**
 * 观察列表：只把「BTC ETF」那一行（旧符号 BTCETF）改名成 IBIT。
 * ⚠️ **加密现货那行（BTC）不能动** —— 它是"只看行情"的现货比特币，跟 Mini Trust 不是一回事，
 * 第一版用通用的 renameSymbolInList 把两行都改了（单测当场抓到）。
 */
function renameEtfWatchRow(raw) {
  if (!raw) return '';
  let list;
  try { list = JSON.parse(raw); } catch (e) { return ''; }
  if (!Array.isArray(list)) return '';
  let hit = 0;
  const next = list.map(function (row) {
    if (!row || typeof row !== 'object') return row;
    if (String(row.sym || '').toUpperCase() !== 'BTCETF') return row;
    hit += 1;
    return Object.assign({}, row, { sym: 'IBIT' });
  });
  if (!hit) return '';
  return JSON.stringify(next);
}

/** 行情缓存：BTC 那一份是 Mini Trust 的价，换成 IBIT 就**不能留**（价格不是一回事）—— 直接删掉，让下次启动重新取。 */
function dropBtcPriceKey(raw) {
  if (!raw) return '';
  let map;
  try { map = JSON.parse(raw); } catch (e) { return ''; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return '';
  if (!Object.prototype.hasOwnProperty.call(map, 'BTC')) return '';
  const next = {};
  Object.keys(map).forEach(function (k) {
    if (k === 'BTC') return;
    next[k] = map[k];
  });
  return JSON.stringify(next);
}

/** v3 → v4：state.core 从旧的 vgt/smh/btc + otmSettings 生成（比例/OTM 一律继承，不重置）。 */
function migrateCoreConfig() {
  const raw = readRaw(KEYS.dashboard);
  if (!raw) return [];
  let state;
  try { state = JSON.parse(raw); } catch (e) { return []; }
  if (!state || typeof state !== 'object') return [];
  let otm = {};
  try { const parsed = JSON.parse(readRaw('otmSettings') || '{}'); if (parsed && typeof parsed === 'object') otm = parsed; } catch (e) { /* 忽略 */ }
  const next = Object.assign({}, state, { core: normalizeCore(state.core, { vgt: state.vgt, smh: state.smh, btc: state.btc, otm: otm }) });
  writeRaw(KEYS.dashboard, JSON.stringify(next));
  return [KEYS.dashboard];
}

function migrateBtcToIbit() {
  const jobs = [
    /* 交易要**换算股数** → 用 util.js 的 convertLegacyBtcTrade；options/watchlist 只改代码 */
    { key: KEYS.trades, field: 'symbol', rename: convertTradeList },
    { key: KEYS.options, field: 'sym', rename: renameSymbolInList },
    { key: KEYS.watchlist, field: 'sym', rename: renameEtfWatchRow },
    { key: KEYS.prices, field: null, rename: dropBtcPriceKey },
  ];
  const snapshot = {};
  const touched = [];
  jobs.forEach(function (job) {
    const before = readRaw(job.key);
    if (!before) return;
    if (!Object.prototype.hasOwnProperty.call(snapshot, job.key)) snapshot[job.key] = before;
    const after = job.rename(before, job.field);
    if (!after) return;
    if (writeRaw(job.key, after)) touched.push(job.key);
  });
  /* 备份只写一次（保留最早那份"迁移前"的样子），避免第二次运行把它覆盖成"已经改完"的版本 */
  if (!readRaw(IBIT_BACKUP_KEY) && Object.keys(snapshot).length) {
    writeRaw(IBIT_BACKUP_KEY, JSON.stringify({ at: Date.now(), data: snapshot }));
  }
  if (touched.length) writeRaw(IBIT_DIRTY_KEY, touched.join(','));
  return touched;
}

/** index.js 启动时用它取"迁移改了哪些键"（取完就清，避免每次启动都重复标脏）。 */
export function takeIbitMigrationDirty() {
  const raw = readRaw(IBIT_DIRTY_KEY);
  if (!raw) return [];
  removeKey(IBIT_DIRTY_KEY);
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

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
    /* v2 → v3（v373）：第三腿 Grayscale BTC ETF → iShares IBIT（换算股数，见 migrateBtcToIbit）。
       ⚠️ 键是"**到达**版本 N 时执行的那一步"（`from=2` 循环只跑 steps[3]），不是"从 N 出发"——
       v373 第一版把这段写成 steps[2]，结果整段迁移被静默跳过（try/catch 把 no-op 藏住了，是单测抓出来的）。 */
    3: () => migrateBtcToIbit(),
    /* v3 → v4（v374）：核心仓改成配置驱动 —— 把旧的 state.vgt/smh/btc 比例与 otmSettings 收进 state.core。
       之后「哪几只标的、各占多少、哪几只卖 CALL、节奏/OTM」都在设置里可改，代码不再写死。 */
    4: () => migrateCoreConfig(),
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
