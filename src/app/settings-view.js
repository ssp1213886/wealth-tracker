// 设置面板 / 主题 / 配色的视图层：移动端整屏设置抽屉、桌面设置面板搬移、
// 内联快捷设置、主题与配色切换、侧栏折叠、触感反馈。
// 纯逻辑（面板映射、同步配置解析、数据健康文案）在 settings.js；这里只碰 DOM。
// v248 从 index.js 抽出（行为完全一致）。

import { KEYS, readRaw } from './store.js';
import { SETTINGS_PANEL_IDS, SETTINGS_FOCUS_IDS } from './settings.js';
import { logSwallowed } from './util.js';

const LSKEY = KEYS.dashboard;
const THEME_KEY = LSKEY + '_theme';
const ACCENT_KEY = LSKEY + '_accent';
const SIDEBAR_KEY = LSKEY + '_sidebar';

/* 主题 / 配色切换后需要重绘（持仓与侧边栏都跟着配色变），由 index.js 注入。 */
let refreshVisualPalette = function () {};

export function configureSettingsView(deps) {
  const d = deps || {};
  if (typeof d.refreshVisualPalette === 'function') refreshVisualPalette = d.refreshVisualPalette;
}

/* ---------------- 纯函数（可离线单测） ---------------- */

/** 主题键 → 是否深色。'dark'/'light' 直接决定，其余（含 'system'、空）跟随系统。 */
export function resolveDarkTheme(raw, prefersDark) {
  if (raw === 'dark') return true;
  if (raw === 'light') return false;
  return !!prefersDark;
}

/** 点击主题按钮时翻转当前主题（只看 DOM 上的现值，与旧实现一致）。 */
export function flipTheme(current) {
  return current === 'dark' ? 'light' : 'dark';
}

/** 地址栏 / 状态栏配色。 */
export function themeMetaColor(dark) {
  return dark ? '#000000' : '#f5f6f3';
}

/** 桌面端主题按钮上的文字。 */
export function themeLabel(dark) {
  return dark ? '深色模式' : '浅色模式';
}

/** 触感强度表（毫秒；warning/success/danger 是震动节奏数组）。没登记的一律 light。 */
const HAPTIC_PATTERNS = { light: 8, medium: 16, heavy: 26, warning: [14, 60, 14], success: [10, 40, 10], danger: [18, 70, 18] };

export function hapticPattern(kind) {
  const v = HAPTIC_PATTERNS[kind];
  return v === undefined ? 8 : v;
}

/* ---------------- 主题 ---------------- */

export function updateThemeMeta() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  const label = document.getElementById('desktopThemeLabel');
  if (meta) meta.content = themeMetaColor(dark);
  if (label) label.textContent = themeLabel(dark);
}

export function toggleTheme() {
  const h = document.documentElement;
  h.dataset.theme = flipTheme(h.dataset.theme);
  updateThemeMeta();
  refreshVisualPalette();
  try {
    localStorage.setItem(THEME_KEY, h.dataset.theme);
  } catch (e) {
    logSwallowed('toggleTheme', e);
  }
  setTimeout(function () {
    try { document.activeElement.blur(); } catch (e) { logSwallowed('toggleTheme', e); }
  }, 0);
}

