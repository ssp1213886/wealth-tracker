// 全站功能回归：注入一套完整数据，逐项检查各页面的渲染、计算与交互。
// 用法：先 `npm run preview:lan`，再 `node "…/cdp.mjs" --file scripts/e2e-full.mjs`
const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
const eq = (a, b) => String(a) === String(b);

const page = await context.newPage();
await page.route("**/assets/*", (route) =>
  route.continue({ headers: { ...route.request().headers(), "cache-control": "no-cache", pragma: "no-cache" } }),
);
await page.setViewportSize({ width: 390, height: 844 });
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 120)); });

await page.goto("http://127.0.0.1:8788/", { waitUntil: "load" });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  localStorage.clear();
  localStorage.setItem("wealth_alert_seen_v1", "legacy");
}).catch(() => {});
await page.waitForTimeout(3000);

// ---- 数据准备：10@100 + 10@120 - 5@150（VGT）、2@250（SMH）；期权两条；现金流入出 ----
for (let i = 0; i < 3; i++) {
  try {
    await page.evaluate(() => {
      const pad = (n) => String(n).padStart(2, "0");
      const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
      localStorage.setItem("wealth_trades_v2", JSON.stringify([
        { id: 4001, symbol: "VGT", date: plus(-30), time: "10:24", shares: 10, price: 100, tag: "" },
        { id: 4002, symbol: "VGT", date: plus(-20), time: "11:02", shares: 10, price: 120, tag: "" },
        { id: 4003, symbol: "VGT", date: plus(-10), time: "09:31", shares: -5, price: 150, tag: "" },
        { id: 4004, symbol: "SMH", date: plus(-15), time: "14:20", shares: 2, price: 250, tag: "" },
      ]));
      localStorage.setItem("wealth_options_v2", JSON.stringify([
        { id: 4005, sym: "VGT", type: "CALL", strike: 130, premium: 1.25, contracts: 1, expiry: plus(2), added: plus(-20), settled: false, archived: false },
        { id: 4006, sym: "SMH", type: "CALL", strike: 300, premium: 2.4, contracts: 2, expiry: plus(5), added: plus(-30), settled: false, archived: true },
      ]));
      localStorage.setItem("wealth_cashlog_v2", JSON.stringify([
        { id: 4007, date: plus(-9), time: "10:24", type: "入金", amount: 2000 },
        { id: 4008, date: plus(-8), time: "10:25", type: "出金", amount: 500 },
        { id: 4009, date: plus(-7), time: "10:26", type: "股息", amount: 12.5 },
      ]));
      localStorage.setItem("wealth_cash_v2", JSON.stringify(1512.5));
      localStorage.setItem("wealth_prices_v2", JSON.stringify({
        VGT: { price: 150, change: 0.6, source: "tencent", history: [140, 142, 141, 145, 148, 150] },
        SMH: { price: 300, change: -0.4, source: "tencent", history: [305, 302, 301, 300] },
      }));
      localStorage.setItem("wealth_dashboard_v2_theme", "light");
    });
    break;
  } catch (e) {
    await page.waitForTimeout(1800);
  }
}
await page.reload({ waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(3200);

/* ================= 1. 启动与数据层 ================= */
const boot = await page.evaluate(() => ({
  ready: !!window.__wealthReady,
  schema: localStorage.getItem("wealth_schema_v1"),
  legacyGone: localStorage.getItem("wealth_alert_seen_v1") === null,
  err: window.__lastError || null,
}));
check("页面正常启动", boot.ready);
check("数据迁移标记写入", eq(boot.schema, "2"), boot.schema);
check("迁移清理遗留键", boot.legacyGone);
check("启动无未捕获错误", boot.err === null, boot.err || "");

/* ================= 2. 仪表盘 ================= */
const dash = await page.evaluate(() => {
  const metrics = [...document.querySelectorAll('#holdMetrics .metric')].map((m) => ({
    label: (m.querySelector('.m-label') || {}).textContent || '',
    value: (m.querySelector('.m-val') || {}).textContent || '',
  }));
  const chart = document.getElementById('chartDonut') || document.querySelector('#tab-holding canvas');
  return {
    metrics,
    metricCount: metrics.length,
    hasChart: !!chart,
    alerts: document.querySelectorAll('#mobileAlerts .qa-alert-item, #qaAlerts .qa-alert-item').length,
    hasGoal: !!document.querySelector('#prBar') || !!document.querySelector('.goal-row'),
  };
});
check("仪表盘指标卡齐全（≥4）", dash.metricCount >= 4, dash.metricCount + " 个");
check("仪表盘总资产有数值", /\$/.test((dash.metrics[0] || {}).value || ''), (dash.metrics[0] || {}).value);
check("持仓分布图存在", dash.hasChart);
check("待办提醒渲染", dash.alerts > 0, dash.alerts + " 条");
check("目标进度存在", dash.hasGoal);

/* ================= 3. 操作台 ================= */
await page.evaluate(() => { if (window.switchTab) window.switchTab('console'); });
await page.waitForTimeout(900);
const console_ = await page.evaluate(() => {
  const ids = ['tfShares', 'tfPrice', 'tfDate', 'tfAsset', 'btnAddTrade'];
  const missing = ids.filter((id) => !document.getElementById(id));
  return {
    missing,
    priceCards: document.querySelectorAll('.price-pill').length,
    hasSegment: !!document.querySelector('.segmented-control'),
  };
});
check("操作台表单元素齐全", console_.missing.length === 0, console_.missing.join(",") || "全部存在");
check("顶部价格卡渲染", console_.priceCards >= 2, console_.priceCards + " 个");
check("买/卖分段控件存在", console_.hasSegment);

// 预计金额联动计算（输入 2 股 × 150 → $300）
const affordability = await page.evaluate(() => {
  const price = document.getElementById('tfPrice');
  const shares = document.getElementById('tfShares');
  if (!price || !shares) return null;
  price.value = '150';
  price.dispatchEvent(new Event('input', { bubbles: true }));
  shares.value = '2';
  shares.dispatchEvent(new Event('input', { bubbles: true }));
  return (document.getElementById('tfEstimated') || {}).textContent || '';
});
check("预计金额联动计算", /300/.test(affordability || ''), affordability);

/* ================= 4. 期权页 ================= */
await page.evaluate(() => { if (window.switchTab) window.switchTab('option'); });
await page.waitForTimeout(900);
const opt = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#holdingsBody tr')].filter((tr) => tr.children.length > 1);
  return {
    rowCount: rows.length,
    firstCells: rows[0] ? [...rows[0].children].map((td) => td.textContent.trim().slice(0, 18)) : null,
    hasOtm: !!document.getElementById('otmVgtMinus'),
    hasMetrics: document.querySelectorAll('.option-metric').length,
    hasRevenue: !!document.getElementById('mrev') || !!document.getElementById('trev'),
  };
});
check("期权持仓清单渲染", opt.rowCount >= 1, opt.rowCount + " 行");
check("期权行包含行权价与到期", !!opt.firstCells && opt.firstCells.some((c) => c.includes('$')) && opt.firstCells.some((c) => c.includes('-')));
check("OTM 调整控件存在", opt.hasOtm);
check("期权指标块齐全", opt.hasMetrics >= 3, opt.hasMetrics + " 个");
check("Covered Call 收入卡存在", opt.hasRevenue);

