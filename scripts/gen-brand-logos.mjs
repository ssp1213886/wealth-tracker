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
  'invesco.com': ['QQQM', 'QQQ'],
  // 下面几家源图太小（实测 16×16 或 32×32，iPhone 3x 下必糊），改用品牌色字母徽标：
  // ishares.com → SGOV/IWM/TLT、unitedhealthgroup.com → UNH、exxonmobil.com → XOM、
  // oracle.com → ORCL、salesforce.com → CRM、onsemi.com → ON、cadence.com → CDNS
  'ssga.com': ['SPY'],
  'jpmorganchase.com': ['JPM'],
  'costco.com': ['COST'],
  'lilly.com': ['LLY'],
  'grayscale.com': ['BTCG'],
  'microsoft.com': ['MSFT'],
  'amazon.com': ['AMZN'],
  'adobe.com': ['ADBE'],
  'ibm.com': ['IBM'],
  'micron.com': ['MU'],
  // tsmc.com 也不放：官网 403、各子域和 DuckDuckGo 给的图标分别是 263 字节 / 16×16，缩到 18px 必糊。
  // TSM 改用 TSMC 品牌红（#D6001C）的字母徽标 —— 见 brand-icons.js 的 BRAND_COLORS。
  'servicenow.com': ['NOW'],
  'appliedmaterials.com': ['AMAT'],
  'lamresearch.com': ['LRCX'],
  'kla.com': ['KLAC'],
  'asml.com': ['ASML'],
  'analog.com': ['ADI'],
  'ti.com': ['TXN'],
  'nxp.com': ['NXPI'],
  'marvell.com': ['MRVL'],
  'st.com': ['STM'],
  'arm.com': ['ARM'],
  'hyperliquid.xyz': ['HYPE'],
};

/**
 * 实测发现 FMP 对这几家返回的是"白底白字"图（canvas 扫出来有效像素 0%、最低亮度 255），
 * 直接放在浅色徽标底上就是一片空白 —— 渲染层会给它们换深色底（见 brand-mark.js / main.css）。
 */
const WHITE_LOGOS = ['IBM', 'MRVL', 'ON', 'QQQ', 'SMH', 'UNH'];

/** 这几家的 FMP 图太淡/太细（扫出来墨迹 <1%），18px 下看不清，改走品牌色字母徽标 */
const FMP_EXCLUDE = ['CDNS'];

const files = fs.readdirSync(SRC);
const byDomain = {};
const data = {};
let total = 0;
const missing = [];

// ① 最高优先级：FMP 抓来的公司图标（已用浏览器缩到 64×64 webp，覆盖最全、最清晰）
const minIndex = fs.existsSync(path.join(SRC, 'min-index.json'))
  ? JSON.parse(fs.readFileSync(path.join(SRC, 'min-index.json'), 'utf8'))
  : {};
let fmpCount = 0;
for (const [sym, file] of Object.entries(minIndex)) {
  if (FMP_EXCLUDE.indexOf(sym) >= 0) continue;
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) continue;
  const url = fs.readFileSync(p, 'utf8').trim();
  if (!/^data:image\//.test(url)) continue;
  data[sym] = url;
  total += url.length;
  fmpCount += 1;
}

// ② 其次：各品牌官网的 apple-touch-icon / favicon（补 FMP 没有的，比如某些基金）
for (const [domain, syms] of Object.entries(DOMAIN_SYMBOLS)) {
  // 优先用 apple-touch-icon（一般 152×152，比 favicon 清晰得多），其次才是 favicon
  const file = files.find((f) => f.startsWith('touch-' + domain + '.')) || files.find((f) => f.startsWith(domain + '.'));
  if (!file) { missing.push(domain); continue; }
  const buf = fs.readFileSync(path.join(SRC, file));
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.svg$/i.test(file) ? 'image/svg+xml' : 'image/png';
  const url = 'data:' + mime + ';base64,' + buf.toString('base64');
  syms.forEach((s) => { if (!data[s]) { data[s] = url; total += url.length; } });
  byDomain[domain] = { syms: syms, bytes: buf.length };
}

const out = `// 品牌位图标（favicon，内联 base64）——由 \`node scripts/gen-brand-logos.mjs\` 生成，别手改。
// 用于 simple-icons 没有矢量的品牌（Vanguard / Microsoft / Amazon 等受版权保护的图形标）。
// 运行时零网络请求；商标权属各公司，这里仅用于"指代该标的"的展示。

export const BRAND_LOGOS = ${JSON.stringify(data, null, 2)};

/** 这些代码的图标是"白色 logo"，要配深色底才看得见。 */
export const WHITE_LOGO_SYMS = ${JSON.stringify(WHITE_LOGOS)};

/** 代码 → data URL；没有的返回 null（调用方继续回落字母徽标）。 */
export function brandLogoFor(sym) {
  return BRAND_LOGOS[String(sym || '').toUpperCase()] || null;
}
`;
fs.writeFileSync('src/app/brand-logos.js', out, 'utf8');
console.log('✓ 生成 src/app/brand-logos.js：' + Object.keys(data).length + ' 个代码（其中公司图标 ' + fmpCount + ' 个）/' + Object.keys(byDomain).length + ' 个域名，' + (out.length / 1024).toFixed(1) + 'KB（内联）');
console.log('  原始图片合计 ' + (Object.values(byDomain).reduce((n, x) => n + x.bytes, 0) / 1024).toFixed(1) + 'KB');
if (missing.length) console.log('  缺文件：' + missing.join(', '));
