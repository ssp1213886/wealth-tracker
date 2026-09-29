// 观察/行情视图模型单测（v246 抽出）：名字派生、价格取值、格式化、价格胶囊
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRYPTO_NAMES, FALLBACK_NAMES, cleanName, quotePrice, historyOf, hi52Of,
  fmtSmallPrice, searchRowPrice, pricePillHTML,
} from '../src/app/watch-view.js';

test('名字表：加密品牌名齐备，兜底表含 BTC 与 GOLD', () => {
  assert.equal(CRYPTO_NAMES.BTC, 'Bitcoin');
  assert.equal(CRYPTO_NAMES.XRP, 'Ripple');
  assert.equal(CRYPTO_NAMES.SHIB, 'Shiba Inu');
  assert.deepEqual(FALLBACK_NAMES, { BTC: 'Bitcoin', GOLD: 'Gold' });
});

test('cleanName：已知加密标的走品牌名 + 现货', () => {
  assert.equal(cleanName('BTC', { name: 'Bitcoin USD' }), 'Bitcoin · 现货');
  assert.equal(cleanName('DOGE', null), 'Dogecoin · 现货');
});

test('cleanName：接口标了 crypto 的（表外币种）去掉尾部 USD 再补现货', () => {
  assert.equal(cleanName('BONK', { crypto: true, name: 'Bonk USD' }), 'Bonk · 现货');
  assert.equal(cleanName('XYZCOIN', { crypto: true, name: 'Xyzcoin USD' }), 'Xyzcoin · 现货', '不在品牌表里也按 crypto 标记处理');
  assert.equal(cleanName('XYZCOIN', { crypto: true, name: '' }), 'XYZCOIN · 现货', '没名字就用代码');
});

test('cleanName：股票用接口名（去掉尾部括号代码），中文名与空名回落', () => {
  assert.equal(cleanName('NVDA', { name: 'NVIDIA Corporation' }), 'NVIDIA Corporation');
  // 尾部 ≤3 个字母的括号代码会被剥掉（VGT 这种 3 字母）；4 字母的 AAPL 不剥，保持原样
  assert.equal(cleanName('VGT', { name: 'Vanguard Information Tech ETF (VGT' }), 'Vanguard Information Tech ETF');
  assert.equal(cleanName('AAPL', { name: 'Apple Inc. (AAPL' }), 'Apple Inc. (AAPL');
  assert.equal(cleanName('GOLD', { name: '黄金' }), 'Gold', '接口给中文名时用兜底表');
  assert.equal(cleanName('IWM', null), 'IWM', '都没有就用代码本身');
});

test('quotePrice：接口行情 > 实时价 > 本地缓存，全无则 0', () => {
  assert.equal(quotePrice({ price: 100 }, 90, { price: 80 }), 100);
  assert.equal(quotePrice(null, 90, { price: 80 }), 90);
  assert.equal(quotePrice(null, null, { price: 80 }), 80);
  assert.equal(quotePrice(null, null, null), 0);
  assert.equal(quotePrice({ price: 'abc' }, 0, null), 0);
});

test('historyOf / hi52Of：按归属代码取缓存，缺失时安全回落', () => {
  const cache = { BTC: { history: [1, 2, 3], hi52: 55.96 } };
  assert.deepEqual(historyOf(cache, 'BTC'), [1, 2, 3]);
  assert.deepEqual(historyOf(cache, 'ETH'), []);
  assert.deepEqual(historyOf(cache, ''), []);
  assert.equal(hi52Of(cache, 'BTC', null), 55.96);
  assert.equal(hi52Of(cache, 'ETH', { hi52: 120 }), 120, '缓存没有就用行情里的');
  assert.equal(hi52Of(null, 'BTC', null), 0);
});

test('fmtSmallPrice：小额币价按数量级给位数，普通价两位', () => {
  assert.equal(fmtSmallPrice(0.5), '$0.50');
  assert.equal(fmtSmallPrice(0.0934), '$0.0934');
  assert.equal(fmtSmallPrice(0.0025), '$0.0025');
  assert.equal(fmtSmallPrice(0.00000348), '$0.00000348');
  assert.equal(fmtSmallPrice(126.17), '$126.17');
  assert.equal(fmtSmallPrice(4231.7), '$4,231.70');
  assert.equal(fmtSmallPrice(0), '$0.00');
  assert.equal(fmtSmallPrice(null), '$0.00');
});

test('searchRowPrice：没行情给「—」，涨跌决定颜色类与符号', () => {
  assert.deepEqual(searchRowPrice(null), { p: '—', c: '', cls: 'flat' });
  const up = searchRowPrice({ price: 231.3, changePct: 2.63 });
  assert.equal(up.p, '$231.30');
  assert.equal(up.c, '+2.63%');
  assert.equal(up.cls, 'up');
  const down = searchRowPrice({ price: 361.1, changePct: -2.97 });
  assert.equal(down.c, '-2.97%');
  assert.equal(down.cls, 'down');
  assert.equal(searchRowPrice({ price: 10 }).cls, 'flat', '没有涨跌数据算平盘');
});

test('pricePillHTML：含代码与价格，真行情才画圆点，涨跌带符号与颜色', () => {
  const real = pricePillHTML('VGT', 125.1, 1.07, 'yahoo');
  assert.match(real, /data-sym="VGT"/);
  assert.match(real, /data-price="125.10"/);
  assert.match(real, /class="live-dot"/);
  assert.match(real, /\+1\.07/);
  assert.match(real, /var\(--accent\)/);
  const cached = pricePillHTML('SMH', 600, -6.55, '缓存');
  assert.doesNotMatch(cached, /live-dot/);
  assert.match(cached, /var\(--red\)/);
  const manual = pricePillHTML('BTC', 36.86, null, 'manual');
  assert.doesNotMatch(manual, /live-dot/);
  assert.doesNotMatch(manual, /pp-chg/);
  assert.match(manual, /manual<\/small>/, '来源文字照常显示');
});
