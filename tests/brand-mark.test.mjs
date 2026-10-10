// 徽标解析链：内置位图 → 矢量 → 远程 → 字母兜底（顺序见 src/app/brand-mark.js）。
// v385：IBIT 从"借比特币的矢量标"改成发行方 iShares 的位图 —— 这里守住"用对品牌"，
// 并顺手守住"索引不指向不存在的文件"（否则界面会静默变成空白格）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { brandMarkFor, brandBadgeHTML } from '../src/app/brand-mark.js';
import { BRAND_LOGO_SYMS, WHITE_LOGO_SYMS, brandLogoFor } from '../src/app/brand-logos.js';
import { SYM_TO_BRAND, BRAND_ICONS } from '../src/app/brand-icons.js';

test('v385：IBIT 用发行方 iShares 的位图，不再借比特币的矢量标', () => {
  const mark = brandMarkFor('IBIT');
  assert.equal(mark.kind, 'img', 'IBIT 应该走内置位图');
  assert.equal(mark.src, '/assets/logo/IBIT.png');
  assert.equal(SYM_TO_BRAND.IBIT, undefined, 'IBIT 不该再映射到 bitcoin');
  assert.equal(SYM_TO_BRAND.BTC, 'bitcoin', '现货 BTC 仍然用比特币标');
  assert.match(brandBadgeHTML('IBIT'), /\/assets\/logo\/IBIT\.png/);
});

test('位图索引不许指向不存在的文件（防"改完图标变空白"）', () => {
  const missing = Object.keys(BRAND_LOGO_SYMS)
    .filter((sym) => !fs.existsSync('public/assets/logo/' + sym + '.' + BRAND_LOGO_SYMS[sym]));
  assert.deepEqual(missing, [], '这些索引没有对应文件：' + missing.join(','));
});

test('矢量品牌表的每个键都在 BRAND_ICONS 里（防写错 slug 后静默回落字母徽标）', () => {
  const bad = Object.keys(SYM_TO_BRAND).filter((k) => !BRAND_ICONS[SYM_TO_BRAND[k]]);
  assert.deepEqual(bad, [], '这些代码映射到了不存在的品牌键');
});

test('WHITE_LOGO_SYMS 只登记存在的位图代码', () => {
  const bad = WHITE_LOGO_SYMS.filter((s) => !BRAND_LOGO_SYMS[s]);
  assert.deepEqual(bad, [], '这些"白 logo"代码没有位图');
});

test('v385：退役的 BTCG 索引已清掉（第三腿换成 IBIT 后没有任何引用）', () => {
  assert.equal(BRAND_LOGO_SYMS.BTCG, undefined);
  assert.equal(brandLogoFor('BTCG'), null);
});
