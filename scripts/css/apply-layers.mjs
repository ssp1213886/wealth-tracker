#!/usr/bin/env node
// C1 步骤一（v322）：把主样式表拆成两个 CSS 层。
//
//   @layer base       —— 基础规则（默认态）
//   @layer responsive —— @media (max-width:800px) / (max-width:360px) 的移动端覆盖层
//
// 目的：让"移动端覆盖"靠**层序**取胜（写在后面的层天然赢过前面的层，与选择器特异性无关），
// 而不是靠一层层堆 !important 去压特异性。**本脚本只做结构重排，不改任何声明**：
// 产出的文件里 !important 数量必须与输入完全一致（断言）。
//
// 验证纪律（照 v254/v255 的流程）：改完必须用 scripts/e2e/style-fingerprint.mjs
// 跑"手机/桌面 × 明/暗"四组合对比，**零差异**才算通过（#roadBar 随时间变化，历来排除）。
//
// ⚠️ **实测结论（v322）：这条路不能一把梭。** 把"基础规则"与"移动端覆盖层"整表分成两层后，
//    四组合渲染指纹出现 **308 处计算样式变化、还少了 2 个元素** —— 现有 CSS 大量依赖
//    "写在后面的规则覆盖前面的规则"这种**顺序语义**，而层序会整体压过它。
//    （同时实测：同一构建两次采样的噪声地板约 10–25 处，集中在时钟/进度条/回撤这些时间相关元素上；
//      308 与这个量级完全不是一回事。）
//    → 结论：层叠重写只能**按选择器簇逐块做**（每次只搬一小簇 + 四组合指纹验证），
//      本脚本留作**分析与对比工具**（默认只报告，不改文件）。
//
// 用法：node scripts/css/apply-layers.mjs             （默认 --dry：只报告分层方案与自检）
//      node scripts/css/apply-layers.mjs --write     （真的改写，先备份到 tmp/）
import fs from 'node:fs';

const CSS = 'public/assets/main.css';
const RESPONSIVE_RE = /^@media[^{]*max-width:\s*(800|360)px/i;
const src = fs.readFileSync(CSS, 'utf8');

/** 顶层扫描：找出所有顶层 at-rule 块（带起止下标），跳过注释与字符串里的花括号。 */
function topLevelAtRules(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i += 1; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i += 1; i += 1; } i += 1; continue; }
    if (ch === '@') {
      const start = i;
      let j = i;
      while (j < css.length && css[j] !== '{' && css[j] !== ';') j += 1;
      if (css[j] === ';') { i = j + 1; continue; }          // @charset 之类，不是块
      let depth = 0;
      let k = j;
      for (; k < css.length; k += 1) {
        if (css[k] === '/' && css[k + 1] === '*') { const end = css.indexOf('*/', k + 2); k = end < 0 ? css.length : end + 1; continue; }
        if (css[k] === '"' || css[k] === "'") { const q = css[k]; k += 1; while (k < css.length && css[k] !== q) { if (css[k] === '\\') k += 1; k += 1; } continue; }
        if (css[k] === '{') depth += 1;
        else if (css[k] === '}') { depth -= 1; if (depth === 0) break; }
      }
      out.push({ prelude: css.slice(start, j).trim(), raw: css.slice(start, k + 1) });
      i = k + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

const atRules = topLevelAtRules(src);
const responsive = atRules.filter((r) => RESPONSIVE_RE.test(r.prelude));
if (!responsive.length) throw new Error('没找到任何 max-width:800px / 360px 的顶层 @media 块，脚本前提不成立');

let base = src;
for (const block of responsive) {
  const n = base.split(block.raw).length - 1;
  if (n !== 1) throw new Error('切片不唯一（' + block.prelude.slice(0, 40) + '）：命中 ' + n + ' 次');
  base = base.replace(block.raw, '');
}

const layered =
  '/* v322：层叠重写第一步 —— 基础层与移动端覆盖层分离。\n' +
  '   覆盖层从此靠"层序"取胜（层序 > 特异性），后续可逐步摘掉压在里面的强制标记。\n' +
  '   浏览器支持：@layer 需要 Chrome 99+ / Safari 15.4+ / Firefox 97+（2022 年起）。 */\n' +
  '@layer base, responsive;\n\n' +
  '@layer base {\n' + base.trim() + '\n}\n\n' +
  '@layer responsive {\n' + responsive.map((r) => r.raw).join('\n\n') + '\n}\n';

const beforeCount = (src.match(/!important/g) || []).length;
const afterCount = (layered.match(/!important/g) || []).length;
if (beforeCount !== afterCount) {
  throw new Error('只该做结构重排，但 !important 数量变了：' + beforeCount + ' → ' + afterCount);
}

console.log('顶层 at-rule 块 ' + atRules.length + ' 个，其中移动端覆盖层 ' + responsive.length + ' 个');
console.log('大小 ' + (src.length / 1024).toFixed(1) + 'KB → ' + (layered.length / 1024).toFixed(1) + 'KB');
console.log('!important 数量不变：' + beforeCount);

if (process.argv.includes('--write')) {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/main.css.before-layers', src, 'utf8');   // 备份，便于随时对比/回退
  fs.writeFileSync(CSS, layered, 'utf8');
  console.log('已写入 ' + CSS + '（原文件备份在 tmp/main.css.before-layers）');
} else {
  console.log('（默认不写文件；确实要试就加 --write，并立刻跑四组合指纹验证）');
}