export function loadTheme() {
  try {
    const t = readRaw(THEME_KEY);
    const dark = resolveDarkTheme(t, window.matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    updateThemeMeta();
  } catch (e) {
    logSwallowed('loadTheme', e);
  }
}

/* ---------------- 配色 ---------------- */

export function setAccent(name) {
  document.documentElement.dataset.accent = name;
  document.querySelectorAll('.accent-dot').forEach(function (d) { d.classList.toggle('active', d.dataset.accent === name); });
  refreshVisualPalette();
  try {
    localStorage.setItem(ACCENT_KEY, name);
  } catch (e) {
    logSwallowed('setAccent', e);
  }
}

export function loadAccent() {
  try {
    const a = readRaw(ACCENT_KEY);
    if (a) {
      document.documentElement.dataset.accent = a;
      document.querySelectorAll('.accent-dot').forEach(function (d) { d.classList.toggle('active', d.dataset.accent === a); });
    }
  } catch (e) {
    logSwallowed('loadAccent', e);
  }
}

/* ---------------- 抽屉与面板 ---------------- */

export function setMobileSettings(open) {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sbOverlay');
  const hb = document.getElementById('mobHamburger');
  const isOpen = !!open;
  if (!sb) return;
  sb.classList.toggle('open', isOpen);
  document.body.classList.toggle('drawer-open', isOpen);
  if (ov) ov.classList.toggle('show', isOpen);
  if (hb) {
    hb.classList.toggle('sidebar-close', isOpen);
    hb.setAttribute('aria-expanded', String(isOpen));
    hb.setAttribute('aria-label', isOpen ? '关闭设置' : '打开设置');
    hb.title = isOpen ? '关闭设置' : '打开设置';
  }
  if (window.innerWidth <= 800) sb.setAttribute('aria-hidden', String(!isOpen));
}

export function openMobileSettings() {
  if (window.innerWidth <= 800) { setMobileSettings(true); return; }
  const btn = document.getElementById('sidebarToggle');
  if (btn) btn.click();
}

export function togglePrivacy() {
  document.body.classList.toggle('privacy-mode');
}

export function openAdvancedSettings(section) {
  const details = document.querySelector('.advanced-settings');
  if (!details) return;
  details.open = true;
  const panels = {};
  const panelId = SETTINGS_PANEL_IDS[section];
  if (panelId) panels[section] = document.getElementById(panelId);
  const panel = panels[section] || details;
  const targetId = SETTINGS_FOCUS_IDS[section];
  const target = targetId ? document.getElementById(targetId) : panel;
  if (section === 'sync') {
    const sync = document.getElementById('syncPanel');
    if (sync) sync.classList.add('open');
  }
  document.querySelectorAll('.settings-panel.is-highlighted').forEach(function (el) { el.classList.remove('is-highlighted'); });
  if (panel.classList) panel.classList.add('is-highlighted');
  setTimeout(function () {
    const scroller = panel.closest('.sb-section.sb-settings') || panel.closest('.sidebar');
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const next = scroller.scrollTop + (pr.top - sr.top) - 64;
      scroller.scrollTo({ top: Math.max(0, next), behavior: 'smooth' });
    } else {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (target && typeof target.focus === 'function' && (section === 'price' || section === 'preferences')) target.focus({ preventScroll: true });
    setTimeout(function () {
      if (panel.classList) panel.classList.remove('is-highlighted');
    }, 900);
  }, 240);
}

/**
 * 设置区在手机上要被搬到 body 上做整屏面板，回桌面再放回侧栏。
 * 搬过去时给它一个固定 id（#settingsDrawerInner），样式与"点数据健康直达"都依赖它。
 */
export function placeSettingsPanel(mobile) {
  const sec = document.querySelector('.sb-section.sb-settings');
  if (!sec) return;
  const wantMobile = typeof mobile === 'boolean' ? mobile : window.matchMedia('(max-width:800px)').matches;
  if (wantMobile) {
    if (sec.parentElement !== document.body) document.body.appendChild(sec);
    sec.setAttribute('id', 'settingsDrawerInner');
  } else {
    if (sec.parentElement === document.body) {
      const host = document.querySelector('.sidebar');
      if (host) host.appendChild(sec);
    }
    const s = document.getElementById('sbSettingsOverlay');
    if (s) s.classList.remove('show');
    sec.classList.remove('open');
  }
}

export function syncSettingsPanelPlacement() {
  placeSettingsPanel(window.matchMedia('(max-width:800px)').matches);
}

export function initMobileSettingsDrawer() {
  const entry = document.getElementById('sbSettingsEntry');
  if (!entry) return;
  let overlay = null;
  const panelHead = document.getElementById('sbSettingsBack');
  function panel() { return document.querySelector('.sb-section.sb-settings'); }
  function ensureOverlay() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sb-overlay';
      overlay.id = 'sbSettingsOverlay';
      overlay.addEventListener('click', function () { close(); });
      document.body.appendChild(overlay);
    }
    return overlay;
  }
  function open() {
    placeSettingsPanel(true);
    const sec = panel();
    if (!sec) return;
    sec.classList.add('open');
    entry.setAttribute('aria-expanded', 'true');
    setMobileSettings(false);
    const ov = ensureOverlay();
    requestAnimationFrame(function () { ov.classList.add('show'); });
  }
  function close() {
    const sec = panel();
    if (sec) sec.classList.remove('open');
    entry.setAttribute('aria-expanded', 'false');
    if (overlay) overlay.classList.remove('show');
  }
  entry.addEventListener('click', open);
  if (panelHead) panelHead.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const sec = panel();
      if (sec && sec.classList.contains('open')) { e.preventDefault(); close(); }
    }
  });
}

/**
 * 手机端把「设置」里的四个面板搬成快捷菜单里的手风琴（<details> 那套本来就是给桌面用的）。
 * 只在窄屏做，且每个菜单只做一次（dataset.inlineReady 打标）。
 */
