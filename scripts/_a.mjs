import fs from 'node:fs';
const f = 'src/app/index.js';
let s = fs.readFileSync(f, 'utf8');
const log = [];
function cut(from, to, n = 1) {
  const c = s.split(from).length - 1;
  if (c !== n) throw new Error('命中 ' + c + ' 处（期望 ' + n + '）：' + from.slice(0, 44));
  s = s.split(from).join(to);
  log.push(from.slice(0, 40));
}
// ① 去掉每行的时间小字（拥挤的根源）
cut("+(r.timeText?'<small>'+r.timeText+'</small>':'')", '', 2);
// ② 汇总一行说清新鲜度
cut(
  "'更新于 '+syncClockText()+' · 共 '+rows.length+' 项 · 每行为该笔报价时间；美股休市时为收盘价，加密 7×24'",
  "'行情 '+syncClockText()+' · 美股为非交易时段时显示收盘价 · 加密 7×24'",
);
// ③ 点行查看详情（底部 toast）
cut(
  'renderWatch();renderWatchManage();renderHoldings();setTimeout(function(){refreshMarket(true)},1200)',
  'renderWatch();renderWatchManage();renderHoldings();setTimeout(function(){refreshMarket(true)},1200);' +
    "document.body.addEventListener('click',function(e){var row=e.target&&e.target.closest?e.target.closest('.watch-row,.hold-row'):null;if(!row)return;" +
    "var symEl=row.querySelector('.watch-sym,.hold-sym');if(!symEl)return;" +
    "var sym=symEl.childNodes[0]?String(symEl.childNodes[0].textContent).trim():'';" +
    "var q=watchQuotes[quoteSymbolOf(sym)]||watchQuotes[sym];if(!q){showToast(sym+' 暂无行情数据','err');return}" +
    "var extra=row.querySelector('.hold-weight')?(' · 权重 '+row.querySelector('.hold-weight').textContent):'';" +
    "showToast(sym+' '+formatPrice(q.price,q.currency)+' '+formatChangePct(q.changePct)+extra+' · 行情时间 '+formatQuoteTime(q.asOf)+' · '+(q.source==='coingecko'?'CoinGecko':q.source==='yahoo'?'Yahoo':'')+' · 美股非交易时段为收盘价')})",
);
fs.writeFileSync(f, s);
console.log(log.join('\n'));
