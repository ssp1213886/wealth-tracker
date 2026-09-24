// 纯工具函数：不依赖 DOM、不读写全局状态，可以直接单测。
// 由 scripts/_split-util.mjs 从 index.js 搬出（行为完全一致）。

export function safeNum(n){return isNaN(n)||n===null||n===undefined||!isFinite(n)?0:n}

export function cleanText(v,max){return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max||160)}

export function fmtFull(n){n=safeNum(n);return'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}

export function fmtShares(n){var v=Math.abs(Number(n)||0);if(!isFinite(v))v=0;var s=v.toFixed(4);if(s.indexOf('.')>=0)s=s.replace(/0+$/,'').replace(/\.$/,'');return s||'0'}

export function fmtPnLFull(n){if(!isFinite(n))return'-';return(n>=0?'+':'')+fmtFull(n)}

export function cashSigned(l){var t=l.type||'',a=l.amount||0;return (t==='出金'||t.indexOf('权利金退回')>=0)?-a:a}

export function sparklinePath(values){var points=(Array.isArray(values)?values:[]).map(Number).filter(function(v){return isFinite(v)&&v>0}).slice(-20);if(points.length<2)return'';var min=Math.min.apply(null,points),max=Math.max.apply(null,points),span=max-min;if(span<.000001)return'M1 11 H57';return points.map(function(v,i){var x=1+i*56/(points.length-1),y=20-(v-min)*18/span;return(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ')}

export function dateOrdinal(value){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):NaN}
