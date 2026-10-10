// 观察/行情域的"视图模型"纯函数：显示名派生、价格取值与格式化、价格胶囊 HTML、缓存取值。
// 不碰 DOM、不直接读全局（数据由调用方传入），因此可以离线单测。

/** 接口拿不到名字时的兜底显示名 */
export const FALLBACK_NAMES = { BTC: 'Bitcoin', GOLD: 'Gold' };

/* 加密品牌名（后端给 crypto:true 的行情会自动补" · 现货"；这里只把品牌名写准） */
export const CRYPTO_NAMES={BTC:'Bitcoin',ETH:'Ethereum',BNB:'Binance Coin',HYPE:'Hyperliquid',SOL:'Solana',XRP:'Ripple',DOGE:'Dogecoin',ADA:'Cardano',AVAX:'Avalanche',LINK:'Chainlink',LTC:'Litecoin',DOT:'Polkadot',TRX:'TRON',XLM:'Stellar',TON:'Toncoin',BCH:'Bitcoin Cash',ETC:'Ethereum Classic',UNI:'Uniswap',ATOM:'Cosmos',NEAR:'NEAR Protocol',APT:'Aptos',ARB:'Arbitrum',OP:'Optimism',FIL:'Filecoin',HBAR:'Hedera',ICP:'Internet Computer',ALGO:'Algorand',VET:'VeChain',AAVE:'Aave',INJ:'Injective',SEI:'Sei',TIA:'Celestia',TAO:'Bittensor',KAS:'Kaspa',GRT:'The Graph',SAND:'The Sandbox',MANA:'Decentraland',CRV:'Curve',MKR:'Maker',LDO:'Lido',ENS:'Ethereum Name Service',WLD:'Worldcoin',ENA:'Ethena',ONDO:'Ondo',JUP:'Jupiter',BONK:'Bonk',WIF:'dogwifhat',PYTH:'Pyth Network',POL:'Polygon',RUNE:'THORChain',SHIB:'Shiba Inu',PEPE:'Pepe',CRO:'Cronos',ZEC:'Zcash',XMR:'Monero',EOS:'EOS',FLOW:'Flow',CHZ:'Chiliz',GALA:'Gala',IMX:'Immutable',AXS:'Axie Infinity',THETA:'Theta',RENDER:'Render'};


/**
 * 观察列表行/详情要显示的名字：
 *   已知加密标的 → 品牌名 + ' · 现货'（与 BTC ETF 行区分）
 *   接口标了 crypto  → 去掉尾部 USD 再补 ' · 现货'
 *   兜底表 → 直接返回；否则用接口名（去掉尾部括号里的代码），中文名不要
 */
export function cleanName(sym, quote) {
  if (CRYPTO_NAMES[sym]) return CRYPTO_NAMES[sym] + ' · 现货';
  if (quote && quote.crypto) return (String(quote.name || sym).replace(/\s*USD$/, '').trim() || sym) + ' · 现货';
  if (FALLBACK_NAMES[sym]) return FALLBACK_NAMES[sym];
  const n = String((quote && quote.name) || '').replace(/\s*\([A-Za-z]{0,3}$/, '').trim();
  if (n && !/[\u4e00-\u9fa5]/.test(n)) return n;
  return FALLBACK_NAMES[sym] || sym;
}

/** 取现价：接口行情优先，其次实时价，最后本地缓存价。 */
export function quotePrice(quote, livePrice, cached) {
  return Number((quote && quote.price) || livePrice || (cached && cached.price) || 0) || 0;
}

/** 本地行情缓存按"归属代码"取（IBIT 的行情记在 IBIT 名下） */
export function historyOf(cache, key) {
  if (!key) return [];
  const c = (cache || {})[key];
  return (c && c.history) || [];
}

/** 52 周高点：本地缓存优先，其次接口行情（拿不到就是 0，界面据此不显示） */
export function hi52Of(cache, key, quote) {
  const c = key ? (cache || {})[key] : null;
  return Number((c && c.hi52) || (quote && quote.hi52) || 0) || 0;
}

/** 价格格式化：小额币价（BONK/PEPE/SHIB 这类）按数量级多给几位，避免显示成 $0.00。 */
export function fmtSmallPrice(n) {
  if (!(n > 0)) return '$0.00';
  if (n < 1) {
    const d = n >= 0.01 ? 4 : (n >= 0.0001 ? 6 : 8);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d });
  }
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 搜索结果行的价格/涨跌展示（没行情时给 '—' 与 flat）。 */
export function searchRowPrice(quote) {
  if (!quote || quote.price == null) return { p: '—', c: '', cls: 'flat' };
  const n = Number(quote.price);
  const c = Number(quote.changePct);
  return {
    p: fmtSmallPrice(n),
    c: isFinite(c) ? ((c >= 0 ? '+' : '') + c.toFixed(2) + '%') : '',
    cls: !isFinite(c) ? 'flat' : (c >= 0 ? 'up' : 'down'),
  };
}

/** 顶部实时价胶囊的 HTML（source 是真行情时才画小圆点；'缓存'/'manual' 不画）。 */
export function pricePillHTML(sym, price, change, source) {
  const dot = source && source !== '缓存' && source !== 'manual' ? '<span class="live-dot"></span>' : '';
  let ch = '';
  if (change != null) {
    const sign = change >= 0 ? '+' : '';
    ch = '<span class="pp-chg" style="color:' + (change >= 0 ? 'var(--accent)' : 'var(--red)') + ';">' + sign + change.toFixed(2) + '</span>';
  }
  const sl = source ? '<small style="color:var(--muted);font-size:11.5px;margin-left:3px;">' + source + '</small>' : '';
  return '<span class="price-pill" data-sym="' + sym + '" data-price="' + price.toFixed(2) + '" style="cursor:pointer">' + dot +
    '<span class="pp-sym">' + sym + '</span><strong>$' + price.toFixed(2) + '</strong>' + ch + sl + '</span>';
}
