// 计算样式指纹：把页面上每个元素的关键计算样式哈希化，用于"改 CSS 前后必须一致"的对比。
// 用法（无头）：
//   FP_OUT=tmp/before.json E2E_BASE=http://127.0.0.1:8790/ node scripts/e2e/driver.mjs --file scripts/e2e/style-fingerprint.mjs
// 说明：跑在假云端 + 固定种子数据上，覆盖 手机/桌面 × 明/暗 四种组合，保证可比。
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8790/');
const OUT = process.env.FP_OUT || 'tmp/style-fingerprint.json';
const fs = await import('node:fs');
const path = await import('node:path');

const PROPS = [
  'display', 'position', 'width', 'height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'font-size', 'font-weight', 'line-height',
  'color', 'background-color', 'background-image', 'border-top-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-radius', 'box-shadow', 'opacity', 'visibility', 'overflow-x', 'overflow-y',
  'gap', 'grid-template-columns', 'flex-direction', 'align-items', 'justify-content', 'text-align', 'z-index',
];
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const label = (el) => {
  const id = el.id ? '#' + el.id : '';
  const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
  return el.tagName.toLowerCase() + id + cls;
};

const p = await context.newPage();
await p.route('**/*', (route) => {
  let host = '';
  try { host = new URL(route.request().url()).hostname; } catch (e) {}
  return host === new URL(BASE).hostname ? route.continue() : route.abort();
});
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(BASE.replace(/\/$/, '') + '/_reset').catch(() => {});
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
  localStorage.setItem('wealth_activity_v1', JSON.stringify([
    { id: 101, date: '2026-09-20', time: '10:00', action: '买入 VGT', detail: '10 股 @ 100' },
    { id: 102, date: '2026-09-21', time: '11:00', action: '入金', detail: '$2,000' },
  ]));
  localStorage.setItem('wealth_options_v2', JSON.stringify([
    { id: 201, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20' },
  ]));
  localStorage.setItem('otmSettings', JSON.stringify({ vgt: 7, smh: 5 }));
  localStorage.setItem('exit_portfolio', '测试退出策略');
});
await p.goto(BASE + '?fp=' + Date.now(), { waitUntil: 'domcontentloaded' });
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

// 一次 evaluate 完成「取计算样式 → 哈希 → 返回 label=hash 列表」
const capture = () => ev((props) => {
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  return Array.from(document.querySelectorAll('body *')).map((el) => {
    const cs = getComputedStyle(el);
    const sig = props.map((k) => cs.getPropertyValue(k)).join('|');
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + id + cls + '=' + hash(sig);
  });
}, PROPS);

const only = process.env.FP_SCOPE || '';
const combos = [['mobile', 390], ['desktop', 1280]].flatMap(([name, width]) => [['light'], ['dark']].map(([theme]) => [name, width, theme]))
  .filter(([name, , theme]) => !only || name + '-' + theme === only);
const results = {};
for (const [name, width, theme] of combos) {
    await p.setViewportSize({ width, height: 900 });
    await ev((t) => {
      const want = t === 'dark';
      if ((document.documentElement.dataset.theme === 'dark') !== want) toggleTheme();
      document.documentElement.style.scrollBehavior = 'auto';
    }, theme);
    for (const tab of ['bbHoldings', 'bbConsole', 'bbOption', 'bbData']) {
      await ev((id) => document.getElementById(id).click(), tab);
      await p.waitForTimeout(900);
    }
    await ev(() => {
      Array.from(document.querySelectorAll('.collapsible-card .collapsible-header')).forEach((h) => h.click());
    });
    await p.waitForTimeout(1200);
    const items = await capture();
    results[name + '-' + theme] = items;
}
await p.evaluate(() => {
  localStorage.removeItem('wealth_sync_cfg');
  localStorage.removeItem('wealth_sync_state');
});
await p.close();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(results), 'utf8');
const total = Object.values(results).reduce((n, arr) => n + arr.length, 0);
console.log('指纹已写入 ' + OUT + '：' + Object.keys(results).map((k) => k + ' ' + results[k].length + ' 个元素').join(' · ') + '（合计 ' + total + '）');
