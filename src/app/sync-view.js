// 云同步的「视图层」：状态条胶囊、侧边栏数据健康四行、失败横幅、冲突弹窗、健康区跳转。
// 只把事实渲染成 DOM 与文案 —— 同步决策在 sync-engine.js，网络与状态读写仍在 index.js。
// v247 从 index.js 抽出；判定文案此前已在 settings.js 的 syncHealthSummary 里。

/** 冲突弹窗与"已使用云端"提示里每个同步键的中文名（没登记的直接显示键名）。 */
export const SYNC_KEY_LABELS = {
  trades: '交易记录',
  cashBalance: '现金余额',
  cashLog: '资金流水',
  state: '投资参数',
  activities: '操作日志',
  optionTrades: '期权持仓',
  otmSettings: 'OTM百分比',
  exit_portfolio: '退出策略',
  watchlist: '观察列表',
};

/** 侧边栏四行对应的 DOM id。 */
const HEALTH_ROW_IDS = { cloud: 'sbCloudRow', backup: 'sbBackupRow', push: 'sbPushRow', conflict: 'sbConflictRow' };

/**
 * 「最近云同步 / 最近备份 / 上次成功推送」的时间文案；0 显示空串。
 * 只到"月/日 时:分"，与旧实现一致。
 */
export function formatHealthTime(timestamp, locale) {
  const ts = Number(timestamp) || 0;
  if (!ts) return '';
  return new Date(ts).toLocaleString(locale || 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 悬停时显示完整时间（含年份），给 title 用。 */
export function healthTimeTitle(timestamp, locale) {
  const ts = Number(timestamp) || 0;
  if (!ts) return '';
  return new Date(ts).toLocaleString(locale || 'zh-CN');
}

/**
 * 四行的状态类（is-ok / is-warn / is-error，空串 = 不标色）。
 * 与旧内联写法逐字对应：未配置不标色；失败时间晚于该通道最近成功时间才报错；
 * 配置了但还没同步过 → warn（提示"尚未下载/尚未上传"）。
 */
export function healthRowStatuses(summary, lastSyncErrorAt) {
  const h = summary || {};
  const erroredAt = Number(lastSyncErrorAt) || 0;
  const pullAt = Number(h.pullAt) || 0;
  const pushAt = Number(h.pushAt) || 0;
  const backupAt = Number(h.backupAt) || 0;
  const conflictCount = Number(h.conflictCount) || 0;
  const configured = !!h.configured;
  const failed = !!h.failed;
  return {
    cloud: !configured ? '' : (failed && erroredAt > pullAt) ? 'error' : pullAt ? 'ok' : 'warn',
    backup: backupAt ? 'ok' : 'warn',
    push: !configured ? '' : (failed && erroredAt > pushAt) ? 'error' : pushAt ? 'ok' : 'warn',
    conflict: conflictCount ? 'error' : 'ok',
  };
}

/** 把状态类写到四行上（先清干净再加，避免残留上一个状态的颜色）。 */
export function applyHealthRows(doc, statuses) {
  const st = statuses || {};
  Object.keys(HEALTH_ROW_IDS).forEach(function (key) {
    const row = doc.getElementById(HEALTH_ROW_IDS[key]);
    if (!row) return;
    row.classList.remove('is-ok', 'is-warn', 'is-error');
    if (st[key]) row.classList.add('is-' + st[key]);
  });
}

/**
 * 渲染「数据健康」整块：侧边栏四行文字 + 移动端状态文字 + 四行状态色。
 * opts.state 用于取 lastSyncErrorAt（判定哪条通道的失败更晚），opts.afterRender 用于收尾（失败横幅）。
 */
export function renderSyncHealthView(doc, summary, opts) {
  const h = summary || {};
  const state = (opts && opts.state) || {};
  const stateEl = doc.getElementById('sbSyncState');
  const cloudEl = doc.getElementById('sbSyncLast');
  const backupEl = doc.getElementById('sbBackupLast');
  const pushEl = doc.getElementById('sbLastPush');
  const conflictEl = doc.getElementById('sbConflictState');
  const mobileEl = doc.getElementById('msSyncText');
  const bad = !!h.failed || Number(h.conflictCount) > 0;
  if (stateEl) {
    stateEl.textContent = h.stateText;
    stateEl.classList.toggle('is-error', bad);
  }
  if (cloudEl) {
    cloudEl.textContent = h.pullText;
    cloudEl.title = healthTimeTitle(h.pullAt);
  }
  if (backupEl) backupEl.textContent = h.backupText;
  if (pushEl) {
    pushEl.textContent = h.pushText;
    pushEl.title = healthTimeTitle(h.pushAt);
  }
  if (conflictEl) conflictEl.textContent = h.conflictText;
  if (mobileEl) {
    mobileEl.textContent = h.mobileText;
    const host = mobileEl.parentElement;
    host.classList.toggle('sync-error', bad);
    host.classList.toggle('sync-ok', !bad && !!h.configured && Number(h.dirtyCount) === 0);
  }
  applyHealthRows(doc, healthRowStatuses(h, state.lastSyncErrorAt));
  if (opts && typeof opts.afterRender === 'function') opts.afterRender();
}

/**
 * 状态条胶囊的三态属性：
 *   ''     只回到初始类名（文字/图标不动）
 *   busy   不收（等调用方给结果）
 *   ok     2.2 秒后自动收
 *   err    8 秒后自动收
 */
export function syncBarAttrs(state, text) {
  if (!state) return { className: 'sync-bar', icon: '', text: '', holdMs: 0 };
  return {
    className: 'sync-bar show is-' + state,
    icon: state === 'ok' ? '✓' : state === 'err' ? '!' : '',
    text: text || '',
    holdMs: state === 'ok' ? 2200 : state === 'err' ? 8000 : 0,
  };
}

/** 把三态属性写到状态条上；返回 {applied, holdMs}，定时收起的计时器由调用方持有。 */
export function applySyncBar(doc, state, text) {
  const el = doc.getElementById('syncBar');
  if (!el) return { applied: false, holdMs: 0 };
  const attrs = syncBarAttrs(state, text);
  if (!state) {
    el.className = attrs.className;
    return { applied: true, holdMs: 0 };
  }
  el.className = attrs.className;
  const msg = el.querySelector('.sync-bar-text');
  if (msg) msg.textContent = attrs.text;
  const icon = el.querySelector('.sb-ic');
  if (icon) icon.textContent = attrs.icon;
  return { applied: true, holdMs: attrs.holdMs };
}

/** 状态条里的时钟文案（时:分）；格式化失败就返回空串，不抛。 */
export function syncClockText(date, locale) {
  try {
    return (date || new Date()).toLocaleTimeString(locale || 'zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

/** 冲突弹窗里每个键一行：默认勾选「保留本地」。 */
export function conflictRowsHtml(conflicts, labels) {
  const map = labels || {};
  return (conflicts || []).map(function (key) {
    const label = map[key] || key;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--rule);"><span style="font-size:.7rem;font-weight:540;">' + label + '</span><span style="display:flex;gap:10px;font-size:.7rem;"><label style="display:flex;align-items:center;gap:3px;cursor:pointer;"><input type="radio" name="cf_' + key + '" value="local" checked><span>保留本地</span></label><label style="display:flex;align-items:center;gap:3px;cursor:pointer;"><input type="radio" name="cf_' + key + '" value="cloud"><span>使用云端</span></label></span></div>';
  }).join('');
}

/** 冲突弹窗外壳（把上面那几行插到中部）。 */
export function conflictModalHtml(rowsHtml) {
  return '<div style="background:var(--card-bg);border-radius:14px;padding:20px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3);"><h3 style="font-size:.78rem;font-weight:600;margin-bottom:6px;color:var(--orange);">数据冲突</h3><p style="font-size:.7rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">云端和本地都有更新,请选择保留哪一边。默认保留本地(当前设备的改动)。</p>' + rowsHtml + '<div style="display:flex;gap:8px;margin-top:14px;"><button id="cfCancel" class="btn btn-out" style="flex:1;font-size:.7rem;">全部保留本地</button><button id="cfOk" class="btn btn-pri" style="flex:1;font-size:.7rem;">确定</button></div></div>';
}

const CONFLICT_MODAL_CSS = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:20px;';

/** 读出每个键的选择（没选到、或值是别的 → 保留本地，与旧行为一致）。 */
export function readConflictPicks(doc, conflicts) {
  const picks = {};
  (conflicts || []).forEach(function (key) {
    const chosen = doc.querySelector('input[name="cf_' + key + '"]:checked');
    picks[key] = chosen && chosen.value === 'cloud' ? 'cloud' : 'local';
  });
  return picks;
}

/**
 * 打开冲突弹窗并把两个按钮接上回调：
 *   onAllLocal(modal)          「全部保留本地」——调用方负责上传与清 dirty
 *   onConfirm(modal, picks)    「确定」——picks 是 {键: 'local'|'cloud'}
 * 数据操作全部由调用方做，这里只碰 DOM。
 */
export function openConflictModal(opts) {
  const doc = opts.doc;
  const conflicts = opts.conflicts || [];
  const existing = doc.getElementById('conflictModal');
  if (existing) existing.remove();
  const modal = doc.createElement('div');
  modal.id = 'conflictModal';
  modal.style.cssText = CONFLICT_MODAL_CSS;
  modal.innerHTML = conflictModalHtml(conflictRowsHtml(conflicts, opts.labels));
  doc.body.appendChild(modal);
  doc.getElementById('cfCancel').onclick = function () { opts.onAllLocal(modal); };
  doc.getElementById('cfOk').onclick = function () { opts.onConfirm(modal, readConflictPicks(doc, conflicts)); };
  return modal;
}

/**
 * 失败横幅该不该出现、原因写什么。
 * 连续失败 ≥2 次才提示；用户关掉之后 10 分钟内不再打扰。
 */
export function syncBannerView(state, now, quietMs) {
  const s = state || {};
  const streak = Number(s.failStreak) || 0;
  const dismissedAt = Number(s.bannerDismissedAt) || 0;
  const quietFor = quietMs === undefined ? 600000 : Number(quietMs) || 0;
  const quiet = (Number(now) || 0) - dismissedAt < quietFor;
  return {
    show: streak >= 2 && !quiet,
    reason: s.lastSyncError ? ('原因：' + s.lastSyncError + ' · 数据仅存本机') : '数据仅存本机，建议导出备份',
  };
}

/** 把横幅视图写进 DOM（原因只在要显示时才写，避免无谓改动）。 */
export function applySyncBanner(doc, view) {
  const el = doc.getElementById('syncFailBanner');
  if (!el) return false;
  if (view && view.show) {
    const reason = doc.getElementById('syncBannerReason');
    if (reason) reason.textContent = view.reason;
  }
  el.hidden = !(view && view.show);
  return true;
}

/**
 * 接上失败横幅的三个出口：重试（横幅上 + 同步面板里各一个）、导出备份、关闭。
 * 关闭后由这里负责隐藏并调用 onDismiss 记账（10 分钟免打扰）。
 */
export function bindSyncBanner(opts) {
  const doc = opts.doc;
  const el = doc.getElementById('syncFailBanner');
  if (!el) return false;
  const retry = doc.getElementById('syncBannerRetry');
  if (retry) {
    retry.addEventListener('click', function () {
      retry.disabled = true;
      retry.textContent = '重试中…';
      if (typeof opts.onRetry === 'function') opts.onRetry();
      setTimeout(function () {
        retry.disabled = false;
        retry.textContent = '重试';
      }, 4000);
    });
  }
  const exportBtn = doc.getElementById('syncBannerExport');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      if (typeof opts.onExport === 'function') opts.onExport();
    });
  }
  const close = doc.getElementById('syncBannerClose');
  if (close) {
    close.addEventListener('click', function () {
      if (typeof opts.onDismiss === 'function') opts.onDismiss();
      el.hidden = true;
    });
  }
  const panelRetry = doc.getElementById('syncRetryBtn');
  if (panelRetry) {
    panelRetry.addEventListener('click', function () {
      panelRetry.disabled = true;
      if (typeof opts.onRetry === 'function') opts.onRetry();
      setTimeout(function () {
        panelRetry.disabled = false;
      }, 4000);
    });
  }
  return true;
}

/**
 * v242：点「数据健康」任意一行 → 直达同步设置。
 * 移动端要注意：设置区会被搬到 body 上作为整屏面板，只开侧栏抽屉是看不到它的，
 * 所以要先点「设置」入口把它叫出来，再展开「云端同步」那一项。
 * desktopOpen 由调用方提供（那边还要打开设置抽屉并定位到同步面板）。
 */
export function bindHealthJump(opts) {
  const doc = opts.doc;
  const win = opts.win || null;
  const open = function (ev) {
    if (ev && ev.target && ev.target.closest && ev.target.closest('button')) return;
    const settingsSection = doc.querySelector('.sb-section.sb-settings');
    if (win && win.innerWidth <= 800) {
      /* 移动端：四个面板被 setupInlineQuickSettings 改成了"快捷菜单里的手风琴"，
         所以要按原生路径走：打开设置 → 点「云端同步」那一项把它展开。 */
      if (!settingsSection || !settingsSection.classList.contains('open')) {
        const entry = doc.getElementById('sbSettingsEntry');
        if (entry) entry.click();
      }
      const syncPanel = doc.getElementById('settingsSync');
      const wrap = syncPanel && syncPanel.closest ? syncPanel.closest('.quick-acc') : null;
      const accBtn = wrap && wrap.previousElementSibling;
      if (accBtn && wrap.hidden) accBtn.click();
      if (wrap) wrap.hidden = false;
    } else if (typeof opts.desktopOpen === 'function') {
      opts.desktopOpen();
    }
    const panel = doc.getElementById('syncPanel');
    if (panel) panel.classList.add('open');
  };
  const list = doc.querySelector('.sb-health-list');
  if (list) {
    list.style.cursor = 'pointer';
    list.addEventListener('click', open);
  }
  const head = doc.querySelector('.sb-section.sb-sync-summary h3');
  if (head) {
    head.style.cursor = 'pointer';
    head.title = '点这里打开同步设置';
    head.addEventListener('click', open);
  }
  return open;
}
