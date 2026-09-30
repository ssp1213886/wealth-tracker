// 持仓视图层的单测（v250 从 index.js 的 updatePortfolio 抽出）。
// 这一层只做"把算好的数字写进 DOM"，所以断言方式就是：给它一组数字，看写出来的文字/类名/宽度对不对。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configurePortfolioView, fmtPnLPctParen, renderMetricsTop, renderMetricsPnl,
  renderHoldingsBody, renderGoalProgress, renderDrawdownPanel, renderPricePills,
  cashPctText, renderCashTotals,
} from '../src/app/portfolio-view.js';

function makeEl(extra) {
  return Object.assign({ textContent: '', innerHTML: '', className: '', style: {}, attrs: {} }, extra || {});
}

function fakeDoc(els) {
  return {
    getElementById: (id) => (id in els ? els[id] : null),
    _el: (id) => els[id],
    _set: (id, el) => { els[id] = el; },
  };
}

// 注入三个宿主函数：资产色、行情胶囊、金额缩写
configurePortfolioView({
  getAssetColor: (sym) => 'C-' + sym,
  pricePill: (sym, price, change, source) => '[pill ' + sym + ' ' + price + ' ' + (change || '') + ' ' + (source || '') + ']',
  fmtMoney: (n) => 'M' + n,
});

test('fmtPnLPctParen：括号百分比，非数值给空串', () => {
  assert.equal(fmtPnLPctParen(0.1234), '(+12.3%)');
  assert.equal(fmtPnLPctParen(-0.0456), '(-4.6%)');
  assert.equal(fmtPnLPctParen(0), '(+0.0%)');
  assert.equal(fmtPnLPctParen(NaN), '');
  assert.equal(fmtPnLPctParen(Infinity), '');
  assert.equal(fmtPnLPctParen('abc'), '');
});

test('renderMetricsTop：总市值 / 总资产 / 现金占比；没行情时市值显示 -', () => {
  const hmValue = makeEl();
  const hmTotal = makeEl();
  const hmCashPct = makeEl();
  const doc = fakeDoc({ hmValue, hmTotal, hmCashPct });
  renderMetricsTop(doc, { hasPriced: true, totalValue: 1234.5, totals: { totalAssets: 34000 + 1234.5, cashPct: 96.5 } });
  assert.equal(hmValue.textContent, '$1,234.50');
  assert.equal(hmTotal.textContent, '$35,234.50');
  assert.equal(hmCashPct.textContent, '96.50%');
  renderMetricsTop(doc, { hasPriced: false, totalValue: 0, totals: { totalAssets: 34000, cashPct: 100 } });
  assert.equal(hmValue.textContent, '-');
  assert.equal(hmCashPct.textContent, '100.00%');
  // v319：总资产 ≤ 0 时 cashPct 是 null → 显示「—」，而不是 0.00%
  renderMetricsTop(doc, { hasPriced: true, totalValue: 0, totals: { totalAssets: -500, cashPct: null } });
  assert.equal(hmTotal.textContent, '-$500.00', '负号在 $ 前面（v319）');
  assert.equal(hmCashPct.textContent, '—');
});

// v319：占比文案与 cashPctOf 配对；null（总资产 ≤ 0）必须显示「—」而不是 0.00%
test('cashPctText：null → 「—」，有值 → 两位小数百分比', () => {
  assert.equal(cashPctText(null), '—');
  assert.equal(cashPctText(undefined), '—');
  assert.equal(cashPctText(96.8421), '96.84%');
  assert.equal(cashPctText(0), '0.00%', '真实的 0%（现金为 0 但总资产 > 0）仍是 0.00%');
  assert.equal(cashPctText(-510.78), '-510.78%', '现金为负但总资产 > 0 时如实显示负数');
});

// v320：桌面指标卡里"依赖现金"的两格由视图层写（原来藏在 index.js 的手机状态栏函数里）
test('renderCashTotals：只写总资产与现金占比，且 ≤0 时显示「—」', () => {
  const hmTotal = makeEl();
  const hmCashPct = makeEl();
  const doc = fakeDoc({ hmTotal, hmCashPct });
  renderCashTotals(doc, 35234.5, 1000);
  assert.equal(hmTotal.textContent, '$35,234.50');
  assert.equal(hmCashPct.textContent, (1000 / 35234.5 * 100).toFixed(2) + '%');
  renderCashTotals(doc, -400, -900);
  assert.equal(hmTotal.textContent, '-$400.00');
  assert.equal(hmCashPct.textContent, '—', '总资产 ≤0 时占比无意义');
  // 元素缺失时不抛
  assert.doesNotThrow(() => renderCashTotals(fakeDoc({}), 1, 1));
});

