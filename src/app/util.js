// 纯工具函数：不依赖 DOM、不读写全局状态，可以直接单测。
// 由 scripts/_split-util.mjs 从 index.js 搬出（行为完全一致）。

export function safeNum(n){return isNaN(n)||n===null||n===undefined||!isFinite(n)?0:n}

export function cleanText(v,max){return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max||160)}

/**
 * 金额格式化：负数把负号放在 $ 前面（-$1,234.50，而不是 $-1,234.50）。
 *
 * 这不只是好看：`updateMobStatusBar` 用 `textContent.indexOf('-') === 0` 判断盈亏正负来染色，
 * 老写法下负号在第 2 位，于是"亏损"会被当成正数染成绿色（数字是负的、颜色是绿的）。
 */
export function fmtFull(n){n=safeNum(n);return(n<0?'-$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}

export function fmtShares(n){var v=Math.abs(Number(n)||0);if(!isFinite(v))v=0;var s=v.toFixed(4);if(s.indexOf('.')>=0)s=s.replace(/0+$/,'').replace(/\.$/,'');return s||'0'}

/**
 * 记录"被有意吞掉的异常"（以前散在各处 catch 里，出问题完全没痕迹）。
 * v248 从 index.js 搬到 util.js：它只用 console，属于纯工具，抽出来后各模块都能共用一份实现。
 * 注意是 console.warn 不是静默：排查"为什么没生效"先看这里。
 */
export function logSwallowed(where,error){try{console.warn("[wealth] 已忽略异常 · "+where,error&&error.message?error.message:error)}catch(_e){logSwallowed("logSwallowed",_e)}}

export function fmtPnLFull(n){if(!isFinite(n))return'-';return(n>=0?'+':'')+fmtFull(n)}

export function cashSigned(l){var t=l.type||'',a=l.amount||0;return (t==='出金'||t.indexOf('权利金退回')>=0)?-a:a}

export function sparklinePath(values){var points=(Array.isArray(values)?values:[]).map(Number).filter(function(v){return isFinite(v)&&v>0}).slice(-20);if(points.length<2)return'';var min=Math.min.apply(null,points),max=Math.max.apply(null,points),span=max-min;if(span<.000001)return'M1 11 H57';return points.map(function(v,i){var x=1+i*56/(points.length-1),y=20-(v-min)*18/span;return(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ')}

export function dateOrdinal(value){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):NaN}

/* ===== v373：第三腿 Grayscale BTC ETF → iShares IBIT 的换算（唯一实现）=====
   两个基金 **1 股 ≠ 1 股**（每股的比特币敞口不同），所以换腿时不能只改代码 ——
   实测 2026-10-09 收盘：Grayscale Bitcoin Mini Trust（代码 BTC）$36.39 / IBIT $46.7454，
   只改代码不动股数会让这条腿的市值凭空 +28.5%。
   换算规则：股数 × r、每股价格 ÷ r → 每一笔的"股数×价格"（成本）不变，市值也保持不变。
   r 为什么写死：迁移在本机离线执行（拿不到行情），而且两台设备必须算出**同一份**数据，
   否则会互相覆盖打架。取值 = 36.39 / 46.7454（两个基金同一时点收盘价之比）。
   数据迁移（store.js）、交易归一化、CSV 导入三处**共用这一个函数**，不许各写一套。 */
export const BTC_TO_IBIT_SHARES = 0.778456;
export function convertLegacyBtcTrade(row){
  if(!row||typeof row!=='object')return row;
  if(String(row.symbol||'').toUpperCase()!=='BTC')return row;
  var out=Object.assign({},row,{symbol:'IBIT'});
  var shares=Number(row.shares),price=Number(row.price);
  /* 脏数据（缺股数/价格）只改代码、不硬算，交给 normalizeTrades 那边去剔除 */
  if(!isFinite(shares)||shares===0||!isFinite(price)||price<=0)return out;
  var cost=shares*price;
  var nextShares=Math.round(shares*BTC_TO_IBIT_SHARES*1e6)/1e6;
  if(!nextShares)return out;
  out.shares=nextShares;
  out.price=Math.round((cost/nextShares)*1e6)/1e6;   /* 反推价格，保证成本一分不差 */
  return out;
}

/** 客户端网络调用的默认截止时间（毫秒）。行情/榜单这类"页面上看得见在转圈"的请求，超了就别再等。 */
export const FETCH_TIMEOUT_MS = 10000;

/**
 * 同步请求（`/api/sync`）的截止时间：比普通请求宽一些。
 * 同步是"拉全文 + 写状态"的关键路径，慢网络下"慢但成功"不该被冤枉成失败（v314 的教训）。
 * 两套超时集中在这里，免得以后再出现"这个 8 秒那个 12 秒"的散落常量。
 */
export const SYNC_TIMEOUT_MS = 15000;

/**
 * 带截止时间的 fetch（v320）。
 *
 * 为什么必须有：链路黑洞时（VPN 掉线 / DNS 污染 / SNI 被拦）fetch 可以**永远不返回**，
 * 而客户端的写法几乎都是"先置为进行中 → 在 then/catch 里复位"——请求不落地，
 * 那些「刷新」按钮、骨架微光、账号操作按钮就永久卡在"进行中"。
 * v316 给同步请求补了 15 秒硬超时，这里是同一件事在其余网络调用上的补齐
 * （服务端的 price / quotes / marketcap 早就有超时）。
 *
 * 超时会抛 AbortError，调用方按"普通失败"处理即可（该复位的状态都会走到 catch）。
 */
export async function fetchWithTimeout(url, opts, timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : FETCH_TIMEOUT_MS;
  const options = Object.assign({}, opts || {});
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { /* 极老环境：退化成普通 fetch */ }
  if (!ctrl) return fetch(url, options);
  options.signal = ctrl.signal;
  const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { logSwallowed('fetchWithTimeout', e); } }, ms);
  try {
    return await fetch(url, options);
  } finally {
    clearTimeout(timer);
  }
}
