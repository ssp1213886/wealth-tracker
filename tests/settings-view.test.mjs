// 设置/主题/配色视图层的单测（v248 从 index.js 抽出）。
// 纯函数直接断言；碰 DOM 的用一个极简假环境（document/window/localStorage），
// 把"写了哪些类名、哪些 aria、存了哪个键"钉住——这些正是用户能看见的行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureSettingsView, resolveDarkTheme, flipTheme, themeMetaColor, themeLabel, hapticPattern,
  updateThemeMeta, toggleTheme, loadTheme, setAccent, loadAccent,
  setMobileSettings, openMobileSettings, togglePrivacy, placeSettingsPanel,
} from '../src/app/settings-view.js';
import { KEYS } from '../src/app/store.js';

const THEME_KEY = KEYS.dashboard + '_theme';
const ACCENT_KEY = KEYS.dashboard + '_accent';

function makeEl(extra) {
  const classes = new Set();
  return Object.assign({
    className: '',
    textContent: '',
    title: '',
    hidden: false,
    dataset: {},
    style: { setProperty() {}, left: '' },
    attrs: {},
    children: [],
    parentElement: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
      _all: () => Array.from(classes).sort(),
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    querySelector() { return null; },
    closest() { return null; },
  }, extra || {});
}

/** 暂时替换全局环境，跑完还原（node --test 同一文件内顺序执行，不会互相干扰）。 */
function withEnv(els, opts, fn) {
  const store = Object.assign({}, opts && opts.storage);
  const doc = {
    documentElement: makeEl({ dataset: {} }),
    body: makeEl(),
    getElementById: (id) => (id in els ? els[id] : null),
    querySelector: (sel) => ((opts && opts.query && opts.query[sel]) || els['@' + sel] || null),
    querySelectorAll: (sel) => ((opts && opts.queryAll && opts.queryAll[sel]) || []),
    createElement: () => makeEl(),
    addEventListener() {},
    activeElement: { blur() {} },
  };
  const win = {
    innerWidth: (opts && opts.width) || 390,
    matchMedia: (q) => ({ matches: !!(opts && opts.prefersDark), media: q }),
  };
  const nav = { vibrate: (opts && opts.vibrate) || function () {} };
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // Node 里 navigator 是只读 getter，所以统一走属性描述符覆盖/还原
  const GLOBALS = ['document', 'window', 'navigator', 'localStorage'];
  const saved = {};
  GLOBALS.forEach((key) => { saved[key] = Object.getOwnPropertyDescriptor(globalThis, key); });
  const put = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  put('document', doc);
  put('window', win);
  put('navigator', nav);
  put('localStorage', ls);
  try {
    return fn({ doc, win, nav, store });
  } finally {
    GLOBALS.forEach((key) => {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    });
  }
}

test('resolveDarkTheme：dark/light 直给，其余（含 system、空）跟随系统', () => {
  assert.equal(resolveDarkTheme('dark', false), true);
  assert.equal(resolveDarkTheme('light', true), false);
  assert.equal(resolveDarkTheme('system', true), true);
  assert.equal(resolveDarkTheme('system', false), false);
  assert.equal(resolveDarkTheme(null, true), true);
  assert.equal(resolveDarkTheme(undefined, false), false);
});

test('flipTheme：只认 dark，其余一律变 dark', () => {
  assert.equal(flipTheme('dark'), 'light');
  assert.equal(flipTheme('light'), 'dark');
  assert.equal(flipTheme(undefined), 'dark');
});

test('主题元信息文案与状态栏配色', () => {
  assert.equal(themeMetaColor(true), '#000000');
  assert.equal(themeMetaColor(false), '#f5f6f3');
  assert.equal(themeLabel(true), '深色模式');
  assert.equal(themeLabel(false), '浅色模式');
});

test('hapticPattern：六档节奏，未知的一律 light(8)', () => {
  assert.equal(hapticPattern('light'), 8);
  assert.equal(hapticPattern('medium'), 16);
  assert.equal(hapticPattern('heavy'), 26);
  assert.deepEqual(hapticPattern('warning'), [14, 60, 14]);
  assert.deepEqual(hapticPattern('success'), [10, 40, 10]);
  assert.deepEqual(hapticPattern('danger'), [18, 70, 18]);
  assert.equal(hapticPattern('不认识'), 8);
});

test('updateThemeMeta：按当前主题写 meta 配色与桌面按钮文案', () => {
  const meta = makeEl();
  const label = makeEl();
  withEnv({ desktopThemeLabel: label }, { query: { 'meta[name="theme-color"]': meta } }, ({ doc }) => {
    doc.documentElement.dataset.theme = 'dark';
    updateThemeMeta();
    assert.equal(meta.content, '#000000');
    assert.equal(label.textContent, '深色模式');
    doc.documentElement.dataset.theme = 'light';
    updateThemeMeta();
    assert.equal(meta.content, '#f5f6f3');
    assert.equal(label.textContent, '浅色模式');
  });
});

test('toggleTheme：翻转主题、写 key、并让调色板重绘', () => {
  let refreshed = 0;
  configureSettingsView({ refreshVisualPalette: () => { refreshed += 1; } });
  withEnv({}, {}, ({ doc, store }) => {
    doc.documentElement.dataset.theme = 'light';
    toggleTheme();
    assert.equal(doc.documentElement.dataset.theme, 'dark');
    assert.equal(store[THEME_KEY], 'dark', '选中的主题要落库（下次打开还记得）');
    assert.equal(refreshed, 1, '切换后要重绘持仓与侧边栏');
    toggleTheme();
    assert.equal(doc.documentElement.dataset.theme, 'light');
    assert.equal(store[THEME_KEY], 'light');
    assert.equal(refreshed, 2);
  });
});

