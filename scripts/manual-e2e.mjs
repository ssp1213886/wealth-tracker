// 真实操作测试：像人一样在浏览器里填表、点按钮、看结果，每步截图。
const OUT = 'C:/Users/topeasejs/ChromeDebug/manual';
const log = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    log.push({ step: name, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (e) {
    log.push({ step: name, ok: false, detail: String(e && e.message).slice(0, 160) });
  }
};
const shot = (page, name) => page.screenshot({ path: OUT + '/' + name + '.png' });

const page = await context.newPage();
await page.route("**/assets/*", (route) =>
  route.continue({ headers: { ...route.request().headers(), "cache-control": "no-cache", pragma: "no-cache" } }),
);
await page.setViewportSize({ width: 390, height: 844 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

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

await step("① 全新打开（空数据）", async () => {
  await shot(page, "01-empty-dashboard");
  const ready = await page.evaluate(() => !!window.__wealthReady);
  const total = await page.evaluate(() => {
    const el = document.querySelector('#holdMetrics .metric .m-val');
    return el ? el.textContent : null;
  });
  return `启动=${ready} 总资产=${total}`;
});

await step("② 打开侧边栏（空状态）", async () => {
  await page.click('.mob-hamburger');
  await page.waitForTimeout(800);
  await shot(page, "02-empty-sidebar");
  await page.click('.sb-overlay, .sidebar-toggle').catch(() => {});
  await page.waitForTimeout(600);
  return "已截图";
});

await step("③ 现金管理：先真实入金 2000（新用户第一步）", async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('data'));
  await page.waitForTimeout(900);
  await page.fill('#hmCashAmt', '2000');
  await page.waitForTimeout(300);
  await shot(page, "03-cash-form");
  await page.click('#hmDeposit');
  await page.waitForTimeout(900);
  await shot(page, "04-cash-deposited");
  const bal = await page.textContent('#dataCashBal');
  return `余额=${(bal || '').trim()}`;
});

await step("④ 操作台：真实填写并点击「添加交易」", async () => {
  await page.click('[data-tab="console"], .tab-btn:nth-child(2)').catch(async () => {
    await page.evaluate(() => window.switchTab && window.switchTab('console'));
  });
  await page.waitForTimeout(900);
  await page.fill('#tfPrice', '115.2');
  await page.fill('#tfShares', '8.62');
  await page.waitForTimeout(400);
  await shot(page, "05-console-filled");
  const est = await page.textContent('#tfEstimated');
  await page.click('#btnAddTrade');
  await page.waitForTimeout(1000);
  await shot(page, "06-console-added");
  const toast = await page.textContent('#syncToast').catch(() => '');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]'));
  return `预计金额=${est} | 提示=${(toast || '').trim().slice(0, 20)} | 已存交易=${stored.length} 条`;
});

await step("⑤ 记录页：确认交易与持仓出现", async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('data'));
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelectorAll('.collapsible-card').forEach((c) => {
      if (c.classList.contains('collapsed')) c.querySelector('.collapsible-header').click();
    });
  });
  await page.waitForTimeout(700);
  const hold = await page.evaluate(() => {
    const tr = document.querySelector('#holdBody tr');
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  });
  const trade = await page.evaluate(() => {
    const tr = document.querySelector('#tradeBody tr');
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  });
  await shot(page, "07-records-after-buy");
  return `持仓=${(hold || []).join(' / ')} | 交易=${(trade || []).join(' / ')}`;
});

await step("⑥ 期权页：真实记录一笔卖 Call", async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('option'));
  await page.waitForTimeout(900);
  await page.fill('#ostrike', '130');
  await page.fill('#opremium', '1.25');
  await page.fill('#ocontracts', '1');
  const future = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  });
  await page.fill('#oexpiry', future);
  await page.waitForTimeout(400);
  await shot(page, "08-option-form");
  await page.click('#btnAddOption');
  await page.waitForTimeout(1000);
  await shot(page, "09-option-added");
  const row = await page.evaluate(() => {
    const tr = document.querySelector('#holdingsBody tr');
    return tr ? [...tr.children].map((td) => td.textContent.trim().slice(0, 16)) : null;
  });
  const opts = await page.evaluate(() => JSON.parse(localStorage.getItem('wealth_options_v2') || '[]'));
  return `期权行=${(row || []).join(' / ')} | 已存=${opts.length} 条`;
});

await step("⑦ 删除交易 → 撤销", async () => {
  await page.evaluate(() => window.switchTab && window.switchTab('data'));
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => document.querySelectorAll('#tradeBody tr').length);
  await page.click('#tradeBody .trade-del');
  await page.waitForTimeout(800);
  await shot(page, "10-after-delete");
  const during = await page.evaluate(() => ({
    rows: document.querySelectorAll('#tradeBody tr').length,
    toast: (document.getElementById('syncToast') || {}).textContent.trim(),
  }));
  await page.click('#syncToast .toast-action');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelectorAll('#tradeBody tr').length);
  await shot(page, "11-after-undo");
  return `${before} → 删除后 ${during.rows}（提示"${during.toast.slice(0, 16)}"）→ 撤销后 ${after}`;
});

await step("⑧ 记录页搜索", async () => {
  await page.fill('#dsSearchInput', 'VGT');
  await page.waitForTimeout(1000);
  await shot(page, "11-search");
  const count = await page.textContent('#dsSearchCount');
  await page.fill('#dsSearchInput', '');
  await page.waitForTimeout(700);
  return `匹配=${(count || '').trim() || '(空)'}`;
});

await step("⑨ 深色模式", async () => {
  await page.click('.ms-theme').catch(async () => {
    await page.evaluate(() => window.toggleTheme && window.toggleTheme());
  });
  await page.waitForTimeout(800);
  await shot(page, "12-dark-records");
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  return `主题=${theme}`;
});

await step("⑩ 切回浅色 + 侧边栏终态", async () => {
  await page.click('.ms-theme').catch(async () => {
    await page.evaluate(() => window.toggleTheme && window.toggleTheme());
  });
  await page.waitForTimeout(600);
  await page.click('.mob-hamburger');
  await page.waitForTimeout(900);
  await shot(page, "13-sidebar-final");
  const quotes = await page.evaluate(() => document.querySelectorAll('.sb-market .sb-price-row').length);
  return `主题=${await page.evaluate(() => document.documentElement.dataset.theme)} 行情行=${quotes}`;
});

await step("⑪ 桌面端总览", async () => {
  await page.evaluate(() => {
    const o = document.querySelector('.sb-overlay');
    if (o) o.click();
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1200);
  await shot(page, "14-desktop");
  return "已截图";
});

const lastError = await page.evaluate(() => window.__lastError || null);
await page.close();
return { log, consoleErrors: errors, lastError, screenshots: OUT };
