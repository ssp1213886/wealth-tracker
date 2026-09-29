#!/usr/bin/env node
// 静态审计（纯 Node，可进 CI）：把"接线断了但看不出来"的问题在最便宜的地方拦下来。
//   ① JS 引用的 id 是否都存在（动态创建的 id 除外）
//   ② JS 渲染出来的按钮有没有监听器 / data-* 有没有人读
//   ③ inline onclick 调用的函数是否都导出到 window（IIFE 打包下的经典死按钮）
// 退出码非 0 表示发现真问题；纯提示类（如残留属性）只打印不失败。
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
// DOM 相关的模块都要扫：漏一个，它创建的动态 id 就会被当成"死 id"（v247 踩过）
const appFiles = ['src/app/index.js', 'src/app/rows.js', 'src/app/render.js', 'src/app/watch.js', 'src/app/sync-view.js'];
const html = read('public/index.html');
const app = appFiles.map(read).join('\n');

const problems = [];
const notes = [];

/* ① JS 引用但 HTML 里不存在的 id（排除 JS 动态创建的） */
const htmlIds = new Set([...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
const jsIds = new Set([
  ...[...app.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
  ...[...app.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]),
]);
const dynamicIds = new Set([
  // 动态创建的 id：`el.id='x'` / `el.id = "x"` 都要认（v247：新模块里带空格就漏了）
  ...[...app.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)].map((m) => m[1]),
  ...[...app.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]), // 动态 innerHTML 里写的 id
]);
const deadIds = [...jsIds].filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
if (deadIds.length) problems.push('JS 引用了不存在（且非动态创建）的 id：' + deadIds.join(', '));

/* ② 渲染出来的 data-* 有没有人读 */
const written = new Set([...app.matchAll(/data-([a-z0-9-]+)=/g)].map((m) => m[1]));
const readAttrs = new Set([
  ...[...app.matchAll(/dataset\.([A-Za-z0-9]+)/g)].map((m) => m[1].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())),
  ...[...app.matchAll(/getAttribute\('data-([a-z0-9-]+)'\)/g)].map((m) => m[1]),
  ...[...app.matchAll(/closest\('\[data-([a-z0-9-]+)/g)].map((m) => m[1]),
  ...[...app.matchAll(/querySelectorAll?\('\[data-([a-z0-9-]+)/g)].map((m) => m[1]),
]);
// data-cell 是给 CSS 用的选择器钩子，不算无人读取
const cssHooks = new Set(['cell']);
const orphanAttrs = [...written].filter((a) => !readAttrs.has(a) && !cssHooks.has(a));
if (orphanAttrs.length) notes.push('渲染了但 JS 不读的 data-*（确认是 CSS 钩子即可）：' + orphanAttrs.join(', '));

/* ③ inline onclick 的函数是否导出到 window */
const called = new Set();
const collect = (text, re) => {
  for (const m of text.matchAll(re)) {
    const fn = m[1].match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (fn) called.add(fn[1]);
  }
};
collect(html, /onclick="([^"]*)"/g);
collect(html, /onclick='([^']*)'/g);
collect(app, /onclick=\\?"([^"\\]*)"/g);
collect(app, /onclick=\\?'([^'\\]*)'/g);
collect(app, /onclick=([A-Za-z_$][\w$]*)\(/g);
const globalsLine = (app.match(/var __globals=\{[\s\S]*?\};/) || [''])[0];
const exported = new Set([...globalsLine.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));
const builtins = new Set(['location', 'window', 'document', 'alert', 'confirm', 'if']);
const missingGlobals = [...called].filter((n) => !exported.has(n) && !builtins.has(n));
if (missingGlobals.length) problems.push('inline onclick 调用了没导出到 window 的函数（点了会 ReferenceError）：' + missingGlobals.join(', '));

/* ④ 空 catch：静默吞异常，历史上藏过"同步失败没提示"这类问题，禁止新增 */
const emptyCatches = app.match(/catch\s*\(\s*\w+\s*\)\s*\{\s*\}|catch\s*\{\s*\}/g) || [];
if (emptyCatches.length) {
  problems.push('有 ' + emptyCatches.length + ' 处空 catch（静默吞异常）——请写成 catch(e){logSwallowed("函数名",e)} 之类，至少留下痕迹');
}

/* ⑤ 跨模块调用必须 import。
   v248 踩过：把函数搬到新模块后，index.js 的调用点忘了补 import ——
   打包不会报错（ESM 里那只是个"全局变量"引用），只在运行到那条路径时 ReferenceError
   （当时是 switchTab 里的 setMobileSettings，靠 e2e 全页爬查才抓到）。
   判据：某个名字是别的模块的导出、本文件在调用它，但既没 import 也没在本文件声明。 */
{
  const dir = new URL('src/app/', ROOT);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const sources = new Map(files.map((f) => [f, fs.readFileSync(new URL(f, dir), 'utf8')]));
  const exported = new Set();
  sources.forEach((src) => {
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  });
  const missing = [];
  sources.forEach((src, file) => {
    const imported = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      m[1].split(',').forEach((part) => {
        const t = part.trim();
        if (!t) return;
        const alias = t.split(/\s+as\s+/);
        imported.add((alias[1] || alias[0]).trim());
      });
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) imported.add(m[1]);
    const local = new Set();
    for (const m of src.matchAll(/(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
    exported.forEach((name) => {
      if (imported.has(name) || local.has(name)) return;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[^.\\w$])' + esc + '\\s*\\(', 'm').test(src)) missing.push(file + ' → ' + name);
    });
  });
  if (missing.length) problems.push('调用了别的模块的导出却没 import（运行到那条路径会 ReferenceError）：' + missing.join(', '));
}

/* 输出 */
console.log('静态审计：JS 引用 ' + jsIds.size + ' 个 id，渲染 button/属性 ' + written.size + ' 种，空 catch ' + emptyCatches.length + ' 处');
notes.forEach((n) => n && console.log('  · ' + n));
if (problems.length) {
  console.error('\n发现问题：\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('  ✓ 没有死 id / 死按钮 / 未导出的 inline onclick');
