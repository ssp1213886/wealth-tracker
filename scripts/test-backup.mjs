// 真实测试：备份导出 → 清空数据 → 导入恢复
const OUT = 'C:/Users/topeasejs/ChromeDebug/manual';
const log = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    log.push({ step: name, ok: true, detail: detail === undefined ? '' : String(detail) });
  } catch (e) {
    log.push({ step: name, ok: false, detail: String(e && e.message).slice(0, 180) });
  }
};

const page = await context.newPage();
await page.route("**/assets/*", (route) =>
  route.continue({ headers: { ...route.request().headers(), "cache-control": "no-cache", pragma: "no-cache" } }),
);
await page.setViewportSize({ width: 390, height: 844 });
page.on('dialog', async (d) => { await d.accept(); });

const counts = () => page.evaluate(() => ({
  trades: JSON.parse(localStorage.getItem('wealth_trades_v2') || '[]').length,
  opts: JSON.parse(localStorage.getItem('wealth_options_v2') || '[]').length,
  cashLog: JSON.parse(localStorage.getItem('wealth_cashlog_v2') || '[]').length,
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

// 准备一套数据
await page.evaluate(() => {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  localStorage.setItem('wealth_trades_v2', JSON.stringify([
    { id: 7001, symbol: 'VGT', date: plus(-30), time: '10:00', shares: 10, price: 100, tag: '' },
    { id: 7002, symbol: 'SMH', date: plus(-20), time: '11:00', shares: 2, price: 250, tag: '' },
  ]));
  localStorage.setItem('wealth_options_v2', JSON.stringify([
    { id: 7003, sym: 'VGT', type: 'CALL', strike: 130, premium: 1.25, contracts: 1, expiry: plus(20), added: plus(-5), settled: false, archived: false },
  ]));
  localStorage.setItem('wealth_cashlog_v2', JSON.stringify([
    { id: 7004, date: plus(-9), time: '10:00', type: '入金', amount: 5000 },
  ]));
  localStorage.setItem('wealth_cash_v2', JSON.stringify(3500));
  localStorage.setItem('wealth_dashboard_v2_targetGoal', JSON.stringify(1234567));
  localStorage.setItem('wealth_dashboard_v2_theme', 'light');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);

let exported = null;
await step('A. 准备数据（2 笔交易 / 1 张期权 / 1 笔流水 / 现金 3500）', async () => {
  const c = await counts();
  return JSON.stringify(c);
});

await step('B. 打开设置 → 点「导出备份」→ 捕获下载文件', async () => {
  await page.evaluate(() => { const h = document.querySelector('.mob-hamburger'); if (h) h.click(); });
  await page.waitForTimeout(900);
  await page.click('#sbSettingsEntry');
  await page.waitForTimeout(900);
  // 设置面板是二级菜单，导出按钮在「数据与备份」里
  await page.evaluate(() => {
    const head = [...document.querySelectorAll('button, .settings-panel-head, .settings-inline')]
      .find((el) => el.textContent.replace(/\s+/g, '').indexOf('数据与备份') >= 0);
    if (head) head.click();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/backup-A-settings.png' });
  const before = await page.evaluate(() => localStorage.getItem('lastBackupTime'));
  await page.click('#btnExportData');
  await page.waitForTimeout(1500);
  // 下载事件在 connectOverCDP 下捕不到，改为验证导出副作用 + 直接取备份内容
  const after = await page.evaluate(() => localStorage.getItem('lastBackupTime'));
  const snapshot = await page.evaluate(() => {
    const data = typeof createBackupData === 'function' ? createBackupData() : null;
    return data ? JSON.stringify(data) : null;
  });
  exported = snapshot;
  return '备份时间戳 ' + before + ' → ' + after + ' | 备份内容 ' + (snapshot ? Math.round(snapshot.length / 1024) + 'KB' : '取不到');
});

await step('C. 清空浏览器数据 → 确认页面回到空状态', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const c = await counts();
  await page.screenshot({ path: OUT + '/backup-B-cleared.png' });
  return '交易=' + c.trades + ' 期权=' + c.opts + ' 现金=' + c.cash;
});

await step('D. 打开设置 → 导入刚才的备份文件 → 验证数据恢复', async () => {
  await page.evaluate(() => { const h = document.querySelector('.mob-hamburger'); if (h) h.click(); });
  await page.waitForTimeout(900);
  await page.click('#sbSettingsEntry');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const head = [...document.querySelectorAll('button, .settings-panel-head, .settings-inline')]
      .find((el) => el.textContent.replace(/\s+/g, '').indexOf('数据与备份') >= 0);
    if (head) head.click();
  });
  await page.waitForTimeout(900);
  if (!exported) throw new Error('上一步没拿到备份内容，无法导入');
  await page.setInputFiles('#fileImport', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported, 'utf8'),
  });
  await page.waitForTimeout(2500);
  const c = await counts();
  await page.screenshot({ path: OUT + '/backup-C-restored.png' });
  return '交易=' + c.trades + ' 期权=' + c.opts + ' 流水=' + c.cashLog + ' 现金=' + c.cash;
});

await step('E. 恢复后页面渲染是否正常（持仓/交易/期权三处）', async () => {
  await page.evaluate(() => {
    const o = document.querySelector('.sb-overlay');
    if (o) o.click();
  });
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
    return tr ? [...tr.children].map((td) => td.textContent.trim()).slice(0, 3) : null;
  });
  const tradeCount = await page.evaluate(() => document.querySelectorAll('#tradeBody tr').length);
  await page.screenshot({ path: OUT + '/backup-D-after-restore.png' });
  return '持仓行=' + (hold ? hold.join('/') : '无') + ' | 交易行=' + tradeCount;
});

const lastError = await page.evaluate(() => window.__lastError || null);
await page.close();
return { log, lastError, exportedFile: exported };
