// 标的品牌徽标的统一入口：优先矢量（simple-icons，内联路径），其次位图（favicon base64），
// 都没有就回落"品牌色底 + 首字母"的字母徽标 —— 保证任何标的都有标可显示，列表不会出现空洞。

import { brandIconFor, BRAND_COLORS } from './brand-icons.js';
import { brandLogoFor, WHITE_LOGO_SYMS } from './brand-logos.js';

/** 代码 → 徽标描述；查不到品牌返回 null（由调用方决定是否用字母兜底）。 */
export function brandMarkFor(sym) {
  const icon = brandIconFor(sym);
  if (icon) return { kind: 'svg', hex: icon.hex, path: icon.path };
  const logo = brandLogoFor(sym);
  if (logo) return { kind: 'img', src: logo };
  return null;
}

/**
 * 徽标 HTML。opts.accent 传资产色（用于字母兜底的底色，缺省用主题强调色）。
 * data-brand=mono 时由 CSS 统一去色（见 main.css 的 .sym-badge 一段）。
 */
export function brandBadgeHTML(sym, opts) {
  const s = String(sym || '').toUpperCase();
  if (!s) return '';
  // 字母徽标的底色：优先用该标的的官方品牌色，其次调用方给的资产色
  const brandColor = BRAND_COLORS[s];
  const accent = brandColor ? '#' + brandColor : ((opts && opts.accent) || '');
  const styleAttr = accent ? ' style="--brand:' + accent + '"' : '';
  const mark = brandMarkFor(s);
  if (mark && mark.kind === 'svg') {
    return '<span class="sym-badge" style="--brand:#' + mark.hex + '" aria-hidden="true"><svg viewBox="0 0 24 24">' +
      '<path d="' + mark.path + '"/></svg></span>';
  }
  if (mark && mark.kind === 'img') {
    // 白 logo（FMP 给 IBM/SMH/QQQ 这类的是白底白字）要配深色底，否则在浅色卡片上是一片空白
    var isWhite = WHITE_LOGO_SYMS.indexOf(s) >= 0;
    return '<span class="sym-badge is-img' + (isWhite ? ' is-white' : '') + '"' + styleAttr + ' aria-hidden="true">' +
      '<img src="' + mark.src + '" alt="" decoding="async"></span>';
  }
  return '<span class="sym-badge is-letter"' + styleAttr + ' aria-hidden="true">' + s.charAt(0) + '</span>';
}
