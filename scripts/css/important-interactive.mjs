// C1 第二批验证（只读）：把"四种组合默认态都判可删"的候选，再放到 :hover / :focus / :active 下验一遍。
// 原因：默认态无变化 ≠ 交互态无变化 —— 比如 `.x { color:red !important }` 对 `.x.active { color:blue }` 就是必需的。
// 做法：CDP CSS.forcePseudoState 给可交互元素强制伪类，再逐条试删候选的 important 比计算样式。
// 用法：$env:E2E_BASE='http://127.0.0.1:8788/'; node scripts/e2e/driver.mjs --file <本文件>
const fs = await import('node:fs');   // driver 用 new Function 执行，不能用静态 import

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8788/';
const HOST = new URL(BASE).hostname;
const CAND_FILE = 'tmp/important-safe.json';
const all = JSON.parse(fs.readFileSync(CAND_FILE, 'utf8'));
// 第二批起把"含状态类关键词"的也一并送验（forcePseudoState 能覆盖 hover/focus/active）
const candidates = (all.steady || []).concat(all.stateful || []);

const p = await context.newPage();
const client = await context.newCDPSession(p);
await client.send('DOM.enable');
await client.send('CSS.enable');
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
await p.goto(BASE + '?ii=' + Date.now(), { waitUntil: 'domcontentloaded' });
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

for (const tab of ['bbHoldings', 'bbConsole', 'bbOption', 'bbData']) {
  await ev((id) => { const b = document.getElementById(id); if (b) b.click(); }, tab);
  await p.waitForTimeout(600);
}
// 与 _important-audit.mjs 保持**同一页面状态**（展开所有折叠卡），否则"是否必需"的判定会因布局不同而不一致
await ev(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  Array.from(document.querySelectorAll('.collapsible-card .collapsible-header')).forEach((h) => h.click());
});
await p.waitForTimeout(1200);

/** 页面内：对给定候选逐条试删 important，返回"这一状态下仍无变化"的 key 集合 */
const VERIFY = (cands) => {
  const sheetOf = (s) => { try { return s.cssRules } catch (e) { return null } };
  const rules = [];
  const walk = (list, media) => {
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i];
      const cond = r.media && r.media.mediaText ? r.media.mediaText : (r.conditionText || '');
      if (r.style && r.selectorText) rules.push({ rule: r, media: media });
      else if (r.cssRules) walk(r.cssRules, media ? media + ' && ' + cond : cond);
    }
  };
  Array.from(document.styleSheets).forEach((s) => { const l = sheetOf(s); if (l) walk(l, ''); });

  const ok = {};
  for (const c of cands) {
    let hit = null;
    let skippedByMedia = false;
    for (const item of rules) {
      const rule = item.rule;
      if (rule.selectorText !== c.sel) continue;
      if (rule.style.getPropertyPriority(c.prop) !== 'important') continue;
      if (rule.style.getPropertyValue(c.prop).trim() !== c.value.trim()) continue;
      if (item.media && !window.matchMedia(item.media).matches) { skippedByMedia = true; continue; }
      hit = rule;
      break;
    }
    if (!hit) { ok[c.key] = skippedByMedia ? 'skip' : 'gone'; continue; }
    let els;
    try { els = Array.from(document.querySelectorAll(c.sel)); } catch (e) { ok[c.key] = 'badsel'; continue; }
    if (!els.length) { ok[c.key] = 'noel'; continue; }
    const value = hit.style.getPropertyValue(c.prop);
    const before = els.map((el) => getComputedStyle(el).getPropertyValue(c.prop));
    hit.style.setProperty(c.prop, value, '');
    const after = els.map((el) => getComputedStyle(el).getPropertyValue(c.prop));
    hit.style.setProperty(c.prop, value, 'important');
    let same = true;
    for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) { same = false; break; }
    ok[c.key] = same ? 'ok' : 'needed';
  }
  return ok;
};

const INTERACTIVE = 'button,a[href],input,select,textarea,[role="button"],[tabindex],.btn,.qa-item,.segment,.accent-dot,.watch-row,.hold-row,.sb-price-row,.collapsible-header';

async function forceStates(states) {
  const { root } = await client.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: INTERACTIVE });
  for (const nodeId of nodeIds) {
    await client.send('CSS.forcePseudoState', { nodeId: nodeId, forcedPseudoClasses: states }).catch(() => {});
  }
  return nodeIds.length;
}

const results = {};
for (const [name, width, dark] of [['mobile-light', 390, false], ['mobile-dark', 390, true], ['desktop-light', 1280, false], ['desktop-dark', 1280, true]]) {
  await p.setViewportSize({ width: width, height: 900 });
  await ev((wantDark) => {
    if ((document.documentElement.dataset.theme === 'dark') !== wantDark) toggleTheme();
    document.documentElement.style.scrollBehavior = 'auto';
  }, dark);
  await p.waitForTimeout(600);
  for (const states of [[], ['hover'], ['focus'], ['active']]) {
    const count = await forceStates(states);
    await p.waitForTimeout(120);
    const r = await ev(VERIFY, candidates);
    const tag = name + '/' + (states[0] || 'none');
    results[tag] = r;
    if (!states.length) console.log(tag + '：强制 ' + count + ' 个可交互元素');
  }
}
await forceStates([]);
await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

// 汇总：四种组合 × 四种伪类状态，全部 "ok" 才留下
const verdict = new Map();
candidates.forEach((c) => verdict.set(c.key, { info: c, states: {} }));
Object.entries(results).forEach(([tag, map]) => {
  Object.entries(map).forEach(([key, v]) => {
    const e = verdict.get(key);
    if (!e) return;
    if (v === 'skip') return;                    // 该视口下这条媒体条件不生效，交由其它组合判
    if (v !== 'ok') e.states[tag] = v;
  });
});
const alive = [];
const dropped = [];
verdict.forEach((e, key) => {
  const bad = Object.entries(e.states).filter(([, v]) => v !== 'ok');
  if (bad.length) dropped.push({ key: key, why: bad.slice(0, 2).map(([t, v]) => t + ':' + v).join(' ') });
  else alive.push(e.info);
});
fs.writeFileSync('tmp/important-safe-final.json', JSON.stringify({ generated: new Date().toISOString(), alive: alive, dropped: dropped }, null, 2), 'utf8');
console.log(JSON.stringify({
  candidates: candidates.length,
  survivedInteractive: alive.length,
  dropped: dropped.length,
  droppedSample: dropped.slice(0, 8),
}, null, 2));
