#!/usr/bin/env node
// 从 simple-icons（CC0）生成 src/app/brand-icons.js —— 只挑"我们会用到的标的"，
// 把每个品牌的官方品牌色 + 24×24 单路径内联进项目（运行时零网络请求、离线可用）。
//
//   npm i --no-save simple-icons && node scripts/gen-brand-icons.mjs
//
// 注意：商标权仍属各公司；这里只做"指代该标的"的展示用途。查不到的品牌由渲染层用字母徽标兜底。
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let si;
try {
  si = require('simple-icons');
} catch (e) {
  console.error('先装依赖：npm i --no-save simple-icons');
  process.exit(1);
}
const bySlug = new Map(Object.values(si).filter((i) => i && i.slug).map((i) => [i.slug, i]));

/** 品牌键 → simple-icons 的 slug（同一品牌多个候选时按顺序取第一个存在的） */
const BRANDS = {
  nvidia: ['nvidia'],
  apple: ['apple'],
  google: ['google'],
  meta: ['meta'],
  tesla: ['tesla'],
  broadcom: ['broadcom'],
  amd: ['amd'],
  intel: ['intel'],
  qualcomm: ['qualcomm'],
  netflix: ['netflix'],
  microstrategy: ['microstrategy'],
  circle: ['circle'],
  palantir: ['palantir'],
  bitcoin: ['bitcoin'],
  ethereum: ['ethereum'],
  binance: ['binance'],
  solana: ['solana'],
};

/** 股票代码 → 品牌键（同品牌共用；没登记的走字母徽标兜底） */
const SYMBOLS = {
  NVDA: 'nvidia',
  AAPL: 'apple',
  GOOGL: 'google',
  META: 'meta',
  TSLA: 'tesla',
  AVGO: 'broadcom',
  AMD: 'amd',
  INTC: 'intel',
  QCOM: 'qualcomm',
  NFLX: 'netflix',
  MSTR: 'microstrategy',
  CRCL: 'circle',
  PLTR: 'palantir',
  BTC: 'bitcoin',
  BTCETF: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binance',
  SOL: 'solana',
};

const icons = {};
const missing = [];
for (const [key, slugs] of Object.entries(BRANDS)) {
  const hit = slugs.map((s) => bySlug.get(s)).find(Boolean);
  if (!hit) { missing.push(key + '（' + slugs.join('/') + '）'); continue; }
  icons[key] = { hex: String(hit.hex).toUpperCase(), path: hit.path, title: hit.title };
}

const usedSymbols = Object.fromEntries(Object.entries(SYMBOLS).filter(([, key]) => icons[key]));
const out = `// 品牌图标（simple-icons，CC0 1.0）——由 \`node scripts/gen-brand-icons.mjs\` 生成，别手改。
// 每个条目是 24×24 viewBox 的单路径 + 官方品牌色；运行时零网络请求，离线也能显示。
// 商标权仍属各公司：这里仅用于"指代该标的"的展示。查不到的品牌由渲染层用字母徽标兜底。

export const BRAND_ICONS = ${JSON.stringify(icons, null, 2)};

/** 股票/基金代码 → 品牌键（同品牌共用，例如 BTC 与 BTCETF 都用比特币标） */
export const SYM_TO_BRAND = ${JSON.stringify(usedSymbols, null, 2)};

/** 代码 → { hex, path }；没有登记品牌的返回 null（调用方走字母徽标）。 */
export function brandIconFor(sym) {
  const key = SYM_TO_BRAND[String(sym || '').toUpperCase()];
  return key ? BRAND_ICONS[key] || null : null;
}
`;

fs.writeFileSync('src/app/brand-icons.js', out, 'utf8');
console.log('✓ 生成 src/app/brand-icons.js：' + Object.keys(icons).length + ' 个品牌 / ' + Object.keys(usedSymbols).length + ' 个代码，' + (out.length / 1024).toFixed(1) + 'KB');
if (missing.length) console.log('  缺（走字母兜底）：' + missing.join('、'));
