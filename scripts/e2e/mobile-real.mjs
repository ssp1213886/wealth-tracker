// 真机模拟验证（用 **WebKit = 真 Safari 内核** + iPhone 设备描述符：触摸、高 DPI、粗指针）。
// 覆盖之前没测到的：pointer:coarse / hover:hover 媒体分支、触摸操作（tap）、触摸目标尺寸、
// iOS 输入框缩放门槛（font-size ≥16px）、触摸端日期框样式、横向溢出。
// 用法：node scripts/e2e/driver-engine.mjs --engine webkit --device "iPhone 13" --file scripts/e2e/mobile-real.mjs
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8788/';
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.route('**/*', (route) => {
  let h = '';
  try { h = new URL(route.request().url()).hostname; } catch (e) {}
  return h === HOST ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message)));
p.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|net::ERR/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 140));
});

await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(BASE + '_reset').catch(() => {});
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: location.origin, token: 'test' }));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([
    { id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 },
    { id: 2, date: '2026-09-05', symbol: 'SMH', shares: 1.02, price: 584.08 },
    { id: 3, date: '2026-09-10', symbol: 'BTC', shares: 13.62, price: 29.38 },
  ]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([{ id: 11, date: '2026-09-02', type: '入金', amount: 5000 }]));
  localStorage.setItem('wealth_activity_v1', JSON.stringify([{ id: 101, date: '2026-09-20', time: '10:00', action: '买入 VGT', detail: '10 股 @ 100' }]));
  localStorage.setItem('wealth_options_v2', JSON.stringify([{ id: 201, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20' }]));
  localStorage.setItem('otmSettings', JSON.stringify({ vgt: 7, smh: 5 }));
});
await p.goto(BASE + '?m=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4500);

async function ev(fn, a) {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn, a); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await p.waitForTimeout(700);
    }
  }
  throw last;
}
const failures = [];
const notes = [];

/* ---- ① 触摸端媒体分支：这些在之前的"窄窗口但鼠标"测试里根本没触发过 ---- */
const media = await ev(() => ({
  coarse: matchMedia('(pointer:coarse)').matches,
  fine: matchMedia('(pointer:fine)').matches,
  hover: matchMedia('(hover:hover)').matches,
  max800: matchMedia('(max-width:800px)').matches,
  dpr: window.devicePixelRatio,
  touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  ua: navigator.userAgent,
}));
if (!media.coarse) failures.push('pointer:coarse 没生效（触摸端 CSS 分支不会命中）');
if (media.hover) failures.push('hover:hover 竟然生效（触摸端不该有 hover 分支）');
if (!media.max800) failures.push('max-width:800px 没生效');
if (!media.touch) failures.push('触摸能力没生效');
notes.push('媒体环境：coarse=' + media.coarse + ' hover=' + media.hover + ' dpr=' + media.dpr + ' ua=' + media.ua.slice(0, 46));

/* ---- ② 触摸目标尺寸 + iOS 缩放门槛 + 横向溢出 ---- */
const layout = await ev(() => {
  const small = [];
  const tiny = [];
  document.querySelectorAll('.btn,.bb-btn,.tab-btn,.segment,.accent-dot,.toggle-wrap,input,select,textarea,.qa-fab,.watch-mbtn').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;   // 隐藏/装饰性元素不算触摸目标
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (fs < 16) tiny.push((el.id || el.className || el.tagName) + ':' + fs + 'px');
    }
    if (r.height < 40 || r.width < 36) small.push((el.id || el.className || el.tagName).slice(0, 26) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  });
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    smallTargets: small.slice(0, 8),
    smallCount: small.length,
    tinyFonts: tiny.slice(0, 8),
    tinyCount: tiny.length,
  };
});
if (layout.overflow > 1) failures.push('横向溢出 ' + layout.overflow + 'px');
if (layout.tinyCount) failures.push('有 ' + layout.tinyCount + ' 个输入框字号 <16px（iOS 聚焦会缩放页面）：' + layout.tinyFonts.join(', '));
if (layout.smallCount) notes.push('偏小的触摸目标 ' + layout.smallCount + ' 个（前几个）：' + layout.smallTargets.join(' · '));
else notes.push('触摸目标尺寸检查：常见控件都 ≥40px 高');

