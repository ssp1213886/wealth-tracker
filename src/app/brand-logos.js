// 品牌位图标的**索引**（真实图片在 /assets/logo/<代码>.webp，由 Worker 静态资源直发）。
//
// 之前这里内联了 54 张 base64 图（132KB），占了整个 app.js 的 37% —— 冷启动白白多传一大截。
// 拆成独立文件后：app.js 从 358KB 降到约 226KB，图片按需加载且被 Service Worker 缓存。
// 生成脚本：node scripts/gen-brand-logos.mjs（改完记得同步 public/assets/logo/）。

/** 有内置位图的代码（只存代码清单，图片在 /assets/logo/<代码>.<格式>）。 */
export const BRAND_LOGO_SYMS = {
  'AAPL': 'webp',
  'ADBE': 'webp',
  'AMAT': 'webp',
  'AMD': 'webp',
  'AMZN': 'webp',
  'ARM': 'webp',
  'ASML': 'webp',
  'AVGO': 'webp',
  'BRK-B': 'webp',
  'COIN': 'webp',
  'COST': 'webp',
  'CRCL': 'webp',
  'CRM': 'webp',
  'GOOG': 'webp',
  'GOOGL': 'webp',
  'IBM': 'webp',
  'INTC': 'webp',
  'IWM': 'webp',
  'JPM': 'webp',
  'KLAC': 'webp',
  'LLY': 'webp',
  'LRCX': 'webp',
  'META': 'webp',
  'MRVL': 'webp',
  'MSFT': 'webp',
  'MSTR': 'webp',
  'MU': 'webp',
  'NFLX': 'webp',
  'NOW': 'webp',
  'NVDA': 'webp',
  'NXPI': 'webp',
  'ON': 'webp',
  'ORCL': 'webp',
  'PLTR': 'webp',
  'QCOM': 'webp',
  'QQQ': 'webp',
  'QQQM': 'webp',
  'SKHY': 'webp',
  'SKHYV': 'webp',
  'SMCI': 'webp',
  'SMH': 'webp',
  'SPY': 'webp',
  'STM': 'webp',
  'TLT': 'webp',
  'TSLA': 'webp',
  'TSM': 'webp',
  'UNH': 'webp',
  'VGT': 'webp',
  'VOO': 'webp',
  'XOM': 'webp',
  // v385：第三腿换成 iShares 的 IBIT 之后，BTCG（grayscale.com 的 favicon）就没有代码引用了，删掉。
  // IBIT 用发行方 iShares 的标（simple-icons 没有 ishares/blackrock，官网 favicon 只有 16×16，所以走位图）。
  'IBIT': 'png',
  'ADI': 'png',
  'TXN': 'png',
  'HYPE': 'png',
};

export const WHITE_LOGO_SYMS = ["IBM","MRVL","ON","QQQ","SMH","UNH"];

/** 代码 → 图片地址；没有的返回 null（调用方继续回落矢量/远程/字母徽标）。 */
export function brandLogoFor(sym) {
  const key = String(sym || '').toUpperCase();
  const ext = BRAND_LOGO_SYMS[key];
  return ext ? ('/assets/logo/' + encodeURIComponent(key) + '.' + ext) : null;
}
