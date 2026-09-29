// C1 第一批执行：按 tmp/important-safe-final.json 里"四组合 × 四伪类状态都证明冗余"的清单，
// 去掉 main.css 里对应的 !important 标记（**只删标记，不删声明**）。
// 纪律：每条候选都必须精确命中一次，命中数不符就抛错、不写文件。
const fs = await import('node:fs');
const CSS = 'public/assets/main.css';
const LIST = 'tmp/important-safe-final.json';
const src = fs.readFileSync(CSS, 'utf8');
const alive = JSON.parse(fs.readFileSync(LIST, 'utf8')).alive || [];

/* ---------- 解析（与 _css-merge.mjs 同一套，够用即可） ---------- */
function parseRules(css) {
  const rules = [];
  const stack = [];
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i += 1; while (i < css.length && css[i] !== q) { if (css[i] === '\\') i += 1; i += 1; } i += 1; continue; }
    if (ch === '}') { stack.pop(); i += 1; continue; }
    if (ch === '{') {
      let j = i - 1;
      while (j >= 0 && css[j] !== '}' && css[j] !== '{' && css[j] !== ';') j -= 1;
      const head = css.slice(j + 1, i).trim();
      if (head.startsWith('@')) { stack.push(head.replace(/\s+/g, '')); i += 1; continue; }
      let depth = 1;
      let k = i + 1;
      while (k < css.length && depth > 0) {
        const c = css[k];
        if (c === '/' && css[k + 1] === '*') { const e = css.indexOf('*/', k + 2); k = e < 0 ? css.length : e + 2; continue; }
        if (c === '"' || c === "'") { const q = c; k += 1; while (k < css.length && css[k] !== q) { if (css[k] === '\\') k += 1; k += 1; } k += 1; continue; }
        if (c === '{') depth += 1; else if (c === '}') depth -= 1;
        k += 1;
      }
      const bodyStart = i + 1;
      const bodyEnd = k - 1;
      const decls = [];
      let d = bodyStart;
      while (d < bodyEnd) {
        const semi = (() => { let p = d; while (p < bodyEnd) { const c = css[p]; if (c === '/' && css[p + 1] === '*') { const e = css.indexOf('*/', p + 2); p = e < 0 ? bodyEnd : e + 2; continue; } if (c === '"' || c === "'") { const q = c; p += 1; while (p < bodyEnd && css[p] !== q) { if (css[p] === '\\') p += 1; p += 1; } p += 1; continue; } if (c === ';') return p; p += 1; } return bodyEnd; })();
        const chunk = css.slice(d, semi);
        const colon = (() => { let inParen = 0; for (let p = 0; p < chunk.length; p += 1) { if (chunk[p] === '(') inParen += 1; else if (chunk[p] === ')') inParen -= 1; else if (chunk[p] === ':' && inParen === 0) return p; } return -1; })();
        if (colon >= 0) {
          const raw = chunk.slice(colon + 1).trim();
          decls.push({ prop: chunk.slice(0, colon).trim(), value: raw, important: /!important\s*$/i.test(raw), start: d, end: semi === bodyEnd ? bodyEnd : semi + 1 });
        }
        d = semi + 1;
      }
      rules.push({ ctx: stack.join(' && '), sel: head.replace(/\s+/g, ' '), decls: decls });
      i = k;
      continue;
    }
    i += 1;
  }
  return rules;
}

const norm = (s) => String(s || '').replace(/\s+/g, '');
const normVal = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
// 浏览器给的 selectorText / mediaText 与源码写法有空白差异，统一成"去掉所有空白"再比；
// 媒体那边还要去掉源码里的 "@media" 前缀（候选里存的是 mediaText，不带它）
const normSel = (s) => norm(s);
const normMedia = (s) => norm(s).replace(/@media/g, '').replace(/^and/, '');

// CSSOM 会把简写展开成 longhand（源码写 padding，候选里是 padding-top/right/bottom/left），
// 所以反过来按"源码声明"判断：这个声明的每个 longhand 都在候选清单里 → 才去掉它的 !important。
const SHORTHANDS = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  gap: ['row-gap', 'column-gap'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  inset: ['top', 'right', 'bottom', 'left'],
};
const rules = parseRules(src);
const candSet = new Set(alive.map((c) => normMedia(c.media) + '||' + normSel(c.sel) + '||' + c.prop + '||' + normVal(c.value)));
const cuts = [];
const kept = [];
for (const r of rules) {
  const ctxKey = normMedia(r.ctx);
  const selKey = normSel(r.sel);
  for (const d of r.decls) {
    if (!d.important) continue;
    const val = d.value.replace(/!important\s*$/i, '').trim();
    const longs = SHORTHANDS[d.prop];
    // 多值简写（padding: 8px 4px）保守跳过：四边值不同，逐边判定容易出错
    if (longs && /\s/.test(val)) { kept.push(d.prop); continue; }
    const targets = longs || [d.prop];
    const covered = targets.every((lh) => candSet.has(ctxKey + '||' + selKey + '||' + lh + '||' + normVal(val)));
    if (!covered) continue;
    const seg = src.slice(d.start, d.end);
    const idx = seg.toLowerCase().lastIndexOf('!important');
    if (idx < 0) continue;
    let s = d.start + idx;
    while (s > d.start && /\s/.test(src[s - 1])) s -= 1;
    cuts.push([s, d.start + idx + '!important'.length]);
  }
}
if (!cuts.length) throw new Error('一条都没匹配上，先检查匹配逻辑');

const beforeCount = (src.match(/!important/g) || []).length;
cuts.sort((a, b) => b[0] - a[0]);
let out = src;
cuts.forEach(([a, b]) => { out = out.slice(0, a) + out.slice(b); });
fs.writeFileSync(CSS, out, 'utf8');
console.log('✓ 去掉 ' + cuts.length + ' 个 !important；' + beforeCount + ' → ' + (out.match(/!important/g) || []).length);
