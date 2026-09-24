// 本地存储基础设施：key 常量、统一读写（带容错）、数据版本迁移。
// 只做"存取"这一件事，不掺业务副作用（同步、备份、刷新 UI 仍由 index.js 负责）。

export const KEYS = {
  dashboard: 'wealth_dashboard_v2',
  prices: 'wealth_prices_v2',
  trades: 'wealth_trades_v2',
  cash: 'wealth_cash_v2',
  cashLog: 'wealth_cashlog_v2',
  options: 'wealth_options_v2',
  activity: 'wealth_activity_v1',
  syncState: 'wealth_sync_state',
  syncConfig: 'wealth_sync_cfg',
  recordsSegment: 'wealth_records_segment_v1',
  firstTime: 'wealth_first_time',
  alertSeen: 'wealth_alert_seen_v1',
  optPing: 'wealth_opt_ping_v1',
  schema: 'wealth_schema_v1',
};

// 浏览器存储超限（Safari 无痕模式、配额用尽）统一走这里判断
export function isQuotaError(error) {
  if (!error) return false;
  return error.name === 'QuotaExceededError' || String(error.message || '').indexOf('quota') >= 0;
}

export function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

export function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
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

export const DATA_SCHEMA = 2;

// 迁移链：每次数据结构变化时，往 steps 里加一个新版本号对应的函数即可。
// onError 用于把迁移异常交给上层上报（store 本身不依赖具体的日志实现）。
export function runMigrations(onError) {
  const from = Number(readRaw(KEYS.schema) || 0) || 0;
  if (from >= DATA_SCHEMA) return from;

  const steps = {
    // v1 → v2：清掉早期用 localStorage 持久化的"提醒已读"标记（现在改成仅本次会话有效）
    1: () => removeKey(KEYS.alertSeen),
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
