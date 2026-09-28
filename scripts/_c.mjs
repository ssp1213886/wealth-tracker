import fs from 'node:fs';
const f = 'src/app/index.js';
let s = fs.readFileSync(f, 'utf8');
const START = "document.body.addEventListener('click',function(e){var row=e.target";
const END = "+' · 来源 '+(q.source==='coingecko'?'CoinGecko':'Yahoo'))})";
const i = s.indexOf(START);
const j = s.indexOf(END);
if (i < 0 || j < 0 || j < i) throw new Error('找不到原有的点击处理器');
const block =
  "document.body.addEventListener('click',function(e){var row=e.target&&e.target.closest?e.target.closest('.watch-row,.hold-row'):null;if(!row)return;" +
  "var next=row.nextElementSibling;if(next&&next.classList&&next.classList.contains('row-detail')){next.remove();return}" +
  "var symEl=row.querySelector('.watch-sym,.hold-sym');if(!symEl)return;var sym=String(symEl.childNodes[0]?symEl.childNodes[0].textContent:'').trim();if(!sym)return;" +
  "var q=watchQuotes[sym];if(!q){showToast(sym+' 暂无行情数据','err');return}" +
  "var pEl=row.querySelector('.watch-price,.hold-price'),cEl=row.querySelector('.watch-chg'),wEl=row.querySelector('.hold-weight');" +
  "var when=q.asOf?new Date(q.asOf).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';" +
  "var fixed=function(v){var n=Number(v);return Number.isFinite(n)&&n>0?(q.currency==='KRW'||q.currency==='JPY'?'₩':'$')+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2}):'—'};" +
  "var rows=[['标的',escapeHtml(sym)]];if(wEl)rows.push(['权重',escapeHtml(wEl.textContent)]);" +
  "rows.push(['价格',pEl?escapeHtml(pEl.textContent):'—'],['涨跌',cEl?escapeHtml(cEl.textContent):'—'],['昨收',fixed(q.prevClose)],['行情时间',when],['来源',q.source==='coingecko'?'CoinGecko':'Yahoo'],['币种',q.currency||'USD']);" +
  "var d=document.createElement('div');d.className='row-detail';d.innerHTML='<div class=\"row-detail-grid\">'+rows.map(function(r){return '<span>'+r[0]+'</span><strong>'+r[1]+'</strong>'}).join('')+'</div>';" +
  "row.after(d)})";
s = s.slice(0, i) + block + s.slice(j + END.length);
fs.writeFileSync(f, s);
console.log('点击交互已改为行内展开');
