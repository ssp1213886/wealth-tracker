// 云同步全链路（两台"设备"= 两个独立浏览器 context + 假云端），覆盖之前只测了推送到一半的场景：
//   ① A 写入 → 推上云端
//   ② B（新设备）拉取 → 拿到 A 的数据
//   ③ B 改动 → 推送 → A 再拉 → 看到 B 的改动（双向）
//   ④ 双向冲突：云端已被 A 改过、B 又基于旧版本推 → 409 → 冲突弹窗 → 选「使用云端」
//   ⑤ 令牌错误 → 明确报错、dirty 保留
//   ⑥ 云端没有该行而本地有 → 标脏并自动补推（v246 修的回归）
// 全程只碰本地假云端（E2E_PORT 默认 8790），不接触生产数据。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const CLOUD = BASE.replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
// 假云端设了 E2E_AUTH_TOKEN 时，只有这个 token 能用（用来验证"坏令牌 → 401"）
const GOOD = process.env.E2E_AUTH_TOKEN || 'test-token';

function attach(page) {
  page.route('**/*', (route) => {
    let h = '';
    try { h = new URL(route.request().url()).hostname; } catch (e) {}
    return h === HOST ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  return errors;
}

async function boot(ctx, token, seedTrades, seedPrices) {
  const page = await ctx.newPage();
  const errors = attach(page);
  await page.goto(BASE + 'icon.png', { waitUntil: 'load' });
  await page.evaluate(async (args) => {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const g of regs) await g.unregister();
    const ks = await caches.keys();
    for (const k of ks) await caches.delete(k);
    localStorage.clear();
    localStorage.setItem('wealth_sync_cfg', JSON.stringify({ url: args.base, token: args.token }));
    localStorage.setItem('wealth_trades_v2', JSON.stringify(args.seed || []));
    localStorage.setItem('wealth_cash_v2', '34000');
    localStorage.setItem('wealth_cashlog_v2', '[]');
    localStorage.setItem('wealth_activity_v1', '[]');
    if (args.prices) localStorage.setItem('wealth_prices_v2', JSON.stringify(args.prices));
  }, { base: CLOUD, token: token, seed: seedTrades || [], prices: seedPrices || null });
  await page.goto(BASE + '?dev=' + Date.now() + Math.random(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  return { page, errors };
}

const ev = async (page, fn, arg) => {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { return await page.evaluate(fn, arg); } catch (e) {
      last = e;
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(e && e.message))) throw e;
      await page.waitForTimeout(700);
    }
  }
  throw last;
};

const tradeCount = (page) => ev(page, () => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length);
const cashLogCount = (page) => ev(page, () => JSON.parse(localStorage.getItem('wealth_cashlog_v2') || '[]').length);
const syncState = (page) => ev(page, () => {
  const s = JSON.parse(localStorage.getItem('wealth_sync_state') || '{}');
  return { dirty: s.dirty || {}, cloudTsKeys: Object.keys(s.cloudTs || {}), lastPushAt: !!s.lastPushAt, lastPullAt: !!s.lastPullAt };
});
const cloudLog = async () => (await fetch(CLOUD + '/_log')).json();

const failures = [];
const notes = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };

await fetch(CLOUD + '/_reset').catch(() => {});