test('loadTheme：存了就用存的，没存跟随系统', () => {
  withEnv({}, { storage: { [THEME_KEY]: 'light' }, prefersDark: true }, ({ doc }) => {
    loadTheme();
    assert.equal(doc.documentElement.dataset.theme, 'light', '显式选过浅色就不该被系统盖掉');
  });
  withEnv({}, { prefersDark: true }, ({ doc }) => {
    loadTheme();
    assert.equal(doc.documentElement.dataset.theme, 'dark');
  });
  withEnv({}, { storage: { [THEME_KEY]: 'dark' }, prefersDark: false }, ({ doc }) => {
    loadTheme();
    assert.equal(doc.documentElement.dataset.theme, 'dark', '存了 dark 就按 dark');
  });
});

test('setAccent：写 dataset、点亮圆点、落库并重绘', () => {
  let refreshed = 0;
  configureSettingsView({ refreshVisualPalette: () => { refreshed += 1; } });
  const dots = ['forest', 'ocean'].map((name) => makeEl({ dataset: { accent: name } }));
  withEnv({}, { queryAll: { '.accent-dot': dots } }, ({ doc, store }) => {
    setAccent('ocean');
    assert.equal(doc.documentElement.dataset.accent, 'ocean');
    assert.deepEqual(dots[0].classList._all(), []);
    assert.deepEqual(dots[1].classList._all(), ['active'], '只有当前配色那颗点亮');
    assert.equal(store[ACCENT_KEY], 'ocean');
    assert.equal(refreshed, 1);
  });
});

test('loadAccent：没存过就不动 DOM（用默认配色）', () => {
  const dots = [makeEl({ dataset: { accent: 'forest' } })];
  withEnv({}, { queryAll: { '.accent-dot': dots } }, ({ doc }) => {
    loadAccent();
    assert.equal(doc.documentElement.dataset.accent, undefined);
    assert.deepEqual(dots[0].classList._all(), []);
  });
  withEnv({}, { storage: { [ACCENT_KEY]: 'forest' }, queryAll: { '.accent-dot': dots } }, ({ doc }) => {
    loadAccent();
    assert.equal(doc.documentElement.dataset.accent, 'forest');
    assert.deepEqual(dots[0].classList._all(), ['active']);
  });
});

test('setMobileSettings：开抽屉会同步 body/遮罩/汉堡按钮的 aria 与文案', () => {
  const sb = makeEl();
  const ov = makeEl();
  const hb = makeEl();
  withEnv({ sbOverlay: ov, mobHamburger: hb }, { query: { '.sidebar': sb }, width: 390 }, ({ doc }) => {
    setMobileSettings(true);
    assert.deepEqual(sb.classList._all(), ['open']);
    assert.deepEqual(doc.body.classList._all(), ['drawer-open']);
    assert.deepEqual(ov.classList._all(), ['show']);
    assert.equal(hb.getAttribute('aria-expanded'), 'true');
    assert.equal(hb.getAttribute('aria-label'), '关闭设置');
    assert.equal(hb.title, '关闭设置');
    assert.equal(sb.getAttribute('aria-hidden'), 'false');
    setMobileSettings(false);
    assert.deepEqual(sb.classList._all(), []);
    assert.deepEqual(doc.body.classList._all(), []);
    assert.deepEqual(ov.classList._all(), []);
    assert.equal(hb.getAttribute('aria-expanded'), 'false');
    assert.equal(hb.getAttribute('aria-label'), '打开设置');
    assert.equal(sb.getAttribute('aria-hidden'), 'true');
  });
});

test('setMobileSettings：桌面上不改 aria-hidden；没有侧栏时安全返回', () => {
  const sb = makeEl();
  withEnv({}, { query: { '.sidebar': sb }, width: 1280 }, () => {
    setMobileSettings(true);
    assert.equal(sb.getAttribute('aria-hidden'), null, '桌面端侧栏本来就在，不该被藏'); 
  });
  withEnv({}, { query: {} }, () => {
    assert.doesNotThrow(() => setMobileSettings(true));
  });
});

test('openMobileSettings：窄屏直接开抽屉，宽屏改为点桌面折叠按钮', () => {
  const sb = makeEl();
  withEnv({}, { query: { '.sidebar': sb }, width: 390 }, () => {
    openMobileSettings();
    assert.deepEqual(sb.classList._all(), ['open']);
  });
  let clicked = 0;
  const toggle = { click() { clicked += 1; } };
  withEnv({ sidebarToggle: toggle }, { query: {}, width: 1280 }, () => {
    openMobileSettings();
    assert.equal(clicked, 1);
  });
});

test('placeSettingsPanel：窄屏搬到 body 并给 id，宽屏放回侧栏并收遮罩', () => {
  const sec = makeEl();
  const sidebar = makeEl();
  const overlay = makeEl();
  overlay.classList.add('show');
  const query = { '.sb-section.sb-settings': sec, '.sidebar': sidebar };
  withEnv({ sbSettingsOverlay: overlay }, { query }, ({ doc }) => {
    placeSettingsPanel(true);
    assert.equal(sec.parentElement, doc.body);
    assert.equal(sec.getAttribute('id'), 'settingsDrawerInner');
    placeSettingsPanel(false);
    assert.equal(sec.parentElement, sidebar, '回桌面要放回侧栏');
    assert.deepEqual(overlay.classList._all(), [], '宽屏要把遮罩收掉');
    assert.deepEqual(sec.classList._all(), []);
  });
});

test('togglePrivacy：给 body 切 privacy-mode', () => {
  withEnv({}, {}, ({ doc }) => {
    togglePrivacy();
    assert.deepEqual(doc.body.classList._all(), ['privacy-mode']);
    togglePrivacy();
    assert.deepEqual(doc.body.classList._all(), []);
  });
});