export function setupInlineQuickSettings() {
  if (!window.matchMedia('(max-width:800px)').matches) return;
  const menu = document.querySelector('.sb-quick-menu');
  if (!menu || menu.dataset.inlineReady) return;
  menu.dataset.inlineReady = '1';
  const map = [['price', SETTINGS_PANEL_IDS.price], ['sync', SETTINGS_PANEL_IDS.sync], ['data', SETTINGS_PANEL_IDS.data], ['preferences', SETTINGS_PANEL_IDS.preferences]];
  map.forEach(function (pair) {
    const key = pair[0];
    const id = pair[1];
    const btn = menu.querySelector('button[onclick*="' + key + '"]');
    const sec = document.getElementById(id);
    if (!btn || !sec) return;
    const wrap = document.createElement('div');
    wrap.className = 'quick-acc';
    wrap.hidden = true;
    wrap.appendChild(sec);
    btn.insertAdjacentElement('afterend', wrap);
    btn.removeAttribute('onclick');
    btn.style.setProperty('padding-left', '0');
    btn.addEventListener('click', function () {
      const wasOpen = !wrap.hidden;
      menu.querySelectorAll('.quick-acc').forEach(function (w) { w.hidden = true; });
      menu.querySelectorAll('button').forEach(function (b) { b.classList.remove('is-open'); });
      if (!wasOpen) {
        wrap.hidden = false;
        btn.classList.add('is-open');
      }
    });
  });
  const details = document.querySelector('.advanced-settings');
  if (details) {
    const body = details.querySelector('.advanced-settings-body');
    if (body && !body.querySelector('.settings-panel')) details.remove();
  }
}

/* ---------------- 触感 ---------------- */

export function haptic(kind) {
  try {
    if (!navigator || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(hapticPattern(kind));
  } catch (e) {
    logSwallowed('haptic', e);
  }
}

export function initHaptics() {
  document.addEventListener('click', function (e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-haptic],.btn,.bb-btn,.qa-fab,.qa-item,.accent-dot,.theme-btn,.toggle-wrap,.segment,.record-seg,.trade-del,.sb-quick-menu button,.ds-approval-btn,.sync-retry') : null;
    if (!t) return;
    const k = t.getAttribute('data-haptic') || 'light';
    haptic(k);
  }, true);
}

/* ---------------- 启动接线（保持原来的执行顺序） ---------------- */

/**
 * 主题 / 配色 / 侧栏 / 抽屉的第一批绑定。
 * 顺序与 v247 的 index.js 一致：主题 → 配色 → 侧栏折叠 → 折叠状态恢复 → 移动端抽屉开合。
 */
export function bindShellControls() {
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', function (e) {
    const t = readRaw(THEME_KEY);
    if (!t || t === 'system') {
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
      updateThemeMeta();
      refreshVisualPalette();
    }
  });
  document.getElementById('accentDots').addEventListener('click', function (e) {
    const dot = e.target.closest('.accent-dot');
    if (!dot) return;
    setAccent(dot.dataset.accent);
  });
  document.getElementById('sidebarToggle').addEventListener('click', function () {
    const sb = document.querySelector('.sidebar');
    sb.classList.toggle('collapsed');
    const btn = document.getElementById('sidebarToggle');
    const arrow = btn.querySelector('.arrow');
    if (sb.classList.contains('collapsed')) {
      arrow.textContent = '▶';
      btn.style.left = '6px';
      this.title = '展开侧边栏';
    } else {
      arrow.textContent = '◀';
      btn.style.left = '266px';
      this.title = '收起侧边栏';
    }
    try {
      localStorage.setItem(SIDEBAR_KEY, sb.classList.contains('collapsed') ? '1' : '0');
    } catch (e) {
      logSwallowed('setAccent', e);   // 标签沿用原实现（历史笔误，另行处理）
    }
  });
  try {
    if (readRaw(SIDEBAR_KEY) === '1') {
      const sb = document.querySelector('.sidebar');
      sb.classList.add('collapsed');
      const a = document.querySelector('.sidebar-toggle .arrow');
      if (a) a.textContent = '▶';
      const btn = document.getElementById('sidebarToggle');
      if (btn) btn.style.left = '6px';
    }
  } catch (e) {
    logSwallowed('setAccent', e);   // 同上
  }
  document.getElementById('mobHamburger').addEventListener('click', function () {
    setMobileSettings(!document.querySelector('.sidebar').classList.contains('open'));
  });
  document.getElementById('sbOverlay').addEventListener('click', function () { setMobileSettings(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.sidebar.open')) setMobileSettings(false);
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 800 && document.querySelector('.sidebar.open')) setMobileSettings(false);
  });
}

/** 设置面板的搬移 + 整屏抽屉 + 手机端手风琴（含各自的启动时机）。 */
export function bindSettingsPanel() {
  const boot = function () {
    syncSettingsPanelPlacement();
    initMobileSettingsDrawer();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    document.addEventListener('DOMContentLoaded', setupInlineQuickSettings);
  } else {
    boot();
    setupInlineQuickSettings();
  }
  window.addEventListener('resize', function () { syncSettingsPanelPlacement(); });
}

/** 触感委托（capture 阶段，先于业务点击处理）。 */
export function bindHaptics() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHaptics);
  } else {
    initHaptics();
  }
}
