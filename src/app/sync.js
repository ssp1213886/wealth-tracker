// 云同步的纯逻辑：payload 组装与结果分类。
// 不做任何网络请求，也不碰全局状态——读数据的动作由调用方以函数形式注入，方便单测。

// 同步用的键（与后端 SYNC_KEYS 对齐）
export const SYNC_FIELDS = [
  'trades',
  'cashBalance',
  'cashLog',
  'state',
  'activities',
  'optionTrades',
  'otmSettings',
  'exit_portfolio',
];

/**
 * 云端时间戳归一化成毫秒。
 * 历史数据里混进过"秒"精度的 updated_at（D1 早期的 notes/options 行），
 * 两边单位不一致会让"云端有没有变过"的判断永远为真——假冲突就是这么来的。
 */
export function normalizeSyncTs(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return ts < 1e12 ? Math.round(ts * 1000) : Math.round(ts);
}

/** 与键顺序无关的稳定序列化，用于比较本地与云端内容是否一致。 */
function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * 判断同一个键的本地值与云端值是否等价。
 * `normalizeStateFn` 用于 state 这类需要先补默认值再比较的结构。
 */
export function syncContentEqual(key, localVal, cloudVal, normalizeStateFn) {
  try {
    if (key === 'state' && typeof normalizeStateFn === 'function') {
      return stableStringify(normalizeStateFn(localVal)) === stableStringify(normalizeStateFn(cloudVal));
    }
    return stableStringify(localVal) === stableStringify(cloudVal);
  } catch (error) {
    return false;
  }
}

/**
 * 组装同步 payload。
 * @param {object} opts
 * @param {boolean} opts.dirtyOnly 只推改动过的键（自动同步用）
 * @param {object} opts.dirty      各键的脏标记
 * @param {object} opts.cloudTs    各键已知的云端时间戳（用于乐观锁）
 * @param {object} opts.read       各键的读取函数
 * @param {function} opts.readPrices 行情缓存读取函数（价格不参与冲突检测，始终带上）
 */
export function buildSyncPayload(opts) {
  const dirtyOnly = !!(opts && opts.dirtyOnly);
  const dirty = (opts && opts.dirty) || {};
  const cloudTs = (opts && opts.cloudTs) || {};
  const read = (opts && opts.read) || {};
  const payload = {};
  const expected = {};

  const include = (key) => {
    if (dirtyOnly && !dirty[key]) return;
    const getter = read[key];
    payload[key] = typeof getter === 'function' ? getter() : undefined;
    // 只在"确实知道云端版本"时才带期望值。
    // 带 0 等于宣称"我期望云端没有这一行"，而云端有 → 服务端必然回 409 假冲突。
    const known = normalizeSyncTs(cloudTs[key]);
    if (known > 0) expected[key] = known;
  };

  SYNC_FIELDS.forEach(include);

  // 行情缓存始终同步，但不带版本戳（它是可再生的数据，不需要冲突检测）
  payload.prices = typeof (opts && opts.readPrices) === 'function' ? opts.readPrices() : {};
  payload.__expectedVersions = expected;
  return payload;
}

/**
 * 把同步失败归类，供上层决定提示文案与后续动作。
 * 409 = 云端版本更新（冲突）；401 = 令牌无效；429 = 被限流。
 */
export function classifySyncError(status) {
  if (status === 409) return 'conflict';
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'throttled';
  return 'error';
}
