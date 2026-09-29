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

/** 统一的样式检查入口，返回错误信息数组（空数组 = 通过）。 */
export function checkStyles(css, budget = IMPORTANT_BUDGET) {
  const errors = [];
  const important = countImportant(css);
  const hoverAll = hoverRulePositions(css).length;
  const badHover = findUnwrappedHover(css);
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
  return { errors, important, hoverAll, hoverWrapped: hoverAll - badHover.length, hoverUnwrapped: badHover.length };
}