test('renderMetricsPnl：今日涨跌与总盈亏的正负着色', () => {
  const hu = makeEl();
  const hup = makeEl();
  const hp = makeEl();
  const hpp = makeEl();
  const doc = fakeDoc({ hmUnreal: hu, hmUnrealPct: hup, hmPnL: hp, hmPnLPct: hpp });
  renderMetricsPnl(doc, {
    hasPriced: true, totalPnL: 88.75, totalPct: 0.0784, unpriced: [],
    totalPnLUnreal: 88.75, totalRealized: -12, realizedOptionPremium: 120,
    dailyChg: 3.2, dailyPct: 0.42,
  });
  assert.equal(hu.textContent, '+$3.20');
  assert.equal(hu.className, 'm-val pnl-pos');
  assert.match(hup.innerHTML, /\+0\.42% 今日/);
  assert.equal(hp.textContent, '+$88.75');
  assert.equal(hp.className, 'm-val pnl-pos');
  assert.match(hpp.innerHTML, /\(\+7\.8%\)/);
  assert.match(hpp.innerHTML, /浮动 \+\$88\.75/);
  assert.match(hpp.innerHTML, /已实现 -\$12\.00/, '负数时符号在 $ 前面（v319）');
  assert.match(hpp.innerHTML, /权利金 \+\$120\.00/);
});

test('renderMetricsPnl：跌的时候走 pnl-neg', () => {
  const hu = makeEl();
  const hup = makeEl();
  const hp = makeEl();
  const hpp = makeEl();
  const doc = fakeDoc({ hmUnreal: hu, hmUnrealPct: hup, hmPnL: hp, hmPnLPct: hpp });
  renderMetricsPnl(doc, {
    hasPriced: true, totalPnL: -50, totalPct: -0.05, unpriced: [],
    totalPnLUnreal: -50, totalRealized: -5, realizedOptionPremium: -30,
    dailyChg: -2.5, dailyPct: -1.1,
  });
  assert.equal(hu.className, 'm-val pnl-neg');
  assert.match(hup.innerHTML, /-1\.10% 今日/);
  assert.equal(hp.className, 'm-val pnl-neg');
  assert.match(hpp.innerHTML, /\(-5\.0%\)/);
  assert.match(hpp.innerHTML, /权利金 -\$30\.00/);
});

test('renderMetricsPnl：没有实时价时不加方向类，并点名需要设价的标的', () => {
  const hu = makeEl();
  const hup = makeEl();
  const hpp = makeEl();
  const doc = fakeDoc({ hmUnreal: hu, hmUnrealPct: hup, hmPnL: makeEl(), hmPnLPct: hpp });
  renderMetricsPnl(doc, {
    hasPriced: false, totalPnL: null, totalPct: null, unpriced: ['SMH', 'BTC'],
    totalPnLUnreal: 0, totalRealized: 0, realizedOptionPremium: 0, dailyChg: 0, dailyPct: null,
  });
  assert.equal(hu.className, 'm-val ', '没有实时价时不加方向类（既有行为）');
  assert.doesNotMatch(hu.className, /pnl-/);
  assert.equal(hup.textContent, '按实时价估算');
  assert.match(hpp.innerHTML, /需设价:SMH,BTC/);
});