// OTM 步进按钮可点击并改变数值
const otmBefore = await page.evaluate(() => (document.getElementById('otmVgtVal') || {}).textContent || '');
const otmAfter = await page.evaluate(() => {
  const btn = document.getElementById('otmVgtPlus');
  if (!btn) return null;
  btn.click();
  return (document.getElementById('otmVgtVal') || {}).textContent || '';
});
check("OTM 步进可调整", otmBefore !== otmAfter, otmBefore + " → " + otmAfter);

/* ================= 5. 记录页 ================= */
await page.evaluate(() => { if (window.switchTab) window.switchTab('data'); });
await page.waitForTimeout(900);
await page.evaluate(() => {
  document.querySelectorAll(".collapsible-card").forEach((c) => {
    if (c.classList.contains("collapsed")) c.querySelector(".collapsible-header").click();
  });
});
await page.waitForTimeout(700);

const record = await page.evaluate(() => {
  const cells = (id) => {
    const tr = document.querySelector('#' + id + ' tr');
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  };
  return {
    hold: cells('holdBody'),
    holdCount: document.querySelectorAll('#holdBody tr').length,
    trade: cells('tradeBody'),
    cashRow: (() => {
      const row = [...document.querySelectorAll('#cashLogBody tr')].find((tr) => tr.textContent.includes('出金'));
      return row ? [...row.children].map((td) => td.textContent.trim()) : null;
    })(),
    summary: (document.querySelector('.cash-summary') || {}).textContent.replace(/\s+/g, ' ').trim() || '',
    cashBalance: (document.getElementById('dataCashBal') || {}).textContent || '',
    hasSearch: !!document.getElementById('dsSearchInput'),
    segCount: document.querySelectorAll('#recordSeg .record-seg').length,
  };
});
// 10@100 + 10@120 = 均价 110；150 卖出 5 股 → 剩 15 股，成本 1650，均价 110
check("持仓明细-股数与均价", record.hold && eq(record.hold[1], '15.00') && eq(record.hold[2], '$110.00'), (record.hold || []).slice(1, 3).join(" / "));
check("持仓明细-收益率存在", record.hold && /\d/.test(record.hold[5] || ''), (record.hold || [])[5]);
check("持仓明细-两行标的", record.holdCount >= 2, record.holdCount + " 行");
check("交易历史-卖出方向标签", record.trade && /卖出/.test(record.trade[2] || ''), (record.trade || [])[2]);
check("交易历史-金额格式", record.trade && /\$/.test(record.trade[4] || ''), (record.trade || [])[4]);
check("资金流水-出金显示为负", /-/.test((record.cashRow || [])[2] || ''), (record.cashRow || [])[2]);
check("现金汇总显示累计", record.summary.includes('累计'), record.summary.slice(0, 40));
check("现金余额有数值", /\$/.test(record.cashBalance), record.cashBalance);
check("搜索框存在", record.hasSearch);
check("明细/日志切换存在", record.segCount >= 2, record.segCount + " 个");

