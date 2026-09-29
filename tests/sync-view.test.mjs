// 同步视图层的单测（v247 从 index.js 抽出）。
// 纯函数直接断言；碰 DOM 的用轻量假 doc，把"写哪一行、写什么类名/文字"钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_KEY_LABELS, formatHealthTime, healthTimeTitle, healthRowStatuses, applyHealthRows,
  syncBarAttrs, applySyncBar, syncClockText, conflictRowsHtml, conflictModalHtml, readConflictPicks,
  syncBannerView, applySyncBanner, bindSyncBanner,
} from '../src/app/sync-view.js';

/** 假元素：只要 classList / textContent / hidden / querySelector 够用就行。 */
function fakeEl(extra) {
  const classes = new Set();
  return Object.assign({
    className: '',
    textContent: '',
    hidden: true,
    title: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      has: (c) => classes.has(c),
      toggle() {},
      _all: () => Array.from(classes).sort(),
    },
  }, extra || {});
}

function fakeDoc(map) {
  const els = Object.assign({}, map);
  return {
    getElementById: (id) => (id in els ? els[id] : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    _el: (id) => els[id],
    _set: (id, el) => { els[id] = el; },
    body: fakeEl(),
  };
}

test('SYNC_KEY_LABELS：9 个同步键都有中文名', () => {
  assert.deepEqual(Object.keys(SYNC_KEY_LABELS).sort(), [
    'activities', 'cashBalance', 'cashLog', 'exit_portfolio', 'optionTrades',
    'otmSettings', 'state', 'trades', 'watchlist',
  ]);
  assert.equal(SYNC_KEY_LABELS.otmSettings, 'OTM百分比');
  assert.equal(SYNC_KEY_LABELS.watchlist, '观察列表');
});

test('formatHealthTime：0/空 显示空串，有值显示 月/日 时:分（不带年份）', () => {
  assert.equal(formatHealthTime(0), '');
  assert.equal(formatHealthTime(null), '');
  assert.equal(formatHealthTime(undefined), '');
  const text = formatHealthTime(Date.UTC(2026, 8, 29, 8, 7));
  assert.match(text, /^\d{1,2}\/\d{1,2}\s+\d{2}:\d{2}$/);
});

test('healthTimeTitle：0 显示空串，有值带年份（hover 用）', () => {
  assert.equal(healthTimeTitle(0), '');
  assert.match(healthTimeTitle(Date.UTC(2026, 8, 29, 8, 7)), /\d{4}/);
});

test('healthRowStatuses：未配置只给备份/冲突上色，云与推送保持无色', () => {
  const s = healthRowStatuses({ configured: false, conflictCount: 0 }, 0);
  assert.deepEqual(s, { cloud: '', backup: 'warn', push: '', conflict: 'ok' });
});

test('healthRowStatuses：配置后未同步过 → warn；同步过 → ok', () => {
  assert.equal(healthRowStatuses({ configured: true, pullAt: 0 }, 0).cloud, 'warn');
  assert.equal(healthRowStatuses({ configured: true, pullAt: 123 }, 0).cloud, 'ok');
  assert.equal(healthRowStatuses({ configured: true, pushAt: 0 }, 0).push, 'warn');
  assert.equal(healthRowStatuses({ configured: true, pushAt: 123 }, 0).push, 'ok');
});

test('healthRowStatuses：失败时间晚于该通道最近成功时间才报错', () => {
  const older = healthRowStatuses({ configured: true, failed: true, pullAt: 500, pushAt: 500 }, 400);
  assert.equal(older.cloud, 'ok', '失败发生在成功之前 → 之后已成功，不该报错');
  assert.equal(older.push, 'ok');
  const newer = healthRowStatuses({ configured: true, failed: true, pullAt: 100, pushAt: 100 }, 400);
  assert.equal(newer.cloud, 'error');
  assert.equal(newer.push, 'error');
});

test('healthRowStatuses：备份与冲突，冲突优先红', () => {
  assert.equal(healthRowStatuses({ backupAt: 0 }, 0).backup, 'warn');
  assert.equal(healthRowStatuses({ backupAt: 9 }, 0).backup, 'ok');
  assert.equal(healthRowStatuses({ conflictCount: 2 }, 0).conflict, 'error');
});

test('applyHealthRows：先清三种状态类再加当前的（不留残色）', () => {
  const doc = fakeDoc({
    sbCloudRow: fakeEl({ classList: null }),
    sbBackupRow: fakeEl({ classList: null }),
  });
  ['sbCloudRow', 'sbBackupRow'].forEach((id) => { doc._set(id, fakeEl()); });
  doc._el('sbCloudRow').classList.add('is-ok');
  applyHealthRows(doc, { cloud: 'error', backup: 'ok', push: 'warn', conflict: 'ok' });
  assert.deepEqual(doc._el('sbCloudRow').classList._all(), ['is-error']);
  assert.deepEqual(doc._el('sbBackupRow').classList._all(), ['is-ok']);
});

test('syncBarAttrs：三态的类名/图标/自动收起时长', () => {
  assert.deepEqual(syncBarAttrs(''), { className: 'sync-bar', icon: '', text: '', holdMs: 0 });
  assert.deepEqual(syncBarAttrs('ok', '已同步 16:07'), { className: 'sync-bar show is-ok', icon: '✓', text: '已同步 16:07', holdMs: 2200 });
  assert.equal(syncBarAttrs('err', '同步失败').holdMs, 8000);
  assert.equal(syncBarAttrs('err', '同步失败').icon, '!');
  assert.equal(syncBarAttrs('busy', '正在上传…').holdMs, 0, 'busy 不收，等结果');
  assert.equal(syncBarAttrs('busy', '正在上传…').icon, '');
});

test('applySyncBar：写类名/文字/图标，空 state 只复位类名不动文字', () => {
  const msg = fakeEl();
  const ic = fakeEl();
  const bar = fakeEl({ querySelector: (sel) => (sel === '.sync-bar-text' ? msg : sel === '.sb-ic' ? ic : null) });
  const doc = fakeDoc({ syncBar: bar });
  assert.deepEqual(applySyncBar(doc, 'ok', '已同步 16:07'), { applied: true, holdMs: 2200 });
  assert.equal(bar.className, 'sync-bar show is-ok');
  assert.equal(msg.textContent, '已同步 16:07');
  assert.equal(ic.textContent, '✓');
  msg.textContent = '旧文字';
  assert.deepEqual(applySyncBar(doc, '', ''), { applied: true, holdMs: 0 });
  assert.equal(bar.className, 'sync-bar');
  assert.equal(msg.textContent, '旧文字', '复位时不该动文字');
  assert.deepEqual(applySyncBar(fakeDoc({}), 'ok', 'x'), { applied: false, holdMs: 0 }, '没有状态条时安全返回');
});

test('syncClockText：输出 时:分', () => {
  assert.match(syncClockText(new Date(Date.UTC(2026, 8, 29, 8, 7))), /^\d{2}:\d{2}$/);
});

test('conflictRowsHtml：每个键一行，默认勾选保留本地，未知键回退键名', () => {
  const html = conflictRowsHtml(['trades', 'watchlist'], SYNC_KEY_LABELS);
  assert.equal((html.match(/name="cf_/g) || []).length, 4, '每个键两个同名 radio（保留本地 / 使用云端）');
  assert.equal((html.match(/name="cf_trades"/g) || []).length, 2);
  assert.match(html, /name="cf_trades"/);
  assert.match(html, /交易记录/);
  assert.match(html, /观察列表/);
  assert.equal((html.match(/value="local" checked/g) || []).length, 2, '默认都要勾"保留本地"');
  assert.match(conflictRowsHtml(['weird_key'], {}), />weird_key</);
  assert.equal(conflictRowsHtml([], {}), '');
  assert.equal(conflictRowsHtml(undefined, undefined), '');
});

test('conflictModalHtml：外壳含标题与两个按钮，行插在中间', () => {
  const html = conflictModalHtml('<i>ROWS</i>');
  assert.match(html, /数据冲突/);
  assert.match(html, /id="cfCancel"/);
  assert.match(html, /id="cfOk"/);
  assert.ok(html.indexOf('<i>ROWS</i>') > html.indexOf('数据冲突'), '行要在说明之后');
});

test('readConflictPicks：勾了云端才是 cloud，其余（含查不到）都算 local', () => {
  const doc = {
    querySelector: (sel) => (sel.indexOf('cf_trades') >= 0 ? { value: 'cloud' } : null),
  };
  assert.deepEqual(readConflictPicks(doc, ['trades', 'cashLog']), { trades: 'cloud', cashLog: 'local' });
  assert.deepEqual(readConflictPicks({ querySelector: () => null }, ['trades']), { trades: 'local' });
  assert.deepEqual(readConflictPicks({}, undefined), {});
});

test('syncBannerView：连续失败 ≥2 次才提示，关掉后 10 分钟内不再打扰', () => {
  const now = 1_700_000_000_000;
  assert.equal(syncBannerView({ failStreak: 1 }, now).show, false);
  const shown = syncBannerView({ failStreak: 2 }, now);
  assert.equal(shown.show, true);
  assert.equal(shown.reason, '数据仅存本机，建议导出备份');
  const withErr = syncBannerView({ failStreak: 3, lastSyncError: 'HTTP 500' }, now);
  assert.match(withErr.reason, /^原因：HTTP 500/);
  assert.equal(syncBannerView({ failStreak: 3, bannerDismissedAt: now - 1000 }, now).show, false, '刚关掉要安静');
  assert.equal(syncBannerView({ failStreak: 3, bannerDismissedAt: now - 11 * 60 * 1000 }, now).show, true, '过了 10 分钟可以再提示');
  assert.equal(syncBannerView(null, now).show, false, '坏数据不炸');
});

test('applySyncBanner：按 view.show 显隐，显示时才写原因', () => {
  const reason = fakeEl();
  const banner = fakeEl({ hidden: false });
  const doc = fakeDoc({ syncFailBanner: banner, syncBannerReason: reason });
  applySyncBanner(doc, { show: false, reason: '不该写' });
  assert.equal(banner.hidden, true);
  assert.equal(reason.textContent, '');
  applySyncBanner(doc, { show: true, reason: '原因：HTTP 500 · 数据仅存本机' });
  assert.equal(banner.hidden, false);
  assert.match(reason.textContent, /HTTP 500/);
  assert.equal(applySyncBanner(fakeDoc({}), { show: true }), false, '没有横幅时安全返回');
});

test('bindSyncBanner：四个出口都接上（缺元素就跳过）', () => {
  const handlers = {};
  const btn = (name) => fakeEl({ addEventListener: (ev, fn) => { handlers[name] = fn; } });
  const doc = fakeDoc({
    syncFailBanner: fakeEl({ hidden: false }),
    syncBannerRetry: btn('retry'),
    syncBannerExport: btn('export'),
    syncBannerClose: btn('close'),
    syncRetryBtn: btn('panelRetry'),
  });
  let retried = 0;
  let exported = 0;
  let dismissed = 0;
  assert.equal(bindSyncBanner({ doc, onRetry: () => { retried += 1; }, onExport: () => { exported += 1; }, onDismiss: () => { dismissed += 1; } }), true);
  handlers.retry();
  handlers.panelRetry();
  handlers.export();
  handlers.close();
  assert.equal(retried, 2, '横幅与面板上的重试走同一个回调');
  assert.equal(exported, 1);
  assert.equal(dismissed, 1);
  assert.equal(doc._el('syncFailBanner').hidden, true, '关闭要立刻收起横幅');
  assert.equal(bindSyncBanner({ doc: fakeDoc({}) }), false, '没有横幅时安全返回');
});