test('renderHoldingsBody：每行带资产色、股数、均价、市值、盈亏', () => {
  const holdBody = makeEl();
  const doc = fakeDoc({ holdBody });
  renderHoldingsBody(doc, [
    { sym: 'VGT', shares: 8.62, avgCost: 116.01, priced: true, value: 936.4, unrealPnL: -63.7, pnlPct: -0.0637 },
    { sym: 'BTC', shares: 13.62, avgCost: 29.38, priced: false, value: 0, unrealPnL: null, pnlPct: null },
  ]);
  assert.equal((holdBody.innerHTML.match(/<tr style="--row-accent:/g) || []).length, 2);
  assert.match(holdBody.innerHTML, /--row-accent:C-VGT/);
  assert.match(holdBody.innerHTML, /data-cell="shares">8\.62/);
  assert.match(holdBody.innerHTML, /data-cell="avg">\$116\.01/);
  assert.match(holdBody.innerHTML, /data-cell="value">\$936\.40/);
  assert.match(holdBody.innerHTML, /class="pnl-neg">-\$63\.70/);
  assert.match(holdBody.innerHTML, /data-cell="value"><span style="color:orange;">-<\/span>/);
  assert.match(holdBody.innerHTML, /data-hold="BTC"/);
});

test('renderHoldingsBody：空持仓显示空态', () => {
  const holdBody = makeEl();
  const doc = fakeDoc({ holdBody });
  renderHoldingsBody(doc, []);
  assert.match(holdBody.innerHTML, /暂无持仓/);
  assert.match(holdBody.innerHTML, /colspan="7"/);
});

test('renderGoalProgress：进度宽度、百分比、差额颜色与目标文案', () => {
  const prBar = makeEl({ style: {} });
  const prPct = makeEl();
  const prGap = makeEl({ style: {} });
  const prCostInline = makeEl();
  const targetName = makeEl();
  const targetLabel = makeEl();
  const prTargetInline = makeEl();
  const doc = fakeDoc({ prBar, prPct, prGap, prCostInline, targetName, targetLabel, prTargetInline });
  renderGoalProgress(doc, { pctVal: 42.37, gap: 1440000, hasPriced: true, totalAssets: 1060000, target: 2500000 });
  assert.equal(prBar.style.width, '42.37%');
  assert.equal(prPct.textContent, '42.4%');
  assert.equal(prGap.textContent, '$1,440,000.00');
  assert.equal(prGap.style.color, 'var(--red)', '还差钱 → 红');
  assert.equal(prCostInline.textContent, '$1,060,000.00');
  assert.equal(targetName.textContent, 'M2500000');
  assert.equal(targetLabel.textContent, 'M2500000');
  assert.equal(prTargetInline.textContent, 'M2500000');
  renderGoalProgress(doc, { pctVal: 120, gap: -100, hasPriced: true, totalAssets: 3e6, target: 2500000 });
  assert.equal(prGap.style.color, 'var(--accent)', '超额达成 → 强调色');
});

test('renderDrawdownPanel：有数据画条并写最大回撤', () => {
  const tc = makeEl({ className: '', style: {} });
  const ts = makeEl({ style: {} });
  const tw = makeEl();
  const doc = fakeDoc({ hmDrawdown: tc, hmDrawdownSub: ts, hmDrawdownWorst: tw });
  renderDrawdownPanel(doc, { lines: [
    { sym: 'VGT', price: 100, peak: 120, dd: 16.7 },
    { sym: 'BTC', price: 29, peak: 40, dd: 27.5 },
  ] });
  assert.equal(tc.className, 'drawdown-visual');
  assert.equal((tc.innerHTML.match(/class="drawdown-row"/g) || []).length, 2);
  assert.match(tc.innerHTML, /drawdown-track/);
  assert.match(tc.innerHTML, /drawdown-marker/);
  assert.match(tc.innerHTML, /var\(--red\)/, '回撤 ≥20% 用红');
  assert.match(tc.innerHTML, /var\(--orange\)/, '回撤 ≥10% 用橙');
  assert.equal(tw.textContent, '最大 -27.5%');
  assert.equal(ts.style.display, 'flex');
});

test('renderDrawdownPanel：没数据时显示空态并收起副标题', () => {
  const tc = makeEl({ className: '', style: {} });
  const ts = makeEl({ style: {} });
  const tw = makeEl();
  const doc = fakeDoc({ hmDrawdown: tc, hmDrawdownSub: ts, hmDrawdownWorst: tw });
  renderDrawdownPanel(doc, { lines: [] });
  assert.equal(tc.className, 'drawdown-empty');
  assert.equal(tc.textContent, '添加价格后显示');
  assert.equal(tw.textContent, '最大 --');
  assert.equal(ts.style.display, 'none');
});

test('renderPricePills：有价用行情胶囊，无价显示橙色占位', () => {
  const compact = makeEl({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const priceTime = makeEl();
  const doc = fakeDoc({ hmPricesCompact: compact, hmPriceTime: priceTime });
  renderPricePills(doc, {
    symbols: ['VGT', 'SMH', 'BTC'],
    prices: { VGT: 108.62, SMH: 402.1 },
    changes: { VGT: 1.2, SMH: -0.4 },
    sources: { VGT: 'Yahoo', SMH: 'Yahoo' },
  });
  assert.equal(compact.attrs['aria-busy'], 'false');
  assert.match(compact.innerHTML, /\[pill VGT 108\.62 1\.2 Yahoo\]/);
  assert.match(compact.innerHTML, /data-sym="BTC"/);
  assert.match(compact.innerHTML, /color:var\(--orange\)">--/);
  assert.match(priceTime.textContent, /^更新 /);
});
