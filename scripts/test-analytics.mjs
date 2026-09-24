// 真实测试：用可手算的数据核对分析类卡片的数值
const OUT = 'C:/Users/topeasejs/ChromeDebug/manual';
const page = await context.newPage();
await page.route("**/assets/*", (route) =>
  route.continue({ headers: { ...route.request().headers(), "cache-control": "no-cache", pragma: "no-cache" } }),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:8788/", { waitUntil: "load" });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  localStorage.clear();
}).catch(() => {});
await page.waitForTimeout(3000);

// 可手算数据：VGT 10@100 + 10@120（均价 110，现价 150）；SMH 4@250（平价）；入金 10000
await page.evaluate(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  localStorage.setItem('wealth_trades_v2', JSON.stringify([
    { id: 5001, symbol: 'VGT', date: plus(-60), time: '10:00', shares: 10, price: 100, tag: '' },
    { id: 5002, symbol: 'VGT', date: plus(-40), time: '10:00', shares: 10, price: 120, tag: '' },
    { id: 5003, symbol: 'SMH', date: plus(-50), time: '10:00', shares: 4, price: 250, tag: '' },
  ]));
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([
    { id: 5004, date: plus(-61), time: '09:00', type: '入金', amount: 10000 },
  ]));
  localStorage.setItem('wealth_cash_v2', JSON.stringify(6800)); // 10000 - 3200
  localStorage.setItem('wealth_options_v2', JSON.stringify([]));
  localStorage.setItem('wealth_prices_v2', JSON.stringify({
    VGT: { price: 150, change: 1.0, source: 'manual', history: [140, 145, 130, 138, 150] },
    SMH: { price: 250, change: 0, source: 'manual', history: [250, 250, 250] },
    BTC: { price: 68000, change: 0.5, source: 'manual', history: [66000, 67000, 68000] },
  }));
  localStorage.setItem('wealth_dashboard_v2_theme', 'light');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);

const readAll = () => page.evaluate(() => {
  const t = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  return {
    // 指标卡
    总资产: t('hmTotal'),
    未实现盈亏: t('hmUnreal') + ' / ' + t('hmUnrealPct'),
    持仓市值: t('hmValue') + ' / ' + t('hmValueSub'),
    现金: t('hmCash') + ' / ' + t('hmCashPct'),
    累计收益: t('hmPnL') + ' / ' + t('hmPnLPct'),
    // 定投
    定投已投: t('mobileDcaInvested'),
    定投目标: t('mobileDcaTarget'),
    定投完成率: t('mobileDcaPct'),
    定投拆分: t('mobileDcaVgtAmt') + ' | ' + t('mobileDcaSmhAmt') + ' | ' + t('mobileDcaBtcAmt'),
    // 目标与回撤
    目标进度: t('prPct') + ' | 还差 ' + t('prGap'),
    最大回撤: t('hmDrawdownWorst') + ' | ' + t('hmDrawdown'),
    // 分布与持仓
    甜甜圈图例: t('donutLegend'),
    持仓列表: t('pnlSummary'),
    // Covered Call
    CoveredCall: t('ccActive') + ' | ' + t('ccMonthly') + ' | ' + t('ccSub'),
    // 提醒
    待办: t('mobileAlertMeta'),
  };
});

const holding = await readAll();
await page.screenshot({ path: OUT + '/ana-1-dashboard.png', fullPage: true });

// 再平衡（操作台）
await page.evaluate(() => window.switchTab && window.switchTab('console'));
await page.waitForTimeout(1200);
const rebalance = await page.evaluate(() => {
  const el = document.getElementById('rebalanceBody') || document.getElementById('rebalContent');
  return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : null;
});
await page.screenshot({ path: OUT + '/ana-2-rebalance.png', fullPage: true });

// 定投第二轮：本月买入 2000（VGT 1000 / SMH 600 / BTC 400 目标下）
await page.evaluate(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const t = JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]');
  t.push({ id: 5005, symbol: 'VGT', date: iso(new Date()), time: '10:00', shares: 5, price: 200, tag: '' });
  localStorage.setItem('wealth_trades_v2', JSON.stringify(t));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);
const afterDca = await page.evaluate(() => {
  const t = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  return {
    已投: t('mobileDcaInvested'),
    目标: t('mobileDcaTarget'),
    完成率: t('mobileDcaPct'),
    进度条宽: (document.getElementById('mobileDcaProgress') || {}).style ? document.getElementById('mobileDcaProgress').style.width : null,
    拆分: t('mobileDcaVgtAmt') + ' | ' + t('mobileDcaSmhAmt') + ' | ' + t('mobileDcaBtcAmt'),
    拆分布分比: t('mobileDcaVgtPct') + ' | ' + t('mobileDcaSmhPct') + ' | ' + t('mobileDcaBtcPct'),
  };
});
await page.screenshot({ path: OUT + '/ana-3-dca.png', fullPage: true });

const lastError = await page.evaluate(() => window.__lastError || null);
await page.close();
return { holding, rebalance, afterDca, lastError };
