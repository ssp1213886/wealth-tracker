// 真实测试：期权行权 / 持仓不足拦截 / 到期结算 / 删除退回权利金
const OUT = 'C:/Users/topeasejs/ChromeDebug/manual';
const log = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    log.push({ step: name, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (e) {
    log.push({ step: name, ok: false, detail: String(e && e.message).slice(0, 140) });
  }
};

const page = await context.newPage();
await page.route("**/assets/*", (route) =>
  route.continue({ headers: { ...route.request().headers(), "cache-control": "no-cache", pragma: "no-cache" } }),
);
await page.setViewportSize({ width: 390, height: 844 });
const dialogs = [];
let dialogAction = 'accept';
page.on('dialog', async (d) => {
  dialogs.push({ type: d.type(), message: d.message().replace(/\s+/g, ' ').slice(0, 80) });
  if (dialogAction === 'accept') await d.accept();
  else await d.dismiss();
});
const state = () => page.evaluate(() => ({
  trades: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]'),
  opts: JSON.parse(localStorage.getItem('wealth_options_v2') || '[]'),
  cashLog: JSON.parse(localStorage.getItem('wealth_cashlog_v2') || '[]'),
  cash: Number(localStorage.getItem('wealth_cash_v2') || 0),
}));

await page.goto("http://127.0.0.1:8788/", { waitUntil: "load" });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  localStorage.clear();
}).catch(() => {});
await page.waitForTimeout(3000);
await page.reload({ waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(3000);

// 准备：入金 20000 → 买 100 股 VGT @200
await page.evaluate(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  localStorage.setItem('wealth_cash_v2', JSON.stringify(20000));
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([{ id: 9001, date: plus(-5), time: '10:00', type: '入金', amount: 20000 }]));
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 9002, symbol: 'VGT', date: plus(-4), time: '10:00', shares: 100, price: 200, tag: '' }]));
  localStorage.setItem('wealth_prices_v2', JSON.stringify({ VGT: { price: 250, change: 1.2, source: 'tencent', history: [230, 240, 250] } }));
  localStorage.setItem('wealth_dashboard_v2_theme', 'light');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);

/* ---------- 场景 A：持仓不足时点行权，应被拦截 ---------- */
await step('A. 记录一张卖 Call（行权价 $130）', async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(900);
  await page.fill('#ostrike', '130');
  await page.fill('#opremium', '1.5');
  await page.fill('#ocontracts', '1');
  const fut = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 20);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  });
  await page.fill('#oexpiry', fut);
  await page.click('#btnAddOption');
  await page.waitForTimeout(1200);
  const s = await state();
  return `期权 ${s.opts.length} 条，持仓 100 股`;
});

await step('B. 卖掉 95 股（只剩 5 股），再点行权 → 应提示持仓不足', async () => {
  // 直接改数据模拟"持仓只剩 5 股"
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]');
    t.push({ id: 9003, symbol: 'VGT', date: '2026-01-01', time: '10:00', shares: -95, price: 260, tag: '' });
    localStorage.setItem('wealth_trades_v2', JSON.stringify(t));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(1000);
  dialogs.length = 0;
  dialogAction = 'accept';
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#holdingsBody button')].find((b) => b.textContent.trim() === '行权');
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);
  const s = await state();
  const optionAfter = s.opts[0];
  await page.screenshot({ path: OUT + '/opt-A-insufficient.png' });
  return `弹窗="${dialogs.map((d) => d.message).join(' / ')}" | 期权是否被误结算=${optionAfter ? optionAfter.settled : 'n/a'} | 新增交易=${s.trades.length - 2} 条`;
});

/* ---------- 场景 C：持仓足够时行权 ---------- */
await step('C. 持仓补到 100 股后点行权（确认）→ 应生成行权交易并结算期权', async () => {
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]');
    t.pop(); // 去掉刚才那笔 -95
    localStorage.setItem('wealth_trades_v2', JSON.stringify(t));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(1000);
  dialogs.length = 0;
  dialogAction = 'accept';
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#holdingsBody button')].find((b) => b.textContent.trim() === '行权');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1400);
  const s = await state();
  const assignTrade = s.trades.find((t) => t.tag === 'assign');
  await page.screenshot({ path: OUT + '/opt-C-assigned.png' });
  const holdRow = await page.evaluate(() => {
    const tr = document.querySelector('#holdBody tr');
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  });
  return `弹窗="${dialogs.map((d) => d.message).join(' / ').slice(0, 60)}" | 行权交易=${assignTrade ? assignTrade.shares + '股@$' + assignTrade.price : '无'} | 期权settled=${s.opts[0] ? s.opts[0].settled : 'n/a'} | 持仓行=${holdRow ? holdRow.slice(0, 3).join('/') : '已清空'}`;
});

/* ---------- 场景 D：删除未结算期权 → 退回权利金 ---------- */
await step('D. 记录新期权后直接删除 → 应退回权利金并写一条负数流水', async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(900);
  await page.fill('#ostrike', '300');
  await page.fill('#opremium', '2.5');
  await page.fill('#ocontracts', '2');
  const fut = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 25);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  });
  await page.fill('#oexpiry', fut);
  await page.click('#btnAddOption');
  await page.waitForTimeout(1200);
  const before = await state();
  dialogs.length = 0;
  dialogAction = 'accept';
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#holdingsBody tr')];
    const target = rows.find((r) => r.textContent.includes('300'));
    const btn = target && target.querySelector('button');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  const after = await state();
  const refund = after.cashLog.find((l) => String(l.type).indexOf('权利金退回') >= 0);
  await page.evaluate(() => window.switchTab && window.switchTab('data'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/opt-D-refund.png' });
  return `期权 ${before.opts.length}→${after.opts.length} | 退回流水=${refund ? refund.type + ' $' + refund.amount : '无'} | 现金 ${before.cash}→${after.cash}`;
});

/* ---------- 场景 E：到期结算 ---------- */
await step('E. 用一张已过期的期权点「结算」→ 标记为已结算', async () => {
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('wealth_options_v2') || '[]');
    const d = new Date(); d.setDate(d.getDate() - 3);
    const p = (n) => String(n).padStart(2, '0');
    o.push({ id: 9100, sym: 'VGT', type: 'CALL', strike: 400, premium: 1, contracts: 1, expiry: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), added: '2026-01-01', settled: false, archived: false });
    localStorage.setItem('wealth_options_v2', JSON.stringify(o));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(1000);
  dialogs.length = 0;
  dialogAction = 'accept';
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#holdingsBody button')].find((b) => b.textContent.trim() === '结算');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  const s = await state();
  const target = s.opts.find((o) => o.id === 9100);
  await page.screenshot({ path: OUT + '/opt-E-settled.png' });
  return `弹窗="${dialogs.map((d) => d.message).join(' / ').slice(0, 50)}" | settled=${target ? target.settled : 'n/a'}`;
});

const lastError = await page.evaluate(() => window.__lastError || null);
await page.close();
return { log, lastError, screenshots: OUT };
