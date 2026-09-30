// 给品牌徽标截图（两版对比用）：桌面 + 手机 × 品牌原色 / 单色剪影
// 用法：E2E_BASE=http://127.0.0.1:8788/ node scripts/e2e/driver.mjs --file scripts/e2e/shot-brand.mjs
const fs = await import('node:fs');
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8788/');
const HOST = new URL(BASE).hostname;
const OUT = process.env.SHOT_DIR || 'tmp';
fs.mkdirSync(OUT, { recursive: true });

async function shoot(label, width, height, url) {
  const p = await context.newPage();
  await p.route('**/*', (route) => {
    let h = '';
    try { h = new URL(route.request().url()).hostname; } catch (e) {}
    return h === HOST ? route.continue() : route.abort();
  });
  await p.setViewportSize({ width: width, height: height });
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
  });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4500);
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  // 注意：手机端不要打开侧栏抽屉，否则会盖住主内容（观察列表在主内容区）
  // 观察列表在侧栏下方，把侧栏滚到底再截（桌面端侧栏是独立滚动容器，scrollIntoView 不一定生效）
  // 观察列表在「操作台」tab 的卡片里（不在侧栏、也不在仪表盘），先切 tab 再滚过去
  await p.evaluate(() => { const b = document.getElementById('bbConsole'); if (b) b.click(); });
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const card = document.getElementById('watchCard');
    if (card) card.scrollIntoView({ block: 'center', behavior: 'auto' });
  });
  await p.waitForTimeout(800);
  const file = OUT + '/' + label + '.png';
  await p.screenshot({ path: file });
  await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
  await p.close();
  return file;
}

const files = [];
// 主要看移动端：iPhone 视口 + 触摸
files.push(await shoot('brand-mobile-color', 390, 844, BASE + '?s=' + Date.now()));
files.push(await shoot('brand-mobile-mono', 390, 844, BASE + '?brand=mono&s=' + Date.now()));
files.push(await shoot('brand-desktop-color', 1280, 900, BASE + '?s=' + Date.now()));
files.push(await shoot('brand-desktop-mono', 1280, 900, BASE + '?brand=mono&s=' + Date.now()));
console.log('截图：\n  ' + files.join('\n  '));
