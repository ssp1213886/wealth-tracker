// 待办提醒：只保留与长期定投有关的低频提醒。
// 期权、行权、均线穿越提醒已随期权模块一起移除。

import { removeKey } from './store.js';
import { marketDate } from './time.js';
import { fmtFull, fmtNativeFull, logSwallowed } from './util.js';
import { emptyStateHTML, renderAlertItem, alertSignature } from './render.js';

const ALERT_SEVERITY_SCORE = { critical: 4, high: 3, medium: 2, low: 1 };
let currentAlerts = [];
let alertSeenSig = '';

function normalizeAlerts(alerts) {
  const byId = {};
  (alerts || []).forEach((alert) => {
    if (!alert || !alert.id) return;
    const current = byId[alert.id];
    const score = ALERT_SEVERITY_SCORE[alert.severity] || 0;
    if (!current || score > (ALERT_SEVERITY_SCORE[current.severity] || 0)) byId[alert.id] = alert;
  });
  return Object.keys(byId).map((id) => byId[id]).sort((a, b) => (
    (ALERT_SEVERITY_SCORE[b.severity] || 0) - (ALERT_SEVERITY_SCORE[a.severity] || 0) ||
    String(a.title).localeCompare(String(b.title), 'zh-CN')
  ));
}

function loadAlertSeen() {
  return alertSeenSig;
}

function markAlertsSeen(sig) {
  alertSeenSig = String(sig || '');
  try { removeKey('wealth_alert_seen_v1'); } catch (error) { logSwallowed('markAlertsSeen', error); }
}

function updateBellBadge(list) {
  const bell = document.querySelector('.ms-bell');
  if (!bell) return;
  const items = list || [];
  const count = badgeCountOf(items);
  const sig = alertSignature(items);
  const unseen = count > 0 && sig !== loadAlertSeen();
  const critical = items.some((alert) => alert && alert.severity === 'critical');
  bell.classList.toggle('has-alerts', unseen);
  bell.classList.toggle('has-critical', unseen && critical);
  let badge = bell.querySelector('.ms-bell-badge');
  if (unseen) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ms-bell-badge';
      badge.setAttribute('aria-hidden', 'true');
      bell.appendChild(badge);
      bell.classList.add('bell-ping');
      setTimeout(() => bell.classList.remove('bell-ping'), 1300);
    }
    badge.textContent = count > 9 ? '9+' : String(count);
  } else if (badge) {
    badge.remove();
  }
  bell.setAttribute('aria-label', count > 0 ? '查看提醒，' + count + ' 条待办' : '查看提醒');
}

export function badgeCountOf(alerts) {
  return (alerts || []).filter(Boolean).length;
}

export function badgeSupported(nav) {
  try { return !!(nav && typeof nav.setAppBadge === 'function'); } catch (error) { return false; }
}

export function applyAppBadge(nav, count) {
  try {
    if (!badgeSupported(nav)) return false;
    const n = Number(count) || 0;
    let promise;
    if (n > 0) promise = nav.setAppBadge(n);
    else if (typeof nav.clearAppBadge === 'function') promise = nav.clearAppBadge();
    else promise = nav.setAppBadge(0);
    if (promise && typeof promise.catch === 'function') promise.catch((error) => logSwallowed('applyAppBadge', error));
    return true;
  } catch (error) {
    logSwallowed('applyAppBadge', error);
    return false;
  }
}

export function getCurrentAlerts() {
  return currentAlerts;
}

const alertIcons = {
  orange: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>',
  red: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v5M12 17.5v.5"/></svg>',
  accent: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/><path d="m14 10 6-6"/></svg>',
  blue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 9 12l4 3 7-8"/><path d="M15 7h5v5"/></svg>',
};

/** 仅保留月度定投差额提醒。 */
export function buildAlerts(ctx) {
  const alerts = [];
  const now = marketDate(ctx.now).slice(0, 7);
  const trades = Array.isArray(ctx.trades) ? ctx.trades : [];
  const state = ctx.state || {};
  const monthBuys = trades.filter((trade) => trade.date.slice(0, 7) === now && trade.shares > 0);
  const buyTotal = monthBuys.reduce((sum, trade) => sum + trade.price * Math.abs(trade.shares), 0);
  const dcaTarget = state.dcaOverride && state.dcaOverride.month === now
    ? state.dcaOverride.amount
    : state.monthlyDCA;
  if (dcaTarget && buyTotal < dcaTarget * 0.9) {
    const gap = dcaTarget - buyTotal;
    alerts.push({
      id: 'dca:' + now,
      type: 'accent',
      severity: 'low',
      title: '本月定投还差 ' + fmtNativeFull(gap),
      detail: '在券商成交后批量记录',
      action: 'dca',
    });
  }
  return alerts;
}

export function renderAlerts(doc, alerts) {
  const container = doc.getElementById('qaAlerts');
  const mobile = doc.getElementById('mobileAlerts');
  const meta = doc.getElementById('mobileAlertMeta');
  const normalized = normalizeAlerts(alerts);
  currentAlerts = normalized;
  updateBellBadge(normalized);
  const buttons = normalized.map((alert) => renderAlertItem(alert, alertIcons)).join('');
  if (container) container.innerHTML = normalized.length
    ? '<div class="qa-alert-title"><span>待办事项 · 风险优先</span></div>' + buttons
    : '';
  if (mobile) mobile.innerHTML = normalized.length
    ? buttons
    : emptyStateHTML({ title: '暂无待办', hint: '纪律执行正常，继续保持', compact: true });
  if (meta) meta.textContent = normalized.length ? normalized.length + '项 · 风险优先' : '风险优先';
}

export {
  ALERT_SEVERITY_SCORE,
  normalizeAlerts,
  markAlertsSeen,
  loadAlertSeen,
  updateBellBadge,
};
