// 设置抽屉 / 云同步面板的纯逻辑（DOM 事件绑定仍留在 index.js）。
// 抽出后这两块可以离线单测：同步配置解析的容错、数据健康那几行文案的判定顺序。

/** 设置抽屉里四个面板的 id（openAdvancedSettings 用） */
export const SETTINGS_PANEL_IDS = {
  account: 'settingsAccount',
  users: 'settingsUsers',
  activity: 'settingsActivity',
  sync: 'settingsSync',
  price: 'settingsPrice',
  data: 'settingsData',
  preferences: 'settingsPreferences',
};

/** 打开某个面板时顺便聚焦的输入框（没有就不聚焦） */
export const SETTINGS_FOCUS_IDS = {
  price: 'hmManualSym',
  preferences: 'monthlyDCAInput',
};

/**
 * 解析同步配置（localStorage 里的 JSON 字符串）。
 * 坏 JSON、缺字段、null 都要能兜住——这条以前只写在 loadSyncCfg 里，没法测。
 */
export function parseSyncConfig(raw) {
  const out = { url: '', token: '' };
  let cfg = null;
  try {
    cfg = JSON.parse(raw || '');
  } catch (e) {
    cfg = null;
  }
  if (cfg && typeof cfg === 'object') {
    if (cfg.url !== undefined) out.url = cfg.url;
    if (cfg.token !== undefined) out.token = cfg.token;
  }
  return out;
}

/**
 * 数据健康面板要显示的全部判定（判定顺序即"优先级"，与旧实现一致）：
 *   冲突 > 同步失败 > 未配置 > 有待同步项 > 正常
 * 时间显示交给调用方传入的 formatTime（测试里用固定格式，避免时区影响断言）。
 */
export function syncHealthSummary(syncState, opts) {
  const s = syncState || {};
  const options = opts || {};
  const configured = !!options.configured;
  const formatTime = typeof options.formatTime === 'function' ? options.formatTime : String;
  const dirty = s.dirty || {};
  const keys = Array.isArray(options.keys) ? options.keys : Object.keys(dirty);
  const dirtyCount = keys.filter(function (k) { return !!dirty[k]; }).length;
  const conflictCount = Array.isArray(s.pendingConflicts) ? s.pendingConflicts.length : 0;
  const lastSyncAt = Number(s.lastSyncAt) || 0;
  const failed = Number(s.lastSyncErrorAt) > lastSyncAt;
  const pullAt = Number(s.lastPullAt) || 0;
  const pushAt = Number(s.lastPushAt) || 0;
  const backupAt = Number(options.backupAt) || 0;
  return {
    configured: configured,
    dirtyCount: dirtyCount,
    conflictCount: conflictCount,
    failed: failed,
    lastSyncAt: lastSyncAt,
    pullAt: pullAt,
    pushAt: pushAt,
    backupAt: backupAt,
    pullText: !configured ? '尚未配置' : (pullAt ? formatTime(pullAt) : '尚未下载'),
    pushText: !configured ? '尚未配置' : (pushAt ? formatTime(pushAt) : '尚未上传'),
    backupText: backupAt ? formatTime(backupAt) : '尚未导出',
    conflictText: conflictCount ? conflictCount + '项待处理' : '无冲突',
    stateText: conflictCount ? conflictCount + '项冲突'
      : failed ? '同步需重试'
        : !configured ? '本地保存'
          : dirtyCount ? dirtyCount + '项待同步'
            : lastSyncAt ? '云端正常' : '等待同步',
    mobileText: conflictCount ? '发现数据冲突'
      : failed ? '同步需重试'
        : !configured ? '本地已保存'
          : dirtyCount ? '等待云同步' : '云端已同步',
  };
}