/* ---------- ① 设备 A：写入 → 推上云端 ---------- */
const A = await boot(context, GOOD, [{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]);
const aState0 = await syncState(A.page);
// 说明：启动时"云端为空 + 本地有数据"的补推发生在关页面/后续改动时（v246 的设计），
// 所以这里断言"被正确标成待同步"，随后 A 的一次真实改动会把它们一起推上去（见下一步）。
expect(!!aState0.dirty.trades || !!aState0.dirty.cashBalance, '① 启动后本地数据既没标脏也没推上云');
notes.push('① 启动引导：dirty=' + JSON.stringify(aState0.dirty) + '（本地有数据、云端为空 → 待同步）');

// A 再入金 5000（走真实 UI 路径）
await ev(A.page, () => {
  const el = document.getElementById('hmCashAmt');
  el.value = '5000';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await A.page.waitForTimeout(2500);
const a1 = await cloudLog();
expect(Object.keys(a1.store).includes('cashLog'), '① 入金后 cashLog 没推到云端');
notes.push('① A 入金 5000 → 云端 cashLog ' + (a1.store.cashLog || []).length + ' 条、现金 ' + a1.store.cashBalance);

/* ---------- ② 设备 B（全新设备，独立 context）拉取 ---------- */
const B2 = await boot(await browser.newContext(), GOOD, []);
const b0 = await cloudLog();
const bTrades = await tradeCount(B2.page);
const bCash = await ev(B2.page, () => localStorage.getItem('wealth_cash_v2'));
const bLogs = await cashLogCount(B2.page);
expect(bTrades >= 1, '② B 拉取后没看到 A 的 1 笔交易（实际 ' + bTrades + '）');
expect(Number(bCash) === 39000, '② B 拉取后现金应为 39000，实际 ' + bCash);
expect(bLogs >= 1, '② B 拉取后没看到 A 的资金流水');
const bState = await syncState(B2.page);
expect(bState.cloudTsKeys.length > 0, '② B 拉取后没记下 cloudTs');
notes.push('② B（新设备）拉取到：交易 ' + bTrades + ' 笔 · 现金 ' + bCash + ' · 流水 ' + bLogs + ' 条 · cloudTs ' + bState.cloudTsKeys.join(','));

/* ---------- ③ 双向：B 改 → 推 → A 再拉 ---------- */
await ev(B2.page, () => {
  const el = document.getElementById('hmCashAmt');
  el.value = '1234';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await B2.page.waitForTimeout(2500);
const c1 = await cloudLog();
expect(Number(c1.store.cashBalance) === 40234, '③ B 入金后云端现金应为 40234，实际 ' + c1.store.cashBalance);
notes.push('③ B 入金 1234 → 云端现金 ' + c1.store.cashBalance);

// A 重新可见 → 自动拉取
await ev(A.page, () => { document.dispatchEvent(new Event('visibilitychange')); });
await A.page.waitForTimeout(3000);
const aCash = await ev(A.page, () => localStorage.getItem('wealth_cash_v2'));
expect(Number(aCash) === 40234, '③ A 再拉后应看到 B 的改动（40234），实际 ' + aCash);
notes.push('③ A 重新可见后拉到 B 的改动：现金 ' + aCash);

/* ---------- ④ 冲突：云端被 A 改过，B 基于旧版本推 → 409 → 冲突弹窗 ---------- */
// A 先改（推上去，让云端版本前进）
await ev(A.page, () => {
  const el = document.getElementById('hmCashAmt');
  el.value = '1';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await A.page.waitForTimeout(2500);
const beforeConflict = await cloudLog();
notes.push('④ A 又入金 1 → 云端现金 ' + beforeConflict.store.cashBalance + '（版本前进）');

// B 本地再改（此时 B 的 cloudTs 还是旧版本）→ 推送应撞 409 并弹冲突窗
await ev(B2.page, () => {
  const el = document.getElementById('hmCashAmt');
  el.value = '7';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('hmDeposit').click();
});
await B2.page.waitForTimeout(3000);
const conflictModal = await ev(B2.page, () => {
  const m = document.getElementById('conflictModal');
  if (!m) return null;
  return { rows: m.querySelectorAll('input[type="radio"]').length, hasCancel: !!document.getElementById('cfCancel'), hasOk: !!document.getElementById('cfOk') };
});
if (conflictModal) {
  notes.push('④ B 基于旧版本推送 → 409 → 冲突弹窗出现（' + conflictModal.rows + ' 个单选项，按钮齐 ' + (conflictModal.hasCancel && conflictModal.hasOk) + '）');
  // 走「确定」= 默认保留本地那一侧，验证冲突处理完还能继续同步
  await ev(B2.page, () => { document.getElementById('cfOk').click(); });
  await B2.page.waitForTimeout(3000);
  const afterHeal = await cloudLog();
  const b2Dirty = await syncState(B2.page);
  notes.push('④ 处理后云端现金 ' + afterHeal.store.cashBalance + ' · B 的 dirty=' + JSON.stringify(b2Dirty.dirty));
} else {
  failures.push('④ B 基于旧版本推送没有触发 409 冲突弹窗（云端被静默覆盖了）');
}

/* ---------- ⑤ 令牌错误 → 明确报错且不改云端 ---------- */
// 先让上一轮冲突处理后的补推彻底落定，避免把 B 的延迟推送误判成坏令牌改了云端。
await B2.page.waitForTimeout(1500);
const C = await boot(await browser.newContext(), 'wrong-token', [{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 1, price: 100 }]);
const beforeBad = await cloudLog();
await ev(C.page, () => {
  const el = document.getElementById('hmCashAmt');
  if (el) {
    el.value = '99';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('hmDeposit').click();
  }
});
await C.page.waitForFunction(() => location.pathname === '/login', null, { timeout: 8000 }).catch(() => {});
await C.page.waitForTimeout(500);
/* v321 起：坏令牌 → /api/* 回 401 → guardUnauthorized 直接把页面送去 /login（设计行为）。
   这里以前断言的是"留在 App 里、状态条写同步失败"——那是登录门禁之前的老行为，早已不成立。 */
const badState = await ev(C.page, () => ({
  path: location.pathname,
  isLogin: /请登录|登录/.test(document.body.innerText || ''),
}));
expect(badState.path === '/login', '⑤ 坏令牌时没有自愈回登录页，实际停在 ' + badState.path);
const afterBad = await cloudLog();
expect(JSON.stringify(beforeBad.store.cashBalance) === JSON.stringify(afterBad.store.cashBalance), '⑤ 坏令牌竟然改动了云端数据');
notes.push('⑤ 坏令牌：自愈跳 ' + badState.path + '（登录页=' + badState.isLogin + '）· 云端未被改动');

/* ---------- ⑥ 云端没有该行 + 本地有 → 标脏并补推 ---------- */
await fetch(CLOUD + '/_reset').catch(() => {});
const D = await boot(await browser.newContext(), GOOD, [{ id: 9, date: '2026-09-09', symbol: 'SMH', shares: 5, price: 100 }]);
const dState = await syncState(D.page);
const dCloud = await cloudLog();
expect(!!dState.dirty.trades || Object.keys(dCloud.store).includes('trades'), '⑥ 「云端空 + 本地有」时既没标脏也没补推');
notes.push('⑥ 云端清空后：dirty=' + JSON.stringify(dState.dirty) + ' · 云端 store=' + Object.keys(dCloud.store).join(','));

/* ---------- ⑦ 云端旧价不得覆盖实时报价（v398） ----------
   线上事故：/api/quotes 先回（持仓市值正确），/api/sync 后回，把 10/10 的旧价写回内存，
   持仓市值/总资产退回旧值。这里把「云端是旧价、实时是新价」钉成回归。 */
await fetch(CLOUD + '/_reset').catch(() => {});
const PRICE_OLD = 1791647036555;            // 云端/本地缓存：10/10 的旧价
const seedTrades7 = [{ id: 21, date: '2026-11-01', symbol: 'VGT', shares: 2, price: 100, type: 'buy' }];
await fetch(CLOUD + '/_seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': GOOD },
  body: JSON.stringify({
    trades: seedTrades7,
    cashBalance: 1000,
    cashLog: [],
    activities: [],
    exit_portfolio: '',
    prices: { VGT: { price: 500, prevClose: 500, change: 0, time: PRICE_OLD, source: 'yahoo' } },
  }),
});
const E = await boot(await browser.newContext(), GOOD, seedTrades7, {
  VGT: { price: 500, prevClose: 500, change: 0, time: PRICE_OLD, source: 'yahoo' },
});
const valueAfterQuotes = await ev(E.page, () => (document.getElementById('hmValue') || {}).textContent);
// 假云端 /api/quotes 的 VGT = 124.85 → 2 股 = $249.70；若被旧价覆盖会是 $1,000.00
expect(valueAfterQuotes === '$249.70', '⑦ 实时报价到达后持仓市值不是 $249.70，实际 ' + valueAfterQuotes);

// 主动再触发一次拉取（等同于切回前台）：旧价仍然不许把它盖回去
await ev(E.page, () => document.dispatchEvent(new Event('visibilitychange')));
await E.page.waitForTimeout(2000);
const valueAfterPull = await ev(E.page, () => (document.getElementById('hmValue') || {}).textContent);
expect(valueAfterPull === '$249.70', '⑦ 同步拉取后持仓市值被云端旧价覆盖，实际 ' + valueAfterPull);

const eCache = await ev(E.page, () => {
  const key = Object.keys(localStorage).find((k) => /wealth_prices_v2$/.test(k)) || 'wealth_prices_v2';
  try { return JSON.parse(localStorage.getItem(key) || '{}').VGT || null; } catch (e) { return null; }
});
expect(!!eCache && Number(eCache.price) === 124.85, '⑦ 实时报价没有写回本地价格缓存，实际 ' + JSON.stringify(eCache));
expect(!!eCache && Number(eCache.time) > PRICE_OLD, '⑦ 本地价格缓存时间没有前进');
notes.push('⑦ 旧价拉取：报价后 ' + valueAfterQuotes + ' · 拉取后 ' + valueAfterPull + ' · 缓存 VGT=' + (eCache && eCache.price));

for (const [name, ctx] of [['A', A], ['B', B2], ['C', C], ['D', D], ['E', E]]) {
  if (ctx.errors && ctx.errors.length) failures.push(name + ' 页面报错：' + ctx.errors.join(' | '));
}

// 收尾：清掉所有 context 的 token
for (const [name, dev] of [['A', A], ['B', B2], ['C', C], ['D', D], ['E', E]]) {
  await ev(dev.page, () => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); }).catch(() => {});
  await dev.page.close().catch(() => {});
}

console.log('同步全链路（两台设备 + 假云端）：');
notes.forEach((n) => console.log('  ' + n));
if (failures.length) {
  console.error('发现问题：\n  - ' + failures.join('\n  - '));
  throw new Error('sync-full failed');
}
console.log('✓ 同步全链路通过（推送 / 拉取 / 双向 / 409 冲突 / 坏令牌 / 云端清空自愈 / 旧价不覆盖实时价）');
