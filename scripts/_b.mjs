import fs from 'node:fs';
const f = 'src/app/index.js';
let s = fs.readFileSync(f, 'utf8');
function cut(from, to, n = 1) {
  const c = s.split(from).length - 1;
  if (c !== n) throw new Error(`命中 ${c} 处（期望 ${n}）：${from.slice(0, 50)}`);
  s = s.split(from).join(to);
  console.log('✓ ' + from.slice(0, 46));
}
// ① 去掉每行的时间小字（两处模板：观察列表 + 前十大）
cut("+(r.timeText?'<small>'+r.timeText+'</small>':'')", '', 2);
// ② 页脚文案：一行说清新鲜度
cut("'更新于 '+syncClockText()", "'行情 '+syncClockText()", 1);
cut('加密为 7×24', '加密 7×24', 1);
cut('每行为该笔报价时间，美股休市时为收盘价', '美股非交易时段显示收盘价', 1);
// ③ 点行查看详情（用已渲染的文本，不引入新依赖）
cut(
  'renderWatch();renderWatchManage();renderHoldings();setTimeout(function(){refreshMarket(true)},1200)',
  'renderWatch();renderWatchManage();renderHoldings();setTimeout(function(){refreshMarket(true)},1200);' +
    "document.body.addEventListener('click',function(e){var row=e.target&&e.target.closest?e.target.closest('.watch-row,.hold-row'):null;if(!row)return;" +
    "var symEl=row.querySelector('.watch-sym,.hold-sym');if(!symEl)return;var sym=String(symEl.childNodes[0]?symEl.childNodes[0].textContent:'').trim();if(!sym)return;" +
    "var pEl=row.querySelector('.watch-price,.hold-price'),cEl=row.querySelector('.watch-chg'),wEl=row.querySelector('.hold-weight');" +
    "var q=watchQuotes[sym];if(!q){showToast(sym+' 暂无行情数据','err');return}" +
    "var when=q.asOf?new Date(q.asOf).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';" +
    "showToast(sym+' · '+(pEl?pEl.textContent:'—')+' · '+(cEl?cEl.textContent:'—')+(wEl?(' · 权重 '+wEl.textContent):'')+' · 行情时间 '+when+' · 来源 '+(q.source==='coingecko'?'CoinGecko':'Yahoo'))})",
);
fs.writeFileSync(f, s);
