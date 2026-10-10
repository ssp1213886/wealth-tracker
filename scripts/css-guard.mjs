// 样式债守卫（可单测）：!important 预算 + :hover 必须包在可悬停媒体查询里。
// 为什么单独成模块：这两个规则以前只写在 lint 里，没法单测，也就没人敢改。
// 现在 lint 与 tests/css-guard.test.mjs 共用同一份实现。

/** 当前样式债基线：只允许减少，不允许增加。每还一笔债就把它调小。 */
// 只减不增：每次还掉一批就同步下调这里，否则债务可以悄悄加回去。
// v241: 1608 → 1605；v254（C1 第一批）: 1605 → 1519；v255（第二批）: 1519 → 1511
export const IMPORTANT_BUDGET = 1511;

/** 统计 !important 出现次数（注意：注释里的也算，避免用注释绕过预算）。 */
export function countImportant(css) {
  return (css.match(/!important/g) || []).length;
}

/** 找出所有「可悬停」媒体查询的 [起, 止) 区间。 */
export function hoverMediaRanges(css) {
  const ranges = [];
  const headerRe = /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*and\s*\(\s*pointer\s*:\s*fine\s*\)\s*\{/g;
  let m;
  while ((m = headerRe.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

/** 所有 @media 头部的 [起, 止) 区间——用来排除头部里那句 `hover:hover` 本身的干扰。 */
export function mediaHeaderSpans(css) {
  const spans = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

/**
 * 真正的 `:hover` 选择器出现位置（不含 @media 头部里那句条件）。
 * 之前的实现把 `@media (hover:hover)` 头部也算成一条"规则"，导致统计虚高。
 */
export function hoverRulePositions(css) {
  const headers = mediaHeaderSpans(css);
  const inHeader = (pos) => headers.some(([a, b]) => pos > a && pos < b);
  const out = [];
  const re = /:hover/g;
  let m;
  while ((m = re.exec(css))) if (!inHeader(m.index)) out.push(m.index);
  return out;
}

/**
 * 列出没被 `@media (hover:hover) and (pointer:fine)` 包住的 :hover 规则片段。
 * 触摸设备上未包裹的 hover 会在点击后"粘住"高亮，是硬性约束要拦住的。
 */
export function findUnwrappedHover(css) {
  const ranges = hoverMediaRanges(css);
  const inside = (pos) => ranges.some(([a, b]) => pos > a && pos < b);
  const bad = [];
  hoverRulePositions(css).forEach((pos) => {
    if (inside(pos)) return;
    let s = pos;
    while (s > 0 && css[s - 1] !== '}' && css[s - 1] !== '{' && css[s - 1] !== '\n') s -= 1;
    let e = pos;
    while (e < css.length && css[e] !== '{' && css[e] !== '}') e += 1;
    bad.push(css.slice(s, Math.min(e, s + 120)).replace(/\s+/g, ' ').trim());
  });
  return bad;
}

/**
 * 表达"数据状态"的选择器（涨跌/盈亏/方向/正负）。
 *
 * 这些地方的颜色**必须是不随配色方案变的语义色**（`--ok` / `--danger` / `--warn` / `--muted`）。
 * 用 `--accent` 会出问题：v385 之前 `.pnl-pos`、`.watch-chg.is-up`、回撤卡的最低档全是 `var(--accent)`，
 * 于是同一个"上涨"信号 —— forest 下是绿、ocean 下是蓝、warm 下是橙（＝警告色）、
 * **plum 下是紫（与 VGT 的资产色 `--violet` 完全相同）**、mono 下是灰（等于没有信号）。
 * 实测数据见 maintenance.md 的 v385 条目。
 */
// 注意别加"前面必须是非单词字符"的守卫：复合选择器（`.watch-chg.is-up`）里 `.is-up` 前面就是字母 `g`，
// 加了守卫会把最常见的那种写法漏掉（第一版就踩了这个）。类名前有 `.` 本身就足以避免"匹配到某个长类名的一截"。
const SEMANTIC_SELECTOR_RE =
  /\.(?:pnl-(?:pos|neg)|is-(?:up|down)|positive|negative|cash-(?:pos|neg)|ms-(?:pos|neg))\b|span\.(?:pos|neg)\b/;

/** 找出"数据状态选择器里用了 var(--accent*)"的规则；返回选择器列表（空 = 干净）。 */
export function findAccentInSemanticRules(css) {
  // 注释先剥掉：这个守卫拦的是真代码，解释性注释里提到 --accent 不算违规
  // （与 countImportant 刻意统计注释的取向相反，那条是防"用注释绕过预算"）。
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const hits = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(src)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    if (!body.includes('var(--accent')) continue;
    if (!SEMANTIC_SELECTOR_RE.test(selector)) continue;
    hits.push(selector.slice(0, 80));
  }
  return hits;
}

/** 统一的样式检查入口，返回错误信息数组（空数组 = 通过）。 */
export function checkStyles(css, budget = IMPORTANT_BUDGET) {
  const errors = [];
  const important = countImportant(css);
  const hoverAll = hoverRulePositions(css).length;
  const badHover = findUnwrappedHover(css);
  const semanticAccent = findAccentInSemanticRules(css);
  if (important > budget) {
    errors.push(
      'public/assets/main.css: !important 数量 ' + important + ' 超过基线 ' + budget +
        '（只减不增）。请用更具体的语义选择器替代（如 #tab-data #holdBody td[data-cell="pnl"]），' +
        '或先在别处还掉一笔债再新增。',
    );
  }
  if (badHover.length) {
    errors.push(
      'public/assets/main.css: 有 ' + badHover.length + ' 条 :hover 没包在 ' +
        '@media (hover:hover) and (pointer:fine) 里（触摸端会粘住高亮）：\n  - ' +
        badHover.slice(0, 5).join('\n  - '),
    );
  }
  if (semanticAccent.length) {
    errors.push(
      'public/assets/main.css: 有 ' + semanticAccent.length + ' 条"数据状态"规则用了 var(--accent) —— ' +
        '它随配色方案变（warm 变橙、plum 变紫且与 VGT 资产色同色、mono 变灰），会误导读数。' +
        '涨/正收益用 var(--ok)，跌/负用 var(--danger)，需注意用 var(--warn)，无信号用 var(--muted)：\n  - ' +
        semanticAccent.slice(0, 5).join('\n  - '),
    );
  }
  return {
    errors, important, hoverAll, hoverWrapped: hoverAll - badHover.length, hoverUnwrapped: badHover.length,
    semanticAccent,
  };
}