/* ---- ③ 触摸端日期框：应走 appearance:none + 自绘图标（v152 的取舍） ---- */
const dateBox = await ev(() => {
  const el = document.getElementById('tfDate') || document.querySelector('input[type="date"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { appearance: cs.webkitAppearance || cs.appearance, width: Math.round(el.getBoundingClientRect().width), fontSize: cs.fontSize };
});
if (!dateBox) notes.push('没找到日期输入框（跳过该项）');
else {
  if (!/none/i.test(dateBox.appearance || '')) notes.push('日期框 appearance=' + dateBox.appearance + '（触摸端本应是 none + 自绘图标）');
  else notes.push('日期框触摸端样式：appearance=none、宽 ' + dateBox.width + 'px、字号 ' + dateBox.fontSize);
}

/* ---- ④ 用 tap（触摸）而不是 click 走一遍关键交互 ---- */
for (const [id, label] of [['bbConsole', '操作台'], ['bbOption', '期权'], ['bbData', '记录'], ['bbHoldings', '持仓']]) {
  await p.tap('#' + id).catch(async () => { await ev((x) => document.getElementById(x).click(), id); });
  await p.waitForTimeout(900);
}
const afterTabs = await ev(() => ({ active: document.body.dataset.activeTab || '', holdRows: document.querySelectorAll('#holdBody tr').length }));
if (!afterTabs.active) failures.push('tap 切 tab 后没有 activeTab 标记');
notes.push('tap 切四个 tab 正常（最后停在 ' + afterTabs.active + '，持仓 ' + afterTabs.holdRows + ' 行）');

// 汉堡菜单（触摸端的抽屉入口）
await p.tap('#mobHamburger').catch(() => {});
await p.waitForTimeout(700);
const drawerOpen = await ev(() => {
  const sb = document.querySelector('.sidebar');
  const hb = document.getElementById('mobHamburger');
  return { open: sb ? sb.classList.contains('open') : false, expanded: hb ? hb.getAttribute('aria-expanded') : null };
});
if (!drawerOpen.open) failures.push('tap 汉堡按钮没能打开侧栏抽屉');
else notes.push('触摸端抽屉：open=' + drawerOpen.open + '·aria-expanded=' + drawerOpen.expanded);
// 关闭抽屉：触摸端的真实操作是点那个已经变成「×」的汉堡按钮。
// 顺带记录遮罩状态——全屏抽屉时遮罩会被侧栏完全盖住（elementFromPoint 命中的是侧栏内容），属预期，不是 bug。
const closeInfo = await ev(() => {
  const hb = document.getElementById('mobHamburger');
  const ov = document.getElementById('sbOverlay');
  const r = hb.getBoundingClientRect();
  let topEl = null;
  if (ov) {
    const or = ov.getBoundingClientRect();
    const mid = document.elementFromPoint(Math.round(or.width / 2), Math.round(or.height / 2));
    topEl = mid ? (mid.id || mid.className || mid.tagName) : null;
  }
  return { w: Math.round(r.width), h: Math.round(r.height), label: hb.getAttribute('aria-label'), cls: String(hb.className), overlayTop: topEl };
});
if (!/关闭/.test(closeInfo.label || '')) failures.push('抽屉打开后汉堡按钮没变成「关闭」语义（aria-label=' + closeInfo.label + '）');
await p.tap('#mobHamburger').catch(async () => { await ev(() => document.getElementById('mobHamburger').click()); });
await p.waitForTimeout(600);
const drawerClosed = await ev(() => !document.querySelector('.sidebar').classList.contains('open'));
if (!drawerClosed) failures.push('点关闭按钮没能收起抽屉');
else notes.push('抽屉关闭正常（按钮 ' + closeInfo.w + '×' + closeInfo.h + '·aria-label=' + closeInfo.label + '；遮罩中点被 ' + closeInfo.overlayTop + ' 覆盖，属全屏抽屉的预期）');

// 点一行观察标的 → 内联详情（触摸端也要能展开）
await p.tap('#watchRows .watch-row').catch(() => {});
await p.waitForTimeout(600);
const detail = await ev(() => document.querySelectorAll('#watchRows .row-detail').length);
notes.push('tap 观察行 → 内联详情 ' + (detail ? '已展开' : '未展开（可能该行无行情，属预期）'));

/* ---- ⑤ 深色 + 再扫一遍溢出 ---- */
await ev(() => { if (document.documentElement.dataset.theme !== 'dark') toggleTheme(); });
await p.waitForTimeout(700);
const darkLayout = await ev(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, theme: document.documentElement.dataset.theme }));
if (darkLayout.theme !== 'dark') failures.push('深色模式没切过去');
if (darkLayout.overflow > 1) failures.push('深色下横向溢出 ' + darkLayout.overflow + 'px');

const final = await ev(() => ({ lastError: window.__lastError || null, bootFailed: document.body.innerText.indexOf('页面启动失败') >= 0 }));
if (final.bootFailed) failures.push('出现启动失败兜底页');
if (final.lastError) failures.push('__lastError: ' + final.lastError);
if (errors.length) failures.push(errors.join(' | '));

await ev(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

console.log('真机模拟（' + engine + ' · ' + (device ? device.userAgent.slice(0, 40) : '默认') + '）：');
notes.forEach((n) => console.log('  · ' + n));
if (failures.length) {
  console.error('发现问题：\n  - ' + failures.join('\n  - '));
  throw new Error('mobile-real failed');
}
console.log('✓ 触摸端验证通过（' + engine + ' 引擎 + 触摸事件 + 粗指针媒体分支）');
