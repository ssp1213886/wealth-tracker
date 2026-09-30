#!/usr/bin/env node
// 把抓好的 favicon（tmp/brand-logos/*.png|jpg）转成内联 base64 模块 src/app/brand-logos.js。
// 抓取步骤（需要能访问 google favicon 服务，开 VPN 时用 PowerShell 跑）：
//   见仓库外的 _grab-favicons.ps1；结果落在 tmp/brand-logos/。
// 为什么要位图兜底：Vanguard / Microsoft / Amazon 这类 logo 受版权保护，开源矢量库（simple-icons、
// svgl、Wikimedia）都收不了；favicon 是品牌官网自己的图标，覆盖最全。抓一次内联进项目 → 运行时零请求。
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'tmp/brand-logos';
if (!fs.existsSync(SRC)) {
  console.error('找不到 ' + SRC + '，先按 _grab-favicons.ps1 抓一遍 favicon');
  process.exit(1);
}

/** 域名 → 会用这个图标的一组代码 */
const DOMAIN_SYMBOLS = {
  'vanguard.com': ['VGT', 'VOO'],
  // vaneck.com 故意不放：官网只给了 321×76 的横长条文字标和一张 545 字节的低清图标，
  // 缩到 18px 必然糊 —— SMH 改用"品牌蓝 + V"的字母徽标（见 brand-icons.js 的 BRAND_COLORS）。
  'invesco.com': ['QQQM'],
  'ishares.com': ['SGOV'],
  'grayscale.com': ['BTCG'],
  'microsoft.com': ['MSFT'],
  'amazon.com': ['AMZN'],
  'oracle.com': ['ORCL'],
  'salesforce.com': ['CRM'],
  'adobe.com': ['ADBE'],
  'ibm.com': ['IBM'],
  'micron.com': ['MU'],
  'tsmc.com': ['TSM'],
  'servicenow.com': ['NOW'],
  'appliedmaterials.com': ['AMAT'],
  'lamresearch.com': ['LRCX'],
  'kla.com': ['KLAC'],
  'asml.com': ['ASML'],
  'analog.com': ['ADI'],
  'ti.com': ['TXN'],
  'nxp.com': ['NXPI'],
  'marvell.com': ['MRVL'],
  'onsemi.com': ['ON'],
  'st.com': ['STM'],
  'arm.com': ['ARM'],
  'cadence.com': ['CDNS'],
  'hyperliquid.xyz': ['HYPE'],
};

const files = fs.readdirSync(SRC);
const byDomain = {};
const data = {};
let total = 0;
const missing = [];
for (const [domain, syms] of Object.entries(DOMAIN_SYMBOLS)) {
  const file = files.find((f) => f.startsWith(domain + '.'));
  if (!file) { missing.push(domain); continue; }
  const buf = fs.readFileSync(path.join(SRC, file));
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.svg$/i.test(file) ? 'image/svg+xml' : 'image/png';
  const url = 'data:' + mime + ';base64,' + buf.toString('base64');
  total += url.length;
  syms.forEach((s) => { data[s] = url; });
  byDomain[domain] = { syms: syms, bytes: buf.length };
}

const out = `// 品牌位图标（favicon，内联 base64）——由 \`node scripts/gen-brand-logos.mjs\` 生成，别手改。
// 用于 simple-icons 没有矢量的品牌（Vanguard / Microsoft / Amazon 等受版权保护的图形标）。
// 运行时零网络请求；商标权属各公司，这里仅用于"指代该标的"的展示。

export const BRAND_LOGOS = ${JSON.stringify(data, null, 2)};

/** 代码 → data URL；没有的返回 null（调用方继续回落字母徽标）。 */
export function brandLogoFor(sym) {
  return BRAND_LOGOS[String(sym || '').toUpperCase()] || null;
}
`;
fs.writeFileSync('src/app/brand-logos.js', out, 'utf8');
console.log('✓ 生成 src/app/brand-logos.js：' + Object.keys(data).length + ' 个代码 / ' + Object.keys(byDomain).length + ' 个域名，' + (out.length / 1024).toFixed(1) + 'KB（内联 base64）');
console.log('  原始图片合计 ' + (Object.values(byDomain).reduce((n, x) => n + x.bytes, 0) / 1024).toFixed(1) + 'KB');
if (missing.length) console.log('  缺文件：' + missing.join(', '));
