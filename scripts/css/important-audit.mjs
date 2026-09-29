// C1 分析工具（只读）：在真实页面里逐条试删 !important，看计算样式有没有变化。
// 判据：把某条声明的 important 临时去掉 → 只采样它命中元素的计算值 → 完全一样 = 冗余的 !important。
// 一条声明只有在**手机/桌面 × 明/暗 四种组合下都无变化**，才算真的可删（媒体覆盖层的必须留）。
// 用法：$env:E2E_BASE='http://127.0.0.1:8788/'; node scripts/e2e/driver.mjs --file <本文件>
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8788/';
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.setViewportSize({ width: 1280, height: 900 });
await p.route('**/*', (route) => {
  let h = '';
  try { h = new URL(route.request().url()).hostname; } catch (e) {}
  return h === HOST ? route.continue() : route.abort();
});
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(BASE + '_reset').catch(() => {});
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
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
  localStorage.setItem('exit_portfolio', '测试退出策略');
});
await p.goto(BASE + '?ia=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const ev = async (fn, arg) => {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await p.evaluate(fn, arg); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await p.waitForTimeout(700);
    }
  }
  throw last;
};

// 四个 tab 都点一遍、展开所有折叠卡，让元素尽量齐全
for (const tab of ['bbHoldings', 'bbConsole', 'bbOption', 'bbData']) {
  await ev((id) => { const b = document.getElementById(id); if (b) b.click(); }, tab);
  await p.waitForTimeout(700);
}
await ev(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  Array.from(document.querySelectorAll('.collapsible-card .collapsible-header')).forEach((h) => h.click());
});
await p.waitForTimeout(1200);

/** 在页面里跑的采集函数（必须是自包含的，会被序列化送进浏览器） */
const COLLECT = () => {
  const sheetOf = (s) => { try { return s.cssRules } catch (e) { return null } };
  const sheets = Array.from(document.styleSheets).filter((s) => sheetOf(s));
  const rules = [];
  const walk = (list, media) => {
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      const cond = r.media && r.media.mediaText ? r.media.mediaText : (r.conditionText || '');
      // Chrome 现在给每条规则都挂 cssRules（CSS 嵌套），所以先认"样式规则"再递归
      if (r.style && r.selectorText) rules.push({ rule: r, media: media });
      else if (r.cssRules) walk(r.cssRules, media ? media + ' && ' + cond : cond);
    }
  };
  sheets.forEach((s) => walk(sheetOf(s), ''));

  const removable = [];
  let scanned = 0;
  for (const item of rules) {
    const rule = item.rule;
    const media = item.media;
    if (media && !window.matchMedia(media).matches) continue;
    const props = [];
    for (let i = 0; i < rule.style.length; i += 1) {
      const k = rule.style[i];
      if (rule.style.getPropertyPriority(k) === 'important') props.push(k);
    }
    if (!props.length) continue;
    let els;
    try { els = Array.from(document.querySelectorAll(rule.selectorText)); } catch (e) { continue; }
    if (!els.length) continue;
    for (const prop of props) {
      scanned += 1;
      const value = rule.style.getPropertyValue(prop);
      const before = els.map((el) => getComputedStyle(el).getPropertyValue(prop));
      rule.style.setProperty(prop, value, '');
      const after = els.map((el) => getComputedStyle(el).getPropertyValue(prop));
      rule.style.setProperty(prop, value, 'important');
      let same = true;
      for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) { same = false; break; }
      if (same) removable.push({ key: rule.selectorText + '|' + prop, sel: rule.selectorText, prop: prop, value: value, media: media || '', hits: els.length });
    }
  }
  return { scanned: scanned, removable: removable };
};

const COMBOS = [['mobile-light', 390, false], ['mobile-dark', 390, true], ['desktop-light', 1280, false], ['desktop-dark', 1280, true]];
const perCombo = {};
for (const [name, width, dark] of COMBOS) {
  await p.setViewportSize({ width: width, height: 900 });
  await ev((wantDark) => {
    if ((document.documentElement.dataset.theme === 'dark') !== wantDark) toggleTheme();
    document.documentElement.style.scrollBehavior = 'auto';
  }, dark);
  await p.waitForTimeout(700);
  const r = await ev(COLLECT);
  perCombo[name] = r.removable;
  console.log(name + '：可删候选 ' + r.removable.length + ' 条（扫到 ' + r.scanned + ' 条 !important）');
}

const sets = COMBOS.map(([name]) => new Set(perCombo[name].map((x) => x.key)));
const byKey = new Map(perCombo[COMBOS[0][0]].map((x) => [x.key, x]));
const safe = [];
byKey.forEach((info, key) => { if (sets.every((s) => s.has(key))) safe.push(info); });
const union = new Set();
COMBOS.forEach(([name]) => perCombo[name].forEach((x) => union.add(x.key)));

await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

const byMedia = {};
safe.forEach((r) => { const k = r.media || '(无媒体条件)'; byMedia[k] = (byMedia[k] || 0) + 1; });
// 状态类关键词：这些选择器只在特定状态下命中，默认态下"无变化"不代表其它状态也安全
const STATE_RE = /(:hover|:focus|:active|:disabled|\[aria-|\.is-|\.has-|\.active|\.open|\.show|\.hidden|\.on\b|\.off\b|\.collapsed|\.is-on|\.sync-|\.busy|\.done|\.warn|\.err)/;
const risky = safe.filter((r) => STATE_RE.test(r.sel));
const steady = safe.filter((r) => !STATE_RE.test(r.sel));
const fs = await import('node:fs');
fs.writeFileSync('tmp/important-safe.json', JSON.stringify({ generated: new Date().toISOString(), steady: steady, stateful: risky }, null, 2), 'utf8');
console.log(JSON.stringify({
  perCombo: COMBOS.map(([name]) => name + '=' + perCombo[name].length),
  unionCandidates: union.size,
  safeInAllFour: safe.length,
  steady: steady.length,
  stateful: risky.length,
  byMediaTop: Object.entries(byMedia).sort((a, b) => b[1] - a[1]).slice(0, 6),
  sample: steady.slice(0, 20),
}, null, 2));