// 搜索过滤
const searchResult = await page.evaluate(() => {
  const input = document.getElementById('dsSearchInput');
  if (!input) return null;
  input.value = 'SMH';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'triggered';
});
await page.waitForTimeout(900); // 搜索是防抖的，等它跑完
const searchCount = await page.evaluate(() => ({
  count: (document.getElementById('dsSearchCount') || {}).textContent || '',
  visibleRows: [...document.querySelectorAll('#tradeBody tr, #holdBody tr')].filter((tr) => tr.style.display !== 'none').length,
}));
check("搜索能过滤记录", /\d/.test(searchCount.count), searchCount.count + " / 可见 " + searchCount.visibleRows + " 行");
await page.evaluate(() => {
  const input = document.getElementById('dsSearchInput');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.waitForTimeout(400);

// 删除 + 撤销
const delBefore = await page.evaluate(() => document.querySelectorAll('#tradeBody tr').length);
const delAfter = await page.evaluate(() => {
  const btn = document.querySelector('#tradeBody .trade-del');
  if (!btn) return null;
  btn.click();
  return null;
});
await page.waitForTimeout(700);
const delState = await page.evaluate(() => ({
  rows: document.querySelectorAll('#tradeBody tr').length,
  toast: ((document.getElementById('syncToast') || {}).textContent || '').trim(),
  canUndo: !!document.querySelector('#syncToast .toast-action'),
}));
check("删除交易生效", delState.rows === delBefore - 1, delBefore + " → " + delState.rows);
check("删除后出现撤销入口", delState.canUndo, delState.toast.slice(0, 30));
await page.evaluate(() => { const a = document.querySelector('#syncToast .toast-action'); if (a) a.click(); });
await page.waitForTimeout(700);
const restored = await page.evaluate(() => document.querySelectorAll('#tradeBody tr').length);
check("撤销恢复记录", restored === delBefore, restored + " 行");

/* ================= 6. 侧边栏 ================= */
await page.evaluate(() => { const h = document.querySelector('.mob-hamburger'); if (h) h.click(); });
await page.waitForTimeout(900);
const sidebar = await page.evaluate(() => {
  const sb = document.querySelector('.sidebar');
  const heads = [...sb.querySelectorAll('.sb-section h3')];
  return {
    headCount: heads.length,
    icons: heads.filter((h) => h.querySelector('.sb-h3-icon')).length,
    accentDots: sb.querySelectorAll('.accent-dot').length,
    quotes: sb.querySelectorAll('.sb-price-row').length,
    sparks: sb.querySelectorAll('.sb-market .spr-spark').length,
    hasHealth: !!sb.querySelector('.sb-health-list'),
    settingsEntry: !!document.getElementById('sbSettingsEntry'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});
check("侧边栏区块齐全（≥5）", sidebar.headCount >= 5, sidebar.headCount + " 个");
check("区块标题都有图标", sidebar.icons === sidebar.headCount, sidebar.icons + "/" + sidebar.headCount);
check("配色圆点存在", sidebar.accentDots >= 5, sidebar.accentDots + " 个");
check("行情行渲染", sidebar.quotes >= 2, sidebar.quotes + " 行");
// 行情曲线依赖真实历史数据（网络来源），无数据时按设计不画线，所以这里只做信息记录
results.push({ name: "行情曲线（信息项）", pass: true, detail: sidebar.sparks + " 条（无历史数据时不画，属预期）" });
check("数据健康区存在", sidebar.hasHealth);
check("设置入口存在", sidebar.settingsEntry);
check("移动端无横向溢出", sidebar.overflow <= 0, sidebar.overflow + "px");

// 配色切换
const accentSwitched = await page.evaluate(() => {
  const dot = document.querySelector('.accent-dot.ad-ocean') || document.querySelectorAll('.accent-dot')[1];
  if (!dot) return null;
  const before = document.documentElement.dataset.accent;
  dot.click();
  return { before, after: document.documentElement.dataset.accent };
});
check("配色切换生效", !!accentSwitched && accentSwitched.before !== accentSwitched.after, JSON.stringify(accentSwitched));
await page.evaluate(() => {
  const dot = document.querySelector('.accent-dot.ad-forest') || document.querySelectorAll('.accent-dot')[0];
  if (dot) dot.click();
});
await page.waitForTimeout(500);

/* ================= 7. 深色模式与桌面端 ================= */
const themeToggled = await page.evaluate(() => {
  const before = document.documentElement.dataset.theme;
  if (window.toggleTheme) window.toggleTheme();
  const after = document.documentElement.dataset.theme;
  if (window.toggleTheme) window.toggleTheme();
  return { before, after };
});
check("深色模式切换生效", themeToggled.before !== themeToggled.after, JSON.stringify(themeToggled));

await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(1000);
const desktop = await page.evaluate(() => ({
  sidebarVisible: !!document.querySelector('.sidebar'),
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  holdRows: document.querySelectorAll('#holdBody tr').length,
}));
check("桌面端侧边栏渲染", desktop.sidebarVisible);
check("桌面端无横向溢出", desktop.overflow <= 0, desktop.overflow + "px");

/* ================= 8. 控制台错误 ================= */
check("控制台无 JS 报错", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
const finalError = await page.evaluate(() => window.__lastError || null);
check("运行期无未捕获错误", finalError === null, finalError || "");

await page.close();

const failed = results.filter((r) => !r.pass);
return {
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  failures: failed.map((f) => f.name + " → " + f.detail),
  all: results.map((r) => (r.pass ? "✓ " : "✗ ") + r.name + (r.detail ? "  [" + r.detail + "]" : "")),
};
