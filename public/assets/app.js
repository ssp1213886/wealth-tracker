var LSKEY='wealth_dashboard_v2',PRICE_KEY='wealth_prices_v2',TRADE_KEY='wealth_trades_v2',CB_KEY='wealth_cash_v2',CLOG_KEY='wealth_cashlog_v2';var cashBalance=0,cashLog=[];



var state={monthlyDCA:2000,roadmapStart:'2025-01',roadmapAge:27,targetGoal:2500000,sgovTarget:0,vgt:0.50,smh:0.30,btc:0.20};



var trades=[],livePrices={},liveChanges={},liveSources={},liveQuoteData={},tradeIdCounter=0;

var APP_DATA_VERSION=5;
var PRICE_SYMBOLS={VGT:'VGT',SMH:'SMH',BTC:'BTC'};
function cleanText(v,max){return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max||160)}
function escapeHtml(v){return cleanText(v,500).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function normalizeDateValue(v){var s=cleanText(v,20);var m;if((m=s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)))s=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');else if((m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)))s=m[3]+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return'';var d=new Date(s+'T12:00:00');return isNaN(d.getTime())||localDate(d)!==s?'':s}
function normalizeTrades(list){if(!Array.isArray(list))return[];var used={};return list.map(function(t,i){var sym=cleanText(t&&t.symbol,12).toUpperCase();var date=normalizeDateValue(t&&t.date);var shares=Number(t&&t.shares),price=Number(t&&t.price);if(!ETF_SYMS.includes(sym)||!date||!isFinite(shares)||shares===0||!isFinite(price)||price<=0)return null;var id=Number(t.id);if(!isFinite(id)||used[id])id=Date.now()+i+Math.random();used[id]=1;return{id:id,symbol:sym,date:date,time:cleanText(t.time,12),shares:shares,price:price,type:shares<0?'sell':'buy',tag:t.tag==='assign'?'assign':''}}).filter(Boolean)}
function normalizeCashLogs(list){if(!Array.isArray(list))return[];return list.map(function(l,i){var date=normalizeDateValue(l&&l.date),amount=Number(l&&l.amount),type=cleanText(l&&l.type,40);if(!date||!type||!isFinite(amount))return null;return{id:Number(l.id)||Date.now()+i+Math.random(),date:date,time:cleanText(l.time,12),type:type,amount:amount}}).filter(Boolean)}
function normalizeActivities(list){if(!Array.isArray(list))return[];return list.slice(-200).map(function(a,i){var date=normalizeDateValue(a&&a.date);if(!date)return null;return{id:Number(a.id)||Date.now()+i+Math.random(),date:date,time:cleanText(a.time,12),action:cleanText(a.action,120),detail:cleanText(a.detail,240)}}).filter(Boolean)}
function normalizeOptions(list){if(!Array.isArray(list))return[];return list.map(function(o,i){var sym=cleanText(o&&o.sym,12).toUpperCase(),type=cleanText(o&&o.type,8).toUpperCase(),strike=Number(o&&o.strike),premium=Number(o&&o.premium),contracts=Math.max(1,parseInt(o&&o.contracts)||1),expiry=normalizeDateValue(o&&o.expiry),added=normalizeDateValue(o&&o.added)||marketDate(),id=Number(o&&o.id);if((sym!=='VGT'&&sym!=='SMH')||(type!=='CALL'&&type!=='PUT')||!expiry||!isFinite(strike)||strike<=0||!isFinite(premium)||premium<0)return null;if(!isFinite(id))id=Date.now()+i+Math.random();return{id:id,sym:sym,type:type,strike:strike,premium:premium,contracts:contracts,expiry:expiry,added:added,settled:!!o.settled,archived:!!o.archived}}).filter(Boolean)}
function createBackupData(){return{version:APP_DATA_VERSION,date:new Date().toISOString(),state:normalizeState(state),trades:trades,cashBalance:safeNum(cashBalance),cashLog:cashLog,activities:normalizeActivities(JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')),optionTrades:normalizeOptions(JSON.parse(localStorage.getItem('wealth_options_v2')||'[]')),otmSettings:JSON.parse(localStorage.getItem('otmSettings')||'{"vgt":7,"smh":5}'),exitPortfolio:localStorage.getItem('exit_portfolio')||'',prices:JSON.parse(localStorage.getItem(PRICE_KEY)||'{}'),theme:document.documentElement.dataset.theme||'light',accent:document.documentElement.dataset.accent||'forest'}}







/* ===== 格式化工具 ===== */



function localDate(d){d=d||new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
var HOME_TIME_ZONE='Asia/Shanghai',MARKET_TIME_ZONE='America/New_York',MARKET_SESSION_LABELS={open:'美股交易时段',closed:'美股非交易时段'};
function zonedDateParts(d,timeZone){d=d||new Date();var parts={};try{new Intl.DateTimeFormat('en-CA',{timeZone:timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(function(p){if(p.type!=='literal')parts[p.type]=p.value})}catch(e){parts.year=String(d.getFullYear());parts.month=('0'+(d.getMonth()+1)).slice(-2);parts.day=('0'+d.getDate()).slice(-2);parts.weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];parts.hour=('0'+d.getHours()).slice(-2);parts.minute=('0'+d.getMinutes()).slice(-2)}return parts}
function zonedDate(d,timeZone){var p=zonedDateParts(d,timeZone);return p.year+'-'+p.month+'-'+p.day}
function marketDate(d){return zonedDate(d,MARKET_TIME_ZONE)}
function chinaDate(d){return zonedDate(d,HOME_TIME_ZONE)}
function marketClock(d){var p=zonedDateParts(d||new Date(),MARKET_TIME_ZONE);return p.hour+':'+p.minute}
function dateOrdinal(value){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):NaN}
function optionExpiryState(expiry,d){var clock=zonedDateParts(d||new Date(),MARKET_TIME_ZONE),today=clock.year+'-'+clock.month+'-'+clock.day,days=dateOrdinal(expiry)-dateOrdinal(today),afterClose=(Number(clock.hour)||0)*60+(Number(clock.minute)||0)>=960,expired=!isFinite(days)||days<0||(days===0&&afterClose);return{days:isFinite(days)?Math.max(0,days):0,expired:expired}}
function isActiveOption(o,d){return !!(o&&!o.settled&&!o.archived&&o.expiry&&!optionExpiryState(o.expiry,d).expired)}
function formatChinaTime(d){d=d||new Date();try{return new Intl.DateTimeFormat('zh-CN',{timeZone:HOME_TIME_ZONE,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)}catch(e){return d.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}}
function safeNum(n){return isNaN(n)||n===null||n===undefined||!isFinite(n)?0:n}



function fmt$(n){n=safeNum(n);if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toLocaleString('en-US',{maximumFractionDigits:0})}



function fmtFull(n){n=safeNum(n);return'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function getNetCash(){var ts=0,tb=0;trades.forEach(function(t){var a=Math.abs(t.shares)*t.price;if(t.shares<0)ts+=a;else tb+=a});return cashBalance+ts-tb}
function animateVal(el,to){if(!el)return;var from=parseFloat(el.dataset.v||"0")||0;el.dataset.v=to;var start=Date.now(),dur=500;function step(){var t=Math.min(1,(Date.now()-start)/dur);var v=from+(to-from)*(1-Math.pow(1-t,3));el.textContent=fmtFull(v);if(t<1)requestAnimationFrame(step)}step()}



function fmtPct(n){if(isNaN(n)||!isFinite(n))return'-';return(n*100).toFixed(1)+'%'}



var ETF_NAMES={VGT:'VGT',SMH:'SMH',BTC:'BTC ETF',SGOV:'SGOV'},ETF_SYMS=['VGT','SMH','BTC'],ALL_SYMS=['VGT','SMH','BTC'];



var AD={VGT:{ret:0.12,vol:0.22},SMH:{ret:0.14,vol:0.28},BTC:{ret:0.18,vol:0.65}};



function getAssetColor(sym){var css=getComputedStyle(document.documentElement),map={VGT:css.getPropertyValue('--accent').trim(),SMH:css.getPropertyValue('--blue').trim(),BTC:css.getPropertyValue('--orange').trim()};return map[sym]||css.getPropertyValue('--muted').trim()}
var DONUT_COLORS=ETF_SYMS.map(getAssetColor);



/* ===== 投资组合计算 ===== */



function calcPortfolio(){var vs=safeNum(state.vgt),ss=safeNum(state.smh),bs=safeNum(state.btc),total=vs+ss+bs;if(total<0.001)return{ret:0.05,vol:0.15};var w={v:vs/total,s:ss/total,b:bs/total};return{ret:w.v*AD.VGT.ret+w.s*AD.SMH.ret+w.b*AD.BTC.ret,vol:Math.sqrt(Math.max(0,Math.pow(w.v*AD.VGT.vol,2)+Math.pow(w.s*AD.SMH.vol,2)+Math.pow(w.b*AD.BTC.vol,2)+2*0.75*w.v*AD.VGT.vol*w.s*AD.SMH.vol+2*0.2*(w.v*AD.VGT.vol*w.b*AD.BTC.vol+w.s*AD.SMH.vol*w.b*AD.BTC.vol)))}}



function updateSidebar(){



  var holdings={},totalV=0,hasAny=false,slices=[];



  for(var i=0;i<trades.length;i++){var t=trades[i],sym=t.symbol;if(!holdings[sym])holdings[sym]={shares:0};holdings[sym].shares+=Number(t.shares)}



  for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var v=h.shares*(livePrices[sym]||0);if(v>0){slices.push({sym:sym,value:v});totalV+=v;hasAny=true}}



  var nc=getNetCash();animateVal(document.getElementById('sbValue'),hasAny?totalV+nc:nc);document.getElementById('sbHoldVal').textContent=fmtFull(totalV);document.getElementById('sbCashVal').textContent=fmtFull(nc);



  var canvas=document.getElementById('sbDonut'),legend=document.getElementById('sbDonutLegend');



  if(canvas){var ctx=canvas.getContext('2d');ctx.clearRect(0,0,130,130);



    if(slices.length&&totalV>0){var angle=-Math.PI/2,cx=65,cy=55,r=40;slices.forEach(function(s,i){var slice=s.value/totalV*2*Math.PI;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+slice);ctx.closePath();ctx.fillStyle=DONUT_COLORS[i%3];ctx.fill();angle+=slice}); ctx.beginPath();ctx.arc(cx,cy,22,0,2*Math.PI);ctx.fillStyle=document.documentElement.dataset.theme==='dark'?'#1f221f':'#fff';ctx.fill();ctx.fillStyle=document.documentElement.dataset.theme==='dark'?'#e4e4e0':'#1a1a1a';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText(fmt$(totalV),cx,cy+2);ctx.font='8px sans-serif';ctx.fillStyle=document.documentElement.dataset.theme==='dark'?'#999':'#777';ctx.fillText('总市值',cx,cy+14)}



    else{ctx.fillStyle='#6b6b68';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.font='10px sans-serif';ctx.fillStyle='#6b6b68';ctx.fillText('📭 暂无持仓',65,55)}



  }



  if(legend&&slices.length)legend.innerHTML=slices.map(function(s,i){return'<span style="display:inline-block;margin:0 3px;"><span style="width:8px;height:8px;border-radius:50%;background:'+DONUT_COLORS[i%3]+';display:inline-block;"></span> '+s.sym+'</span>'}).join('');



  var dcaEl=document.getElementById('sbDCACalendar');if(dcaEl){var buyTrades=trades.filter(function(t){return t.shares>0});var months=new Set();buyTrades.forEach(function(t){months.add(t.date.slice(0,7))});var n=months.size+1,marketYM=marketDate(),marketYear=Number(marketYM.slice(0,4)),marketMonth=Number(marketYM.slice(5,7)),nextYear=marketMonth===12?marketYear+1:marketYear,nextMonth=marketMonth===12?1:marketMonth+1;dcaEl.textContent='下次定投 '+nextYear+'年'+nextMonth+'月 · 第'+n+'次'}



  



  updateMobStatusBar();}







/* ===== 价格获取 & 缓存 ===== */



function readPriceCache(){try{var value=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch(e){return{}}}
var cachePrice=function(symbol,data){try{var c=readPriceCache();c[symbol]=data;localStorage.setItem(PRICE_KEY,JSON.stringify(c))}catch(e){console.warn('cachePrice failed',e)}}



async function fetchPrice(symbol){var cached=readPriceCache(),quoteSymbol=PRICE_SYMBOLS[symbol]||symbol;try{var r=await fetch('/api/price?symbol='+encodeURIComponent(quoteSymbol)+'&range=1mo');if(r.ok){var j=await r.json(),result=j.ok&&j.data&&j.data.chart&&j.data.chart.result&&j.data.chart.result[0],m=result&&result.meta,quote=result&&result.indicators&&result.indicators.quote&&result.indicators.quote[0],history=quote&&Array.isArray(quote.close)?quote.close.map(Number).filter(function(v){return isFinite(v)&&v>0}).slice(-20):[];if(m&&m.regularMarketPrice>0){var prevClose=Number(m.previousClose);if(!(prevClose>0))prevClose=history.length>1?history[history.length-2]:m.regularMarketPrice;return{price:m.regularMarketPrice,prevClose:prevClose,change:m.regularMarketPrice-prevClose,hi52:m.fiftyTwoWeekHigh||0,history:history,historyRange:'1mo',source:'yahoo',time:Date.now()}}}}catch(e){console.log('Yahoo error',symbol,e)}try{var r2=await fetch('https://qt.gtimg.cn/q=us'+symbol.toUpperCase());if(r2.ok){var t=await r2.text();var m2=t.match(/"([^"]+)"/);if(m2){var p=m2[1].split('~'),pr=parseFloat(p[3]),prev=parseFloat(p[4]),hi52=parseFloat(p[48]);if(pr>0)return{price:pr,prevClose:prev,change:pr-prev,hi52:hi52||0,history:cached[symbol]&&cached[symbol].history||[],historyRange:cached[symbol]&&cached[symbol].historyRange||'',source:'tencent',time:Date.now()}}}}catch(e2){console.log('Tencent error',symbol,e2)}if(cached[symbol])return Object.assign({},cached[symbol],{source:'缓存',time:cached[symbol].time||cached[symbol].ts});return null}



function pricePill(sym,price,change,source){var dot=source&&source!=='缓存'&&source!=='manual'?'<span class="live-dot"></span>':'';var ch='';if(change!=null){var s2=change>=0?'+':'';ch='<span class="pp-chg" style="color:'+(change>=0?'var(--accent)':'var(--red)')+';">'+s2+change.toFixed(2)+'</span>'}var sl=source?'<small style="color:var(--muted);font-size:.7rem;margin-left:3px;">'+source+'</small>':'';return'<span class="price-pill" data-sym="'+sym+'" data-price="'+price.toFixed(2)+'" style="cursor:pointer">'+dot+'<span class="pp-sym">'+sym+'</span><strong>$'+price.toFixed(2)+'</strong>'+ch+sl+'</span>'}



async function refreshPrices(){



  var el=document.getElementById('hmPricesCompact');if(el){el.setAttribute('aria-busy','true');el.innerHTML='<div class="ds-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'}



  var syms=['VGT','SMH','BTC','SGOV'];



  var results=await Promise.all(syms.map(async function(sym){

    var manual=readPriceCache()[sym];if(manual&&manual.source==='manual'&&Number(manual.price)>0){livePrices[sym]=Number(manual.price);liveSources[sym]='手动';return pricePill(sym,Number(manual.price),manual.change,'manual')}



    var d=await fetchPrice(sym);



    if(d&&d.source!=='缓存'){var cachedPrice=readPriceCache();var oldP=cachedPrice[sym]?cachedPrice[sym].price:null;livePrices[sym]=d.price;liveQuoteData[sym]=d;liveSources[sym]=d.source==='tencent'?'腾讯':d.source==='yahoo'?'Yahoo':d.source;if(d.change!=null&&d.change!==0){liveChanges[sym]=d.change}else if(oldP&&oldP!==d.price){liveChanges[sym]=d.price-oldP}cachePrice(sym,d);return pricePill(sym,d.price,d.change,d.source)}



    if(livePrices[sym]){return pricePill(sym,livePrices[sym],liveChanges[sym],'缓存')}



    return '<span class="price-pill" data-sym="'+sym+'" style="cursor:pointer"><span class="pp-sym">'+sym+'</span><span style="color:var(--orange)">--</span></span>'



  }));



  if(el)el.innerHTML=results.join('');



  updatePortfolio();updateSidebar();updateSidebarPrices();



}







var holdSort={col:'value',asc:false};function sortHoldRows(rows){var c=holdSort.col,a=holdSort.asc;return rows.sort(function(x,y){var vx=c==='sym'?x.sym:c==='value'?x.value||0:c==='pnl'?x.unrealPnL||0:c==='pnlPct'?x.pnlPct||0:0;var vy=c==='sym'?y.sym:c==='value'?y.value||0:c==='pnl'?y.unrealPnL||0:c==='pnlPct'?y.pnlPct||0:0;if(typeof vx==='string')return a?vy.localeCompare(vx):vx.localeCompare(vy);return a?vx-vy:vy-vx})}



/* ===== 持仓渲染 ===== */



function updatePortfolio(){



  var holdings={},totalBuys=0,totalInvested=0,totalRealized=0;



  var sorted=[].concat(trades).sort(function(a,b){return a.date.localeCompare(b.date)});



  for(var i=0;i<sorted.length;i++){



    var t=sorted[i],sym=t.symbol,sh=Number(t.shares),pr=Number(t.price);



    if(!holdings[sym])holdings[sym]={shares:0,cost:0,realized:0};



    if(sh>0){holdings[sym].shares+=sh;holdings[sym].cost+=sh*pr;totalBuys+=sh*pr;totalInvested+=sh*pr}



    else{var preAvg=holdings[sym].shares>0?holdings[sym].cost/holdings[sym].shares:pr;var soldCost=Math.abs(sh)*preAvg;var soldProceeds=Math.abs(sh)*pr;holdings[sym].shares+=sh;holdings[sym].cost-=soldCost;holdings[sym].realized+=soldProceeds-soldCost;totalRealized+=soldProceeds-soldCost}



  }



  var totalCost=0,totalValue=0,hasPriced=false,unpriced=[];



  var rows=[];



  for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var avgCost=h.shares>0?h.cost/h.shares:0,priced=livePrices[sym]&&livePrices[sym]>0;var curPrice=priced?livePrices[sym]:null,value=priced?h.shares*curPrice:null;var unrealPnL=priced?value-h.cost:null,pnlPct=(priced&&h.cost>0)?unrealPnL/h.cost:null;totalCost+=h.cost;if(priced){totalValue+=value;hasPriced=true}else unpriced.push(sym);rows.push({sym:sym,shares:h.shares,avgCost:avgCost,priced:priced,curPrice:curPrice,value:value,unrealPnL:unrealPnL,pnlPct:pnlPct,realized:h.realized||0})}



  rows.sort(function(a,b){return(b.value||-1)-(a.value||-1)});



  rows=sortHoldRows(rows);



  var totalPnLUnreal=hasPriced?totalValue-totalCost:null;



  var realizedOptionPremium=0;try{optionTrades.forEach(function(o){realizedOptionPremium+=(o.premium||0)*(o.contracts||1)})}catch(e){}var totalPnL=hasPriced&&totalPnLUnreal!=null?totalPnLUnreal+totalRealized+realizedOptionPremium:null;



  var totalPct=(hasPriced&&totalInvested>0)?totalPnL/totalInvested:null;



  



  document.getElementById('hmValue').textContent=hasPriced?fmtFull(totalValue):'-';var totalAssetValue=totalValue+getNetCash(),ht=document.getElementById('hmTotal');if(ht)ht.textContent=fmtFull(totalAssetValue);var hcp=document.getElementById('hmCashPct');if(hcp)hcp.textContent=(totalAssetValue>0?getNetCash()/totalAssetValue*100:0).toFixed(2)+'%';



  var dailyChg=0;rows.forEach(function(r){if(r.priced&&liveChanges[r.sym]!=null)dailyChg+=r.shares*liveChanges[r.sym]});var yesterdayVal=totalValue-dailyChg;var dailyPct=yesterdayVal>0?(dailyChg/yesterdayVal*100):null;var hu=document.getElementById('hmUnreal');if(hu){hu.textContent=hasPriced?fmtPnLFull(dailyChg):'-';hu.className='m-val '+(hasPriced?(dailyChg>=0?'pnl-pos':'pnl-neg'):'')}



  var hup=document.getElementById('hmUnrealPct');if(hup){if(hasPriced&&dailyPct!=null){var s2=dailyPct>=0?'+':'';hup.innerHTML='<span style=color:'+(dailyPct>=0?'var(--accent)':'var(--red)')+';font-weight:550>'+s2+dailyPct.toFixed(2)+'% 今日</span>'}else{hup.textContent='按实时价估算'}}



  var hp=document.getElementById('hmPnL');if(hp){hp.textContent=hasPriced&&totalPnL!=null?fmtPnLFull(totalPnL):'-';hp.className='m-val '+(hasPriced&&totalPnL!=null?(totalPnL>=0?'pnl-pos':'pnl-neg'):'')}



  var hpp=document.getElementById('hmPnLPct');if(hpp){var s='';if(hasPriced&&totalPct!=null){s+=fmtPnLPctParen(totalPct)+'<br>'}else if(unpriced.length>0){s+='需设价:'+unpriced.join(',')+'<br>'}var uc=totalPnLUnreal||0,rc=totalRealized;s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:.7rem;margin:2px 3px 0 0;background:'+(uc>=0?'var(--accent-l)':'rgba(229,57,53,.1)')+';color:'+(uc>=0?'var(--accent-d)':'#b53a2a')+';">浮动 '+fmtPnLFull(uc)+'</span>';s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:.7rem;margin-top:2px;background:'+(rc>=0?'rgba(22,153,74,.1)':'rgba(229,57,53,.08)')+';color:'+(rc>=0?'var(--accent-d)':'#b53a2a')+';">已实现 '+fmtPnLFull(rc)+'</span>';s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:.7rem;margin-top:2px;background:'+(realizedOptionPremium>=0?'var(--accent-l)':'rgba(229,57,53,.08)')+';color:'+(realizedOptionPremium>=0?'var(--accent-d)':'#b53a2a')+';">权利金 '+fmtPnLFull(realizedOptionPremium)+'</span>';hpp.innerHTML=s;}







  var hb=document.getElementById('holdBody');



  if(hb)hb.innerHTML=rows.length?rows.map(function(r){return'<tr><td>'+r.sym+'</td><td>'+Math.abs(r.shares).toFixed(2)+'</td><td>$'+r.avgCost.toFixed(2)+'</td><td>'+(r.priced?'$'+r.curPrice.toFixed(2):'<span style="color:orange;">No price</span>')+'</td><td>'+(r.priced?fmtFull(r.value):'<span style="color:orange;">-</span>')+'</td><td class="'+(r.priced&&r.unrealPnL!=null?(r.unrealPnL>=0?'pnl-pos':'pnl-neg'):'')+'">'+(r.priced&&r.unrealPnL!=null?fmtPnLFull(r.unrealPnL):'-')+'</td><td class="'+(r.priced&&r.unrealPnL!=null?(r.unrealPnL>=0?'pnl-pos':'pnl-neg'):'')+'">'+(r.priced&&r.pnlPct!=null?((r.pnlPct>=0?'+':'')+(r.pnlPct*100).toFixed(1)+'%'):'-')+'</td><td><button class="trade-del" data-hold="'+r.sym+'" title="Clear">X</button></td></tr>'}).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">No holdings</td></tr>';







  updateDonutChart(rows);updateSidebar();updateSidebarPrices();updateHoldCash();updateDCA();updateDashboardWidgets();updatePnlSummary();updateTradeList();updateAlerts();



  var target=state.targetGoal||2500000,totalAssets=totalValue;totalAssets+=getNetCash();var pctVal=Math.min(100,totalAssets/target*100),gap=Math.max(0,target-totalAssets);



  document.getElementById('prBar').style.width=pctVal+'%';document.getElementById('prPct').textContent=pctVal.toFixed(1)+'%';document.getElementById('prGap').textContent=fmtFull(gap);document.getElementById('prGap').style.color=gap>0?'var(--red)':'var(--accent)';document.getElementById('prCostInline').textContent=hasPriced?fmtFull(totalAssets):fmtFull(totalAssets);var tgt=document.getElementById('targetName');if(tgt)tgt.textContent=fmt$(target);var tl2=document.getElementById('targetLabel');if(tl2)tl2.textContent=fmt$(target);var pti=document.getElementById('prTargetInline');if(pti)pti.textContent=fmt$(target);



  // Rebalance alert



  // 距高点回撤



  var ddLines=[],hasPrice=false;



  ETF_SYMS.forEach(function(sym){



    var cp=livePrices[sym];if(!cp||cp<=0)return;hasPrice=true;



    var key='peak_'+sym,peakP=parseFloat(localStorage.getItem(key)||'0');if(peakP>cp*5)peakP=0;



    var cd=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');if(cd[sym]&&cd[sym].hi52&&cd[sym].hi52>peakP&&cd[sym].hi52<cp*5)peakP=cd[sym].hi52;



    if(!peakP||cp>peakP)peakP=cp;



    localStorage.setItem(key,peakP.toString());



    var dd=((peakP-cp)/peakP*100);



    ddLines.push({sym:sym,dd:dd,peak:peakP,price:cp})



  });



  var tc=document.getElementById('hmDrawdown'),ts=document.getElementById('hmDrawdownSub'),tw=document.getElementById('hmDrawdownWorst');



  if(ddLines.length>0){tc.className='drawdown-visual';var worst=ddLines.reduce(function(a,b){return a.dd>b.dd?a:b});tc.innerHTML=ddLines.map(function(d){var currentPct=Math.max(2,Math.min(100,100-d.dd)),gapPct=Math.max(0,Math.min(98,d.dd)),barColor=d.dd>=20?'var(--red)':d.dd>=10?'var(--orange)':'var(--accent)';return '<div class="drawdown-row" style="--drawdown-color:'+barColor+'"><span class="drawdown-symbol"><strong>'+escapeHtml(d.sym)+'</strong><small>$'+d.price.toFixed(2)+' / $'+d.peak.toFixed(2)+'</small></span><div class="drawdown-track" aria-label="'+escapeHtml(d.sym)+' 距离52周高点 '+d.dd.toFixed(1)+'%"><i class="drawdown-gap" style="width:'+gapPct+'%"></i><i class="drawdown-marker" style="left:'+currentPct+'%"></i></div><span class="drawdown-value">-'+d.dd.toFixed(1)+'%</span></div>'}).join('');if(tw)tw.textContent='最大 -'+worst.dd.toFixed(1)+'%';if(ts)ts.style.display='flex'}else{tc.className='drawdown-empty';tc.textContent='添加价格后显示';if(tw)tw.textContent='最大 --';if(ts)ts.style.display='none'}



  document.getElementById('hmPricesCompact').setAttribute('aria-busy','false');document.getElementById('hmPricesCompact').innerHTML=ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||''):'<span class="price-pill" data-sym="'+sym+'" style="cursor:pointer"><span class="pp-sym">'+sym+'</span><span style="color:var(--orange)">--</span></span>'}).join('');



  var ct=document.getElementById('hmPriceTime');if(ct&&!ct.textContent)ct.textContent='更新 '+new Date().toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});



}







function updateDonutChart(rows){var canvas=document.getElementById("chartDonut"),legend=document.getElementById("donutLegend");if(!canvas)return;var dpr=window.devicePixelRatio||1,size=220;canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=size+"px";canvas.style.height=size+"px";var ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,size,size);if(!rows.length||rows.every(function(r){return!r.priced})){if(legend)legend.innerHTML="<div style=\"color:var(--muted);padding:20px;\">暂无数据</div>";return}var priced=rows.filter(function(r){return r.priced&&r.value>0});if(!priced.length){if(legend)legend.innerHTML="<div style=\"color:var(--muted);padding:20px;\">请先设价</div>";return}var total=priced.reduce(function(s,r){return s+r.value},0),cx=size/2,cy=90,r=82,angle=-Math.PI/2;var slices=[];priced.forEach(function(row){var slice=row.value/total*2*Math.PI,color=getAssetColor(row.sym);slices.push({sym:row.sym,value:row.value,pct:row.value/total,color:color});ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+slice);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle="rgba(255,255,255,.3)";ctx.lineWidth=1;ctx.stroke();angle+=slice});var dark=document.documentElement.dataset.theme==="dark";ctx.beginPath();ctx.arc(cx,cy,52,0,2*Math.PI);var grd=ctx.createRadialGradient(cx,cy,45,cx,cy,60);grd.addColorStop(0,dark?"#222522":"#faf9f5");grd.addColorStop(1,dark?"#1a1d1a":"#f0ede5");ctx.fillStyle=grd;ctx.fill();ctx.fillStyle=dark?"#e4e4e0":"#1a1a1a";ctx.font="bold 20px "+getComputedStyle(document.body).fontFamily;ctx.textAlign="center";ctx.fillText(fmt$(total),cx,cy-2);ctx.font="10px sans-serif";ctx.fillStyle=dark?"#999":"#777";ctx.fillText("总市值",cx,cy+14);if(!legend)return;var h="";slices.forEach(function(s){h+="<div style=\"display:flex;align-items:center;padding:6px 10px;margin-bottom:4px;border-radius:var(--radius-sm);background:var(--surface);\"><span style=\"width:10px;height:10px;border-radius:50%;background:"+s.color+";flex-shrink:0;\"></span><span style=\"flex:1;margin-left:8px;font-weight:520;font-size:.7rem;\">"+s.sym+"</span><span style=\"font-size:.7rem;color:var(--fg);font-weight:520;\">"+(s.pct*100).toFixed(1)+"%</span><span style=\"font-size:.7rem;color:var(--muted);margin-left:6px;\">"+fmtFull(s.value)+"</span></div>"});legend.innerHTML=h}var rebalanceMode="swap";function updateRebalance(rows,totalValue){



  var el=document.getElementById('rebalanceBody');if(!el)return;



  if(!rows.length||!totalValue){el.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);">添加持仓后自动计算再平衡方案</div>';return}



  var target={VGT:state.vgt,SMH:state.smh,BTC:state.btc};



  var diffs=[];ETF_SYMS.forEach(function(sym){var cv=rows.reduce(function(s,r){return r.sym===sym&&r.priced?s+r.value:s},0);var tv=totalValue*(target[sym]||0);var diff=tv-cv;diffs.push({sym:sym,curPct:(cv/totalValue*100)||0,tgtPct:(target[sym]||0)*100,diff:diff,price:livePrices[sym]||0})});var maxDev=Math.max.apply(null,diffs.map(function(d){return Math.abs(d.curPct-d.tgtPct)}));if(maxDev<2){el.innerHTML='<div style="text-align:center;padding:16px;color:var(--accent);">✓ 已平衡 (偏差<2%)</div>';return}if(rebalanceMode==='inject'){var bi=diffs.filter(function(d){return d.diff>0.01});if(!bi.length){el.innerHTML='<div style="text-align:center;padding:16px;color:var(--accent);">✓ 已平衡</div>';return}var underPctSum=bi.reduce(function(s,d){return s+(target[d.sym]||0)},0);var curUnderPctSum=bi.reduce(function(s,d){return s+d.curPct/100},0);var S=underPctSum>curUnderPctSum?totalValue*(underPctSum-curUnderPctSum)/(1-underPctSum):0;var h='<div style="font-size:.7rem;color:var(--muted);margin-bottom:6px;">注资买入（不卖持仓）</div>';bi.forEach(function(d){var x=target[d.sym]*(totalValue+S)-(totalValue*d.curPct/100);if(x<0)x=0;var sh=d.price>0?x/d.price:0;h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;margin-bottom:2px;background:rgba(229,57,53,.1);border-radius:6px;"><div><strong>'+d.sym+'</strong><span style="font-size:.7rem;color:var(--muted);margin-left:6px;">买入 '+fmtFull(x)+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span></div><span style="font-size:.7rem;color:var(--red);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</span></div>'});h+='<div style="font-size:.7rem;text-align:right;color:var(--red);margin-top:2px;">需注入新资金 '+fmtFull(S)+'</div>';var si=diffs.filter(function(d){return d.diff<-0.01});if(si.length)h+='<div style="font-size:.7rem;color:var(--muted);text-align:center;margin-top:6px;">注资后 '+si.map(function(d){return d.sym}).join('、')+' 占比会被稀释</div>';el.innerHTML=h;return}var buys=diffs.filter(function(d){return d.diff>0.01}).sort(function(a,b){return b.diff-a.diff}),sells=diffs.filter(function(d){return d.diff<-0.01}).sort(function(a,b){return a.diff-b.diff});



  var h2='';var totalSell=0,totalBuy=0;



  sells.forEach(function(d){totalSell+=Math.abs(d.diff);var dev=(d.curPct-d.tgtPct).toFixed(1);var p=d.price||livePrices[d.sym]||0;var sh=p>0?Math.abs(d.diff)/p:0;h2+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-bottom:3px;background:rgba(229,57,53,.1);border-radius:6px;font-size:.7rem;border-left:3px solid var(--red);"><div><strong>'+d.sym+'</strong><span style="font-size:.7rem;color:var(--red);margin-left:4px;">超配 '+dev+'%</span></div><div style="text-align:right;"><span style="color:var(--red);font-weight:540;">↓ 卖 '+fmtFull(Math.abs(d.diff))+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span><div style="font-size:.7rem;color:var(--muted);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</div></div></div>'});



  buys.forEach(function(d){totalBuy+=d.diff;var dev=(d.tgtPct-d.curPct).toFixed(1);var p=d.price||livePrices[d.sym]||0;var sh=p>0?d.diff/p:0;h2+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-bottom:3px;background:rgba(22,153,74,.1);border-radius:6px;font-size:.7rem;border-left:3px solid var(--accent);"><div><strong>'+d.sym+'</strong><span style="font-size:.7rem;color:var(--accent);margin-left:4px;">欠配 '+dev+'%</span></div><div style="text-align:right;"><span style="color:var(--accent);font-weight:540;">↑ 买 '+fmtFull(d.diff)+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span><div style="font-size:.7rem;color:var(--muted);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</div></div></div>'})



  if(totalBuy>0||totalSell>0)h2+='<div style="border-top:1px solid var(--rule);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-size:.7rem;color:var(--muted);"><span>换仓总额</span><span style="color:var(--fg);font-weight:540;">'+fmtFull(Math.max(totalBuy,totalSell))+'</span></div>';



  if(!buys.length&&!sells.length)h2='<div style="text-align:center;padding:12px;color:var(--accent);font-size:.72rem;">✓ 已平衡</div>';



  el.innerHTML=h2;



}







/* ===== 数据持久化 ===== */



function normalizeState(s){if(!s)s={};return{monthlyDCA:s.monthlyDCA!==undefined?s.monthlyDCA:2000,dcaOverride:s.dcaOverride||{month:'',amount:0},roadmapStart:s.roadmapStart||'2025-01',roadmapAge:s.roadmapAge!==undefined?s.roadmapAge:27,sgovTarget:s.sgovTarget!==undefined?s.sgovTarget:0,targetGoal:s.targetGoal!==undefined?s.targetGoal:2500000,vgt:s.vgt!==undefined?s.vgt:0.50,smh:s.smh!==undefined?s.smh:0.30,btc:s.btc!==undefined?s.btc:0.20}}
function loadState(){try{var s=localStorage.getItem(LSKEY);if(s)return normalizeState(JSON.parse(s))}catch(e){}return{monthlyDCA:2000,dcaOverride:{month:'',amount:0},roadmapStart:'2025-01',roadmapAge:27,sgovTarget:0,vgt:0.50,smh:0.30,btc:0.20}}



function saveState(){try{localStorage.setItem(LSKEY,JSON.stringify(state));markDirty('state');autoPushDebounce();localStorage.setItem(LSKEY+'_theme',document.documentElement.dataset.theme)}catch(e){if(e.name==='QuotaExceededError'||(e.message&&e.message.indexOf('quota')>=0))alert('存储空间不足，请导出数据后清理旧记录')}}



// ---- DCA (定投) ----



/* ===== DCA 定投 ===== */



function getEffectiveDCA(){var ov=state.dcaOverride,ym=marketDate().slice(0,7);if(ov&&ov.month===ym&&ov.amount>0)return ov.amount;return state.monthlyDCA||2000}



function updateDCA(){var dca=getEffectiveDCA(),baseAmt=state.monthlyDCA||2000;var baseEl=document.getElementById('dcaBaseAmt');if(baseEl)baseEl.textContent='$'+baseAmt.toLocaleString('en-US')+'/月 · 本月';var alloc={VGT:state.vgt,SMH:state.smh,BTC:state.btc},els={},sum=0;ETF_SYMS.forEach(function(s){var amt=dca*alloc[s];sum+=amt;els['dca'+s]=document.getElementById('dca'+s);if(els['dca'+s])els['dca'+s].textContent=fmt$(amt)});var ds=document.getElementById('dcaStatus');if(ds)checkDCAStatus(ds);updateMobileDcaSummary(dca)}
function updateMobileDcaSummary(target){var ym=marketDate().slice(0,7),invested=trades.filter(function(t){return t.shares>0&&t.date.slice(0,7)===ym}).reduce(function(s,t){return s+t.shares*t.price},0),pct=target>0?invested/target*100:0,whole=function(n){return'$'+safeNum(n).toLocaleString('en-US',{maximumFractionDigits:0})};var inv=document.getElementById('mobileDcaInvested'),tar=document.getElementById('mobileDcaTarget'),pe=document.getElementById('mobileDcaPct'),bar=document.getElementById('mobileDcaProgress');if(inv)inv.textContent=whole(invested);if(tar)tar.textContent=whole(target);if(pe)pe.textContent=Math.round(pct)+'%';if(bar)bar.style.width=Math.max(0,Math.min(100,pct))+'%';[['Vgt','vgt'],['Smh','smh'],['Btc','btc']].forEach(function(pair){var ratio=safeNum(state[pair[1]])||0,pctEl=document.getElementById('mobileDca'+pair[0]+'Pct'),amtEl=document.getElementById('mobileDca'+pair[0]+'Amt');if(pctEl)pctEl.textContent=Math.round(ratio*100)+'%';if(amtEl)amtEl.textContent=whole(target*ratio)});var v=safeNum(state.vgt)||0,s=safeNum(state.smh)||0,b=safeNum(state.btc)||0,sum=v+s+b||1,vp=document.getElementById('sbVgtPct'),sp=document.getElementById('sbSmhPct'),bp=document.getElementById('sbBtcPct'),mini=document.querySelector('.sb-mini-donut'),vEnd=v/sum*100,sEnd=(v+s)/sum*100;if(vp)vp.textContent=Math.round(v/sum*100)+'%';if(sp)sp.textContent=Math.round(s/sum*100)+'%';if(bp)bp.textContent=Math.round(b/sum*100)+'%';if(mini)mini.style.background='conic-gradient(var(--accent) 0 '+vEnd+'%, #4f83df '+vEnd+'% '+sEnd+'%, #f28b19 '+sEnd+'% 100%)'}



function checkDCAStatus(el){el=el||document.getElementById('dcaStatus');if(!el)return;var dca=getEffectiveDCA();if(dca<=0){el.innerHTML='<span style="color:var(--muted);">⚙️ 定投总额为 $0，请在侧边栏设置</span>';el.style.background='var(--surface)';return}var ym=marketDate().slice(0,7),buys=trades.filter(function(t){return t.shares>0&&t.date.slice(0,7)===ym});if(!buys.length){el.innerHTML='<span style="color:var(--orange);">⏳ 本月尚未开始定投</span>';el.style.background='linear-gradient(135deg,rgba(204,125,42,.08),transparent)';return}var bySym={};buys.forEach(function(t){bySym[t.symbol]=(bySym[t.symbol]||0)+t.shares*t.price});var v=bySym.VGT||0,m=bySym.SMH||0,b=bySym.BTC||0,total=v+m+b;var targetV=dca*state.vgt,targetM=dca*state.smh,targetB=dca*state.btc;var complete=total>=dca*0.9;if(complete){el.innerHTML='✅ 已完成 · 总额 '+fmt$(total)+'/'+fmt$(dca);el.style.background='var(--accent)';el.style.color='#fff'}



  else{if(v+m+b>0){el.innerHTML='⏳ 进行中 · '+fmt$(total)+'/'+fmt$(dca)+' ('+(total/dca*100).toFixed(0)+'%)';el.style.background='var(--orange)';el.style.color='#fff'}else{el.innerHTML='⏳ 本月待执行';el.style.background='rgba(204,125,42,.15)';el.style.color='var(--orange)'}}}



// ---- 日志页 ----



var ACTIVITY_KEY='wealth_activity_v1';



/* ===== 活动日志 ===== */



function addActivity(action,detail){var acts=[];try{acts=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')}catch(e){}acts.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),action:action,detail:detail||''});if(acts.length>200)acts=acts.slice(-200);localStorage.setItem(ACTIVITY_KEY,JSON.stringify(acts));markDirty('activities');renderActivity();autoPushDebounce()}



function renderActivity(){var el=document.getElementById('activityLog');if(!el)return;var acts=normalizeActivities(JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]'));if(!acts.length){el.innerHTML='<div class="table-empty">暂无操作记录</div>';return}el.innerHTML=acts.slice().reverse().map(function(a){var kind=a.action.indexOf('买入')>=0?'buy':a.action.indexOf('卖出')>=0?'sell':a.action.indexOf('入金')>=0?'deposit':a.action.indexOf('出金')>=0?'withdraw':'note',icon=kind==='buy'||kind==='deposit'?'<path d="m5 12 4 4 10-10"/>':kind==='sell'||kind==='withdraw'?'<path d="M6 6l12 12M18 6 6 18"/>':'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>';return'<div class="activity-item"><span class="activity-mark '+kind+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg></span><div class="activity-body"><div class="activity-title">'+escapeHtml(a.action)+'</div>'+(a.detail?'<div class="activity-detail">'+escapeHtml(a.detail)+'</div>':'')+'</div><span class="activity-time">'+escapeHtml(a.date.slice(5)+' '+a.time)+'</span><button class="trade-del" data-act="'+a.id+'" aria-label="删除这条日志">×</button></div>'}).join('')}



function renderLogHeatmap(){



  var container=document.getElementById('logHeatmap');if(!container)return;



  var curYM=marketDate().slice(0,7),now=new Date(Number(curYM.slice(0,4)),Number(curYM.slice(5,7))-1,1),dca=getEffectiveDCA();



  // Month data



  var months=[];



  for(var i=-11;i<=0;i++){var d=new Date(now.getFullYear(),now.getMonth()+i,1);months.push({ym:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),label:d.getMonth()+1+'月',isFuture:false})}



  months.forEach(function(mt){if(mt.ym>curYM)mt.isFuture=true;var buys=trades.filter(function(t){return t.shares>0&&t.date.slice(0,7)===mt.ym}),bs={};buys.forEach(function(t){bs[t.symbol]=(bs[t.symbol]||0)+t.shares*t.price});mt.totalV=(bs.VGT||0)+(bs.SMH||0)+(bs.BTC||0);mt.complete=!mt.isFuture&&mt.totalV>=dca*0.7&&buys.length>0;mt.hasBuy=buys.length>0});



  // Streak: count backward from last month



  var streak=0;for(var i=months.length-1;i>=0;i--){var m=months[i];if(m.isFuture||(m.ym===curYM&&!m.complete))continue;if(m.complete)streak++;else break}



  var sc=document.getElementById('streakCount');if(sc)sc.textContent=streak;



  // Render



  var htm='';months.forEach(function(mt){var bg,txt,icon;



    if(mt.isFuture){bg='transparent';txt='var(--rule)';icon=''}



    else if(!mt.hasBuy){bg='rgba(217,69,53,.08)';txt='var(--red)';icon='✕'}



    else if(mt.complete){bg='var(--accent)';txt='#fff';icon='✓'}



    else{bg='var(--orange)';txt='#fff';icon='~'}



    var state=mt.isFuture?'':mt.ym===curYM?'is-current':!mt.hasBuy?'is-empty':mt.complete?'is-done':'is-partial';htm+='<div class="discipline-month '+state+'" title="'+mt.ym+'：'+fmt$(mt.totalV)+'/'+fmt$(dca)+(mt.isFuture?' (未来)':'')+'"><span>'+mt.label+'</span>'+(icon?'<strong>'+icon+'</strong>':'')+'<span>'+fmt$(mt.totalV)+'</span></div>'});container.innerHTML=htm



}



function renderAnnualMatrix(){
  var grid=document.getElementById('annualMatrixGrid'),stats=document.getElementById('annualMatrixStats');
  if(!grid||!stats)return;

  // Find the first year with any buy trade or cash deposit
  var allDates=[].concat(trades.map(function(t){return t.date})).concat(cashLog.filter(function(l){return l.type.indexOf('入金')>=0}).map(function(l){return l.date}));
if(!allDates.length){grid.innerHTML=emptyStateHTML({title:'暂无纪律数据',hint:'记录第一笔买入后，这里会自动生成月度热力图'});stats.innerHTML='';return}
  allDates.sort();
  var startYear=parseInt(allDates[0].slice(0,4));
  var now=new Date(),endYear=now.getFullYear();
  var maxYears=20,totalYears=Math.min(maxYears,endYear-startYear+1);
  var cells=[];

  for(var i=0;i<totalYears;i++){
    var y=startYear+i,ys=String(y);
    var yBuys=trades.filter(function(t){return t.shares>0&&t.date.slice(0,4)===ys});
    var yPrem=optionTrades.filter(function(o){return o.added&&o.added.slice(0,4)===ys}).reduce(function(s,o){return s+(o.premium||0)*(o.contracts||1)},0);
    var dcaTotal=yBuys.reduce(function(s,t){return s+t.shares*t.price},0);
    var premRate=dcaTotal>0?yPrem/dcaTotal*100:0;

    var endHolds={};trades.filter(function(t){return t.date.slice(0,4)<=ys}).forEach(function(t){endHolds[t.symbol]=(endHolds[t.symbol]||0)+t.shares});
    var vgtSh=Math.max(0,endHolds.VGT||0),smhSh=Math.max(0,endHolds.SMH||0),btcSh=Math.max(0,endHolds.BTC||0);
    var fmtSh=function(n){return n===Math.floor(n)?n.toFixed(0):n.toFixed(1)};

    cells.push({ym:ys,prem:yPrem,dca:dcaTotal,rate:premRate,vgt:vgtSh,smh:smhSh,btc:btcSh,hasData:dcaTotal>0});
  }

  var totalInvested=cashLog.filter(function(l){return l.type.indexOf('入金')>=0}).reduce(function(s,l){return s+l.amount},0);
  var activeYears=cells.filter(function(c){return c.hasData}).length;
  var nc=getNetCash();
  var totalHoldings={};trades.forEach(function(t){totalHoldings[t.symbol]=(totalHoldings[t.symbol]||0)+t.shares});var totalMktV=0;ETF_SYMS.forEach(function(sym){var sh=Math.max(0,totalHoldings[sym]||0);totalMktV+=sh*(livePrices[sym]||0)});var totalAssets=totalMktV+nc;
  var cagr=totalInvested>0&&activeYears>0?Math.pow(totalAssets/totalInvested,1/activeYears)-1:0;
  var targetGap=Math.max(0,(state.targetGoal||2500000)-totalAssets);

  function heatColor(rate,hasData){
    if(!hasData)return['#f0f0ec','#888','rgba(0,0,0,.3)','rgba(0,0,0,.25)'];
    if(rate>=100)return['#6c0a1e','#fff','rgba(255,255,255,.75)','rgba(255,255,255,.6)'];
    if(rate>=50)return['#922b3e','#fff','rgba(255,255,255,.75)','rgba(255,255,255,.6)'];
    if(rate>=25)return['#c0392b','#fff','rgba(255,255,255,.75)','rgba(255,255,255,.65)'];
    if(rate>=12)return['#e67e22','#fff','rgba(255,255,255,.75)','rgba(255,255,255,.65)'];
    if(rate>=10)return['#e67e22','#fff','rgba(255,255,255,.75)','rgba(255,255,255,.65)'];
    if(rate>=8)return['#f0ad4e','#2c2c2c','rgba(0,0,0,.5)','rgba(0,0,0,.4)'];
    if(rate>=6)return['#f9e79f','#2c2c2c','rgba(0,0,0,.45)','rgba(0,0,0,.35)'];
    if(rate>=3)return['#aed6f1','#1a5276','rgba(0,0,0,.45)','rgba(0,0,0,.35)'];
    if(rate>=0.1)return['#d6eaf8','#2e86c1','rgba(0,0,0,.45)','rgba(0,0,0,.35)'];
    return['#5b6d8a','#fff','rgba(255,255,255,.7)','rgba(255,255,255,.6)'];
  }

  var htm='';
  cells.forEach(function(c){
    var h=heatColor(c.rate,c.hasData);
    var rateStr=c.hasData?c.rate.toFixed(1)+'%':'-';
    var holdStr=c.hasData?('VGT '+fmtSh(c.vgt)+'股  SMH '+fmtSh(c.smh)+'股  BTC '+fmtSh(c.btc)+'股'):'';
    var detail=c.hasData?('CC权利金 '+fmt$(c.prem)+' | 总买入 '+fmt$(c.dca)):'';
    htm+='<div class="annual-cell" style="background:'+h[0]+';color:'+h[1]+';border-color:'+h[3]+'"><span class="year" style="color:'+h[2]+'">'+c.ym+'</span><strong>'+rateStr+'</strong><span style="color:'+h[2]+'">'+holdStr+'</span><span style="color:'+h[3]+'">'+detail+'</span></div>';
  });
  grid.innerHTML=htm;

  var cc=totalAssets>=0?'var(--accent)':'var(--red)';
  stats.innerHTML='<div class="annual-stat"><span>总入金</span><strong>'+fmtFull(totalInvested)+'</strong></div><div class="annual-stat"><span>当前总资产</span><strong>'+fmtFull(totalAssets)+'</strong></div><div class="annual-stat"><span>长期 CAGR</span><strong style="color:'+cc+'">'+(cagr*100).toFixed(1)+'%</strong></div><div class="annual-stat"><span>目标差额</span><strong style="color:var(--orange)">'+fmtFull(targetGap)+'</strong></div><div class="annual-note">热力=年度权利金贡献率（CC权利金÷买入总额）颜色越暖权利金贡献越大</div>';
}



// ---- 数据页 ----



/* ===== 数据页 ===== */



function updateDataPage(){var nc=0;nc=getNetCash();var dc=document.getElementById('dataCashBal');if(dc)dc.textContent=fmtFull(nc);var dd=document.getElementById('dataDep');if(dd){var ds=0;cashLog.forEach(function(l){if(l.type==='入金')ds+=l.amount});dd.textContent=fmtFull(ds)}var dl=document.getElementById('dataSel');if(dl){var ss=0;trades.forEach(function(t){if(t.shares<0)ss+=Math.abs(t.shares)*t.price});dl.textContent=fmtFull(ss)}var db=document.getElementById('dataBuy');if(db){var bs=0;trades.forEach(function(t){if(t.shares>0)bs+=t.shares*t.price});db.textContent='-'+fmtFull(bs)}updateTradeList();updatePnlSummary();renderCashLog()}



function updateTradeList(){var body=document.getElementById('tradeBody');if(!body)return;var filter=document.getElementById('tradeFilterSym'),sym=filter?filter.value:'';var list=[].concat(trades).sort(function(a,b){var d=b.date.localeCompare(a.date);if(d!==0)return d;return(b.time||'').localeCompare(a.time||'')});if(sym)list=list.filter(function(t){return t.symbol===sym});if(!list.length){body.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px;">在操作台录入第一笔交易</td></tr>';return}body.innerHTML=list.map(function(t){return'<tr><td>'+t.date+(t.time?' '+t.time:'')+'</td><td>'+(t.tag==='assign'?'<strong style="color:var(--blue)">'+t.symbol+'</strong>':'<strong>'+t.symbol+'</strong>')+'</td><td>'+(t.shares>0?'+':'')+t.shares.toFixed(4)+'</td><td>$'+t.price.toFixed(2)+'</td><td>'+fmtFull(Math.abs(t.shares)*t.price)+'</td><td><button class="trade-del" data-id="'+t.id+'">×</button></td></tr>'}).join('')}



function updatePnlSummary(){var el=document.getElementById('pnlSummary');if(!el)return;var bySym={};trades.forEach(function(t){bySym[t.symbol]=(bySym[t.symbol]||0)+t.shares});var rows=[];['VGT','SMH','BTC'].forEach(function(sym){var sh=Math.max(0,bySym[sym]||0),p=livePrices[sym]||0;if(sh<=0)return;var cost=0,holds=0;for(var i=0;i<trades.length;i++){var t=trades[i];if(t.symbol!==sym)continue;if(t.shares>0){cost+=t.shares*t.price;holds+=t.shares}else{var avg=holds>0?cost/holds:t.price;cost-=Math.abs(t.shares)*avg;holds+=t.shares}}var value=p>0?holds*p:0,pnl=cost>0?value-cost:0,pct=cost>0?pnl/cost*100:0;rows.push({sym:sym,shares:holds,price:p,value:value,pnl:pnl,pct:pct})});var total=rows.reduce(function(s,r){return s+r.value},0);el.innerHTML=rows.map(function(r){var color=r.sym==='VGT'?'#7655d9':r.sym==='SMH'?'#2877df':'#ff6b24',width=total>0?r.value/total*100:0;return '<button class="asset-row" onclick="switchTab(\'data\')"><span class="asset-identity"><i style="background:'+color+'"></i><span><strong>'+r.sym+'</strong><small>'+r.shares.toFixed(2)+' 股</small></span></span><span class="asset-allocation"><i style="width:'+width.toFixed(1)+'%;background:'+color+'"></i></span><span class="asset-result"><strong>'+fmtFull(r.value)+'</strong><small class="'+(r.pct>=0?'positive':'negative')+'">'+(r.pct>=0?'+':'')+r.pct.toFixed(2)+'%</small></span><b>›</b></button>'}).join('')||'<div class="asset-empty">暂无持仓，在操作台录入第一笔交易</div>'}



// ---- 侧边栏小组件 ----



function updateDashboardWidgets(){



  // 偏离警报



  var holdings={},totalV=0;



  for(var i=0;i<trades.length;i++){var t=trades[i];holdings[t.symbol]=(holdings[t.symbol]||0)+t.shares}



  var curV=0,curS=0,curB=0;



  ETF_SYMS.forEach(function(s){var sh=Math.max(0,holdings[s]||0),v=sh*(livePrices[s]||0);if(s==='VGT')curV=v;if(s==='SMH')curS=v;if(s==='BTC')curB=v;totalV+=v});



  var target={VGT:state.vgt,SMH:state.smh,BTC:state.btc},hasHoldings=totalV>0;



  if(!hasHoldings){var rl0=document.getElementById('roadLabel');if(rl0)rl0.textContent='--';return}



  // 20年旅程



  var start=state.roadmapStart||'2025-01',sd=new Date(start+'-01'),ed=new Date(sd);ed.setFullYear(ed.getFullYear()+20);



  var now=new Date(),elapsed=(now-sd)/(ed-sd),pct=Math.min(100,Math.max(0,elapsed*100)),yrs=elapsed*20;



  var rl=document.getElementById('roadLabel'),rb=document.getElementById('roadBar'),rs2=document.getElementById('roadStart');



  if(rl)rl.textContent='第 '+yrs.toFixed(1)+' 年 / 20 年 ('+pct.toFixed(1)+'%)';



  if(rb)rb.style.width=pct+'%';



  if(rs2)rs2.textContent=start;



  var py=document.getElementById('pillYear');if(py){var sy=sd.getFullYear();py.textContent=sy+'-'+(sy+20)}



  updatePlanAges();



  // 再平衡锁定



  updateRebalanceLock();



}



// ---- 规划页动态年龄 ----



/* ===== 提款规划 ===== */



function updatePlanAges(){



  var base=state.roadmapAge||27;



  var divs=[['planAge1',base,base+3],['planAge2',base+3,base+8],['planAge3',base+8,base+15],['planAge4',base+15,base+20],['planExit1',base+13,base+20],['planExit2',base+20],['planExit3',base+20,base+23],['planExit4',base+23,null]];



  divs.forEach(function(d){var el=document.getElementById(d[0]);if(!el)return;if(d[2]!=null)el.textContent=d[1]+'-'+d[2]+'岁';else if(d[1])el.textContent=d[1]+'岁+'})



}



// ---- 操作台 ----



function updateRebalanceLock(){



  var now=new Date(),m=now.getMonth()+1,d=now.getDate(),isDec31=(m===12&&d===31);



  var badge=document.getElementById('rebalLockBadge'),msg=document.getElementById('rebalLockMsg'),content=document.getElementById('rebalContent');



  if(!badge||!msg||!content)return;



  if(isDec31){badge.textContent='今日解锁';badge.style.background='var(--accent-l)';badge.style.color='var(--accent)';msg.style.display='none';content.style.opacity='1';content.style.pointerEvents='auto'}



  else{var next=new Date(now.getFullYear()+((m===12&&d>31)?1:0),11,31,23,59,59);if(next<=now){next=new Date(now.getFullYear()+1,11,31,23,59,59)}var days=Math.ceil((next-now)/86400000);badge.textContent='锁定中';badge.style.background='var(--surface)';badge.style.color='var(--muted)';msg.style.display='block';msg.innerHTML='年度再平衡仅在 <strong>12月31日</strong> 开放使用<br><span style="font-size:.7rem;">距离解锁还有 <strong>'+days+'</strong> 天</span>';msg.style.background='var(--surface)';content.style.opacity='.85';content.style.pointerEvents='auto'}



}



function loadCash(){try{var s=localStorage.getItem(CB_KEY);var n=s?parseFloat(s):0;return isNaN(n)?0:n}catch(e){if(e.name==='QuotaExceededError'||(e.message&&e.message.indexOf('quota')>=0)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')};return 0}}function saveCash(){try{if(isNaN(cashBalance))cashBalance=0;localStorage.setItem(CB_KEY,cashBalance.toString());markDirty('cashBalance');doAutoBackup();autoPushDebounce()}catch(e){if(e.name==='QuotaExceededError'||(e.message&&e.message.indexOf('quota')>=0)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')}}}function loadCashLog(){try{var s=localStorage.getItem(CLOG_KEY);return normalizeCashLogs(s?JSON.parse(s):[])}catch(e){return[]}}function saveCashLog(){try{cashLog=normalizeCashLogs(cashLog);localStorage.setItem(CLOG_KEY,JSON.stringify(cashLog));markDirty('cashLog');doAutoBackup();autoPushDebounce()}catch(e){if(e.name==='QuotaExceededError'||(e.message&&e.message.indexOf('quota')>=0)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')}}}function renderCashLog(){var b=document.getElementById("cashLogBody");if(!b)return;var f=document.getElementById('cashFilter'),fv=f?f.value:'';var list=[];for(var i=0;i<cashLog.length;i++){if(!fv||cashLog[i].type.indexOf(fv)>=0)list.push(cashLog[i])}var tin=0,tout=0;cashLog.forEach(function(l){if(l.type.indexOf('入金')>=0)tin+=l.amount;else if(l.type.indexOf('出金')>=0)tout+=l.amount});var ci=document.getElementById('cashTotalIn');if(ci)ci.textContent=fmtFull(tin);var co=document.getElementById('cashTotalOut');if(co)co.textContent=fmtFull(tout);if(!list.length){b.innerHTML="<tr><td colspan=4 style=\"text-align:center;color:var(--muted);padding:16px;\">暂无资金流水</td></tr>";return}b.innerHTML=list.slice().reverse().map(function(l){var type=escapeHtml(l.type),dt=escapeHtml(l.date+(l.time?' '+l.time:''));return"<tr><td>"+dt+"</td><td><span style=\"display:inline-block;background:"+((l.type.indexOf('入金')>=0?"var(--accent-l)":(l.type.indexOf('权利金')>=0?"rgba(74,143,212,.12)":(l.type.indexOf('股息')>=0?"rgba(232,136,12,.12)":"rgba(230,53,43,.12)"))))+";color:"+((l.type.indexOf('入金')>=0?"var(--accent-d)":(l.type.indexOf('权利金')>=0?"var(--blue)":(l.type.indexOf('股息')>=0?"var(--orange)":"var(--red)"))))+";padding:2px 8px;border-radius:4px;font-size:.65rem;font-weight:500;\">"+type+"</span></td><td>"+fmtFull(l.amount)+"</td><td><button class=\"trade-del\" data-clog=\""+l.id+"\" aria-label=\"删除流水\">×</button></td></tr>"}).join("")}function refreshCashUI(){renderCashLog();updateHoldCash();updateSidebar();updateDataPage()}function loadTrades(){try{var s=localStorage.getItem(TRADE_KEY);return normalizeTrades(s?JSON.parse(s):[])}catch(e){return[]}}



function saveTrades(){try{trades=normalizeTrades(trades);localStorage.setItem(TRADE_KEY,JSON.stringify(trades));markDirty('trades');doAutoBackup();autoPushDebounce()}catch(e){if(e.name==='QuotaExceededError'||(e.message&&e.message.indexOf('quota')>=0))alert('存储空间不足，请导出数据后清理旧记录')}}







function fmtPnLFull(n){if(!isFinite(n))return'-';return(n>=0?'+':'')+fmtFull(n)}



function fmtPnLPctParen(n){if(!isFinite(n)||isNaN(n))return'';return'('+(n>=0?'+':'')+(n*100).toFixed(1)+'%)'}







function initTradeIds(){var max=0;for(var i=0;i<trades.length;i++){if(trades[i].id>max)max=trades[i].id}tradeIdCounter=max+1}







/* ===== 主题 & UI ===== */



function refreshVisualPalette(){DONUT_COLORS=ETF_SYMS.map(getAssetColor);if(typeof updatePortfolio==='function')updatePortfolio();if(typeof updateSidebar==='function')updateSidebar()}function updateThemeMeta(){var dark=document.documentElement.dataset.theme==='dark',meta=document.querySelector('meta[name="theme-color"]'),label=document.getElementById('desktopThemeLabel');if(meta)meta.content=dark?'#000000':'#f5f6f3';if(label)label.textContent=dark?'深色模式':'浅色模式'}function toggleTheme(){var h=document.documentElement,cur=h.dataset.theme;h.dataset.theme=cur==='dark'?'light':'dark';updateThemeMeta();refreshVisualPalette();try{localStorage.setItem(LSKEY+'_theme',h.dataset.theme)}catch(e){}setTimeout(function(){try{document.activeElement.blur()}catch(e){}},0)}document.getElementById('btnTheme').addEventListener('click',toggleTheme);window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(e){var t=localStorage.getItem(LSKEY+'_theme');if(!t||t==='system'){document.documentElement.dataset.theme=e.matches?'dark':'light';updateThemeMeta();refreshVisualPalette()}});



function setAccent(name){var h=document.documentElement;h.dataset.accent=name;document.querySelectorAll('.accent-dot').forEach(function(d){d.classList.toggle('active',d.dataset.accent===name)});refreshVisualPalette();try{localStorage.setItem(LSKEY+'_accent',name)}catch(e){}}



document.getElementById('accentDots').addEventListener('click',function(e){var dot=e.target.closest('.accent-dot');if(!dot)return;setAccent(dot.dataset.accent)});







// Sidebar toggle




document.getElementById('sidebarToggle').addEventListener('click',function(){var sb=document.querySelector('.sidebar');sb.classList.toggle('collapsed');var btn=document.getElementById('sidebarToggle');var arrow=btn.querySelector('.arrow');if(sb.classList.contains('collapsed')){arrow.textContent='▶';btn.style.left='6px';this.title='展开侧边栏'}else{arrow.textContent='◀';btn.style.left='266px';this.title='收起侧边栏'};try{localStorage.setItem(LSKEY+'_sidebar',sb.classList.contains('collapsed')?'1':'0')}catch(e){}});



(function(){try{if(localStorage.getItem(LSKEY+'_sidebar')==='1'){var sb=document.querySelector('.sidebar');sb.classList.add('collapsed');var a=document.querySelector('.sidebar-toggle .arrow');if(a)a.textContent='▶';var btn=document.getElementById('sidebarToggle');if(btn)btn.style.left='6px'}}catch(e){}})();



// Mobile settings drawer



function setMobileSettings(open){var sb=document.querySelector('.sidebar'),ov=document.getElementById('sbOverlay'),hb=document.getElementById('mobHamburger'),isOpen=!!open;if(!sb)return;sb.classList.toggle('open',isOpen);document.body.classList.toggle('drawer-open',isOpen);if(ov)ov.classList.toggle('show',isOpen);if(hb){hb.classList.toggle('sidebar-close',isOpen);hb.setAttribute('aria-expanded',String(isOpen));hb.setAttribute('aria-label',isOpen?'关闭设置':'打开设置');hb.title=isOpen?'关闭设置':'打开设置'}if(window.innerWidth<=800)sb.setAttribute('aria-hidden',String(!isOpen))}
function openMobileSettings(){if(window.innerWidth<=800){setMobileSettings(true);return}var btn=document.getElementById('sidebarToggle');if(btn)btn.click()}
function openAdvancedSettings(section){var details=document.querySelector('.advanced-settings');if(!details)return;details.open=true;var panels={sync:document.getElementById('settingsSync'),price:document.getElementById('settingsPrice'),data:document.getElementById('settingsData'),preferences:document.getElementById('settingsPreferences')},panel=panels[section]||details,target=section==='price'?document.getElementById('hmManualSym'):section==='preferences'?document.getElementById('monthlyDCAInput'):panel;if(section==='sync'){var sync=document.getElementById('syncPanel');if(sync)sync.classList.add('open')}document.querySelectorAll('.settings-panel.is-highlighted').forEach(function(el){el.classList.remove('is-highlighted')});if(panel.classList)panel.classList.add('is-highlighted');setTimeout(function(){panel.scrollIntoView({behavior:'smooth',block:'center'});if(target&&typeof target.focus==='function'&&(section==='price'||section==='preferences'))target.focus({preventScroll:true});setTimeout(function(){if(panel.classList)panel.classList.remove('is-highlighted')},900)},80)}
function togglePrivacy(){document.body.classList.toggle('privacy-mode')}
document.getElementById('mobHamburger').addEventListener('click',function(){setMobileSettings(!document.querySelector('.sidebar').classList.contains('open'))});



 document.getElementById('sbOverlay').addEventListener('click',function(){setMobileSettings(false)});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.querySelector('.sidebar.open'))setMobileSettings(false)});
window.addEventListener('resize',function(){if(window.innerWidth>800&&document.querySelector('.sidebar.open'))setMobileSettings(false)});



// ---- TABS ----



document.querySelectorAll('.tab-btn').forEach(function(b){b.addEventListener('click',function(){switchTab(b.dataset.tab)})});







document.getElementById('hmRefresh').addEventListener('click',function(){var btn=this;btn.style.opacity='.4';btn.style.pointerEvents='none';refreshPrices().then(function(){btn.style.opacity='1';btn.style.pointerEvents='auto'}).catch(function(){btn.style.opacity='1';btn.style.pointerEvents='auto'})});



document.getElementById('hmManualSet').addEventListener('click',function(){var sym=document.getElementById('hmManualSym').value.toUpperCase().trim();var price=parseFloat(document.getElementById('hmManualPrice').value);if(!sym||!price||price<=0||!ETF_SYMS.includes(sym))return;var manualData={price:price,source:'manual',time:Date.now()};livePrices[sym]=price;liveQuoteData[sym]=manualData;liveSources[sym]='手动';cachePrice(sym,manualData);document.getElementById('hmManualSym').value='';document.getElementById('hmManualPrice').value='';updatePortfolio();updateSidebar();updateSidebarPrices();showToast('✅ '+sym+' 价格已设为 $'+price.toFixed(2))});







document.getElementById('btnAddTrade').addEventListener('click',function(){



  var sym=document.getElementById('tfAsset').value,date=document.getElementById('tfDate').value||marketDate();



  var type=document.getElementById('tfType').value,shares=parseFloat(document.getElementById('tfShares').value),price=parseFloat(document.getElementById('tfPrice').value);



  if(!shares||!price||shares<=0||price<=0)return;



  if(type==='buy'){var avail=getNetCash();var cost=shares*price;if(cost>avail){alert('现金不足！\n需要：'+fmtFull(cost)+'\n可用：'+fmtFull(avail));return}}if(type==='sell'){var held=0;trades.forEach(function(t){if(t.symbol===sym)held+=t.shares});if(shares>held){alert('持仓不足！\n持有：'+held.toFixed(2)+'股\n卖出：'+shares.toFixed(2)+'股');return}}



  var qty=type==='sell'?-shares:shares;



  trades.push({id:tradeIdCounter++,symbol:sym,date:date,time:marketClock(),shares:qty,price:price,type:type});trades.sort(function(a,b){return a.date.localeCompare(b.date)});



  saveTrades();updatePortfolio();updateDCA();document.getElementById('tfShares').value='';document.getElementById('tfPrice').value='';updateTradeEstimate();



  addActivity((type==='sell'?'卖出 ':'买入 ')+sym+' '+shares.toFixed(2)+'股 @ $'+price.toFixed(2));



  showToast('✅ 录入成功','ok')



});







document.getElementById('btnExport').addEventListener('click',function(){var url=location.origin+location.pathname;navigator.clipboard.writeText(url).then(function(){var b=document.getElementById('btnExport');b.textContent='已复制!';setTimeout(function(){b.textContent='复制链接'},1500)}).catch(function(){alert(url)})});







function recordBackupTime(timestamp){var ts=Number(timestamp)||Date.now();localStorage.setItem('lastBackupTime',String(ts));var el=document.getElementById('lastBackupTime');if(el)el.textContent='上次备份 '+new Date(ts).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});renderSyncHealth()}
document.getElementById('btnExportData').addEventListener('click',function(){showBusyToast('正在生成完整备份');setTimeout(function(){var data=createBackupData(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wealth-complete-'+localDate()+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);recordBackupTime(Date.now());showToast('完整备份已导出 · '+data.trades.length+' 笔交易 · '+data.optionTrades.length+' 个期权','ok')},80)});



function importBackupData(data){if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('不是有效的备份文件');if(Number(data.version)>APP_DATA_VERSION)throw new Error('备份版本高于当前应用，请先更新应用');var nextTrades='trades'in data?normalizeTrades(data.trades):trades,nextCashLogs='cashLog'in data?normalizeCashLogs(data.cashLog):cashLog,nextOptions='optionTrades'in data?normalizeOptions(data.optionTrades):normalizeOptions(JSON.parse(localStorage.getItem('wealth_options_v2')||'[]')),nextActivities=('activities'in data||'notes'in data)?normalizeActivities(data.activities||data.notes):normalizeActivities(JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]'));var summary='交易 '+nextTrades.length+' 笔\n资金流水 '+nextCashLogs.length+' 条\n期权 '+nextOptions.length+' 个\n操作日志 '+nextActivities.length+' 条';if(!confirm('准备恢复以下数据：\n\n'+summary+'\n\n现有对应数据将被覆盖，是否继续？'))return false;if('state'in data){state=normalizeState(data.state);localStorage.setItem(LSKEY,JSON.stringify(state));markDirty('state')}if('trades'in data){trades=nextTrades;localStorage.setItem(TRADE_KEY,JSON.stringify(trades));markDirty('trades')}if('cashBalance'in data){cashBalance=safeNum(Number(data.cashBalance));localStorage.setItem(CB_KEY,String(cashBalance));markDirty('cashBalance')}if('cashLog'in data){cashLog=nextCashLogs;localStorage.setItem(CLOG_KEY,JSON.stringify(cashLog));markDirty('cashLog')}if('activities'in data||'notes'in data){localStorage.setItem(ACTIVITY_KEY,JSON.stringify(nextActivities));markDirty('activities')}if('optionTrades'in data){optionTrades=nextOptions;localStorage.setItem('wealth_options_v2',JSON.stringify(nextOptions));markDirty('optionTrades')}if(data.otmSettings&&typeof data.otmSettings==='object'){otmSettings={vgt:Math.max(1,Math.min(20,Number(data.otmSettings.vgt)||7)),smh:Math.max(1,Math.min(20,Number(data.otmSettings.smh)||5))};localStorage.setItem('otmSettings',JSON.stringify(otmSettings));markDirty('otmSettings')}var exitValue=data.exitPortfolio!==undefined?data.exitPortfolio:data.exit_portfolio;if(exitValue!==undefined){localStorage.setItem('exit_portfolio',cleanText(exitValue,120));markDirty('exit_portfolio')}if(data.prices&&typeof data.prices==='object'){var cleanPrices={};ETF_SYMS.forEach(function(sym){var p=data.prices[sym],n=Number(p&&p.price!==undefined?p.price:p);if(isFinite(n)&&n>0)cleanPrices[sym]=typeof p==='object'?Object.assign({},p,{price:n}):{price:n,source:'import',time:Date.now()}});localStorage.setItem(PRICE_KEY,JSON.stringify(cleanPrices))}if(data.theme==='dark'||data.theme==='light')localStorage.setItem(LSKEY+'_theme',data.theme);if(['forest','ocean','warm','plum','mono'].includes(data.accent))localStorage.setItem(LSKEY+'_accent',data.accent);autoPushDebounce();return true}
document.getElementById('fileImport').addEventListener('change',function(){var input=this,file=input.files[0];if(!file)return;if(file.size>5*1024*1024){showToast('备份文件过大，已取消导入','err');input.value='';return}var reader=new FileReader();reader.onload=function(){try{var data=JSON.parse(reader.result);if(importBackupData(data)){showToast('备份恢复成功，正在刷新','ok');setTimeout(function(){location.reload()},700)}}catch(e){showToast('导入失败：'+e.message,'err')}finally{input.value=''}};reader.readAsText(file)});



document.getElementById('csvImport').addEventListener('change',function(){var file=this.files[0];if(file)doCSVImport(file);this.value=''});







function loadAccent(){try{var a=localStorage.getItem(LSKEY+'_accent');if(a){document.documentElement.dataset.accent=a;document.querySelectorAll('.accent-dot').forEach(function(d){d.classList.toggle('active',d.dataset.accent===a)})}}catch(e){}}



function loadTheme(){try{var t=localStorage.getItem(LSKEY+'_theme'),isDark=false;if(t==='dark')isDark=true;else if(t==='light')isDark=false;else isDark=window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.dataset.theme=isDark?'dark':'light';updateThemeMeta()}catch(e){}}











// Global event delegation



document.body.addEventListener('click',function(e){var b=e.target.closest('.trade-del');if(!b)return;var hid=b.dataset.hold;if(hid){if(confirm('确定清仓 '+hid+'?')){trades=trades.filter(function(t){return t.symbol!==hid});saveTrades();updatePortfolio();showToast('已清仓 '+hid,'ok')}return}var tid=parseInt(b.dataset.id);if(tid){var rmed=trades.find(function(t){return t.id===tid});if(!rmed)return;trades=trades.filter(function(t){return t.id!==tid});saveTrades();updatePortfolio();showToast(rmed.symbol+' 交易已删除','ok',function(){trades.push(rmed);trades.sort(function(a,b){return a.date.localeCompare(b.date)});saveTrades();updatePortfolio()});return}var cid=parseInt(b.dataset.clog);if(cid){var rmedLog=cashLog.find(function(l){return l.id===cid});if(!rmedLog)return;cashLog=cashLog.filter(function(l){return l.id!==cid});cashBalance-=cashSigned(rmedLog);saveCashLog();saveCash();refreshCashUI();showToast(rmedLog.type+' 流水已删除','ok',function(){cashLog.push(rmedLog);cashLog.sort(function(a,b){return a.date.localeCompare(b.date)});cashBalance+=cashSigned(rmedLog);saveCashLog();saveCash();refreshCashUI()})}});







cashBalance=loadCash();cashLog=loadCashLog();function initPortfolio(){initTradeIds();var cached=readPriceCache();for(var sym in cached){livePrices[sym]=cached[sym].price||cached[sym];liveQuoteData[sym]=cached[sym];liveSources[sym]=cached[sym].source==='tencent'?'腾讯':cached[sym].source||'缓存';if(cached[sym].change!=null)liveChanges[sym]=cached[sym].change}updatePortfolio();refreshPrices();setInterval(refreshPrices,300000)}







function updateWithdrawal(){var p=parseInt(document.getElementById('rWdPortfolio').value),rate=parseFloat(document.getElementById('rWdRate').value)/100,wr=parseFloat(document.getElementById('rWdReturn').value)/100,inf=parseFloat(document.getElementById('rWdInfl').value)/100;var annual=p*rate;document.getElementById('wdAnnual').textContent=fmt$(annual);document.getElementById('wdMonthly').textContent=fmt$(annual/12);var rr=wr-inf,dep='永续',bal=p,y=0;if(rate>rr||rr<=0){while(bal>0&&y<80){bal=bal*(1+rr)-annual;y++}if(y<80)dep=y+' 年'}document.getElementById('wdDeplete').textContent=dep;document.getElementById('wdPerpetual').textContent=rr>0?fmtPct(rr):'不可'}



['rWdPortfolio','rWdRate','rWdReturn','rWdInfl'].forEach(function(id){var e=document.getElementById(id);if(!e)return;e.addEventListener('input',function(){var v=document.getElementById('v'+id.slice(1));if(v)v.textContent=id.indexOf('Portfolio')>=0?fmt$(parseInt(e.value)):(parseFloat(e.value).toFixed(1)+'%');updateWithdrawal()})});











var autoBackup=false;function doAutoBackup(){if(!autoBackup)return;var data=createBackupData(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wealth-auto-complete-'+localDate()+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);recordBackupTime(Date.now())}







function switchTab(tab){if(window.navigator&&navigator.vibrate)navigator.vibrate(8);if(tab==='log'||tab==='logs')tab='data';document.body.dataset.activeTab=tab;var titleMap={holding:'My Portfolio',console:'操作台',option:'期权',data:'记录',log:'记录'},desktopTitleMap={holding:'投资仪表盘',console:'操作台',option:'期权管理',data:'记录',log:'记录'};var mt=document.getElementById('msPageTitle');if(mt)mt.textContent=titleMap[tab]||'My Portfolio';var dt=document.getElementById('desktopPageTitle');if(dt)dt.textContent=desktopTitleMap[tab]||'投资仪表盘';



  document.querySelectorAll('.tab-btn').forEach(function(x){x.classList.remove('active')});



  document.querySelectorAll('.tab-panel').forEach(function(x){x.classList.remove('active')});



  var tb=document.querySelector('.tab-btn[data-tab="'+tab+'"]');



  if(tb)tb.classList.add('active');



  var panel=document.getElementById('tab-'+tab);



  if(panel)panel.classList.add('active');



  document.querySelectorAll('.bb-btn').forEach(function(b){b.classList.remove('active')});



  var bba=document.getElementById(tab==='holding'?'bbHoldings':tab==='holdings'?'bbHoldings':'bb'+tab.charAt(0).toUpperCase()+tab.slice(1));



  if(bba)bba.classList.add('active');



  if(tab==='holdings'||tab==='holding')updatePortfolio();






  if(tab==='log'){renderActivity();renderLogHeatmap();renderAnnualMatrix()}



  if(tab==='data')updateDataPage()
  if(tab==='option')setTimeout(function(){if(typeof updateAllO==="function")updateAllO()},50)
  if(tab==='console'&&typeof refreshTradeAffordability==='function')refreshTradeAffordability()

  var main=document.querySelector('.main');if(main&&window.innerWidth<=800)main.scrollTo({top:0,behavior:'auto'});setMobileSettings(false)



  try{document.activeElement.blur()}catch(e){}



}











function updateMobStatusBar(){
  var bar=document.getElementById('mobStatusBar');if(!bar)return;
  var bals={};trades.forEach(function(t){bals[t.symbol]=(bals[t.symbol]||0)+t.shares});var totalV=0,daily=0;ETF_SYMS.forEach(function(sym){var sh=Math.max(0,bals[sym]||0);totalV+=sh*(livePrices[sym]||0);daily+=sh*(liveChanges[sym]||0)});var nc=getNetCash();
  var vm=document.getElementById('msTotal');if(vm)animateVal(vm,totalV+nc);
  var ht=document.getElementById('hmTotal');if(ht)ht.textContent=fmtFull(totalV+nc);var hcp=document.getElementById('hmCashPct');if(hcp)hcp.textContent=(totalV+nc>0?nc/(totalV+nc)*100:0).toFixed(2)+'%';
  var mc=document.getElementById('msCash');if(mc)mc.textContent=fmtFull(nc);
  var mp=document.getElementById('msPnl'),srcPnl=document.getElementById('hmPnL');if(mp&&srcPnl){mp.textContent=srcPnl.textContent;mp.classList.toggle('pnl-neg',srcPnl.textContent.indexOf('-')===0);mp.classList.toggle('pnl-pos',srcPnl.textContent.indexOf('-')!==0)}
  var md=document.getElementById('msDaily'),prevV=totalV-daily,dailyPct=prevV>0?daily/prevV*100:0,dailyText='今日 '+(daily>=0?'+':'-')+fmtFull(Math.abs(daily))+' · '+(dailyPct>=0?'+':'')+dailyPct.toFixed(2)+'%';if(md){md.textContent=dailyText;md.classList.toggle('negative',daily<0)}var sd=document.getElementById('sbToday');if(sd){sd.textContent=dailyText;sd.style.color=daily<0?'var(--red)':'var(--accent)'}
  var pp=document.getElementById('msPrices');if(pp){pp.innerHTML=ETF_SYMS.map(function(sym){var p=livePrices[sym],ch=liveChanges[sym],chHtml='',chCls='';if(ch!=null){var prev=p-ch,pct=prev>0?ch/prev*100:0;chCls=ch>=0?'ms-pos':'ms-neg';chHtml=' <span class="'+chCls+'">'+(ch>=0?'+':'')+pct.toFixed(1)+'%</span>'}return '<span class="ms-pill" data-sym="'+sym+'" data-price="'+(p||0)+'"><strong>'+sym+'</strong> '+(p?'$'+p.toFixed(2):'--')+chHtml+'</span>'}).join('')}
}











/* ===== 交易操作 ===== */



function updateTradeEstimate(){
  var shares=parseFloat(document.getElementById('tfShares').value),price=parseFloat(document.getElementById('tfPrice').value),out=document.getElementById('tfEstimated');
  if(out)out.textContent=shares>0&&price>0?fmtFull(shares*price):'$0.00';
}
function syncTradeControls(){
  var type=document.getElementById('tfType'),asset=document.getElementById('tfAsset');
  if(!type||!asset)return;
  document.querySelectorAll('.segment').forEach(function(btn){
    var active=btn.dataset.tradeType===type.value;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',active?'true':'false');
  });
  document.querySelectorAll('.asset-chip').forEach(function(btn){
    btn.classList.toggle('active',btn.dataset.asset===asset.value);
  });
}
function initConsoleEntryControls(){
  var type=document.getElementById('tfType'),asset=document.getElementById('tfAsset'),shares=document.getElementById('tfShares'),price=document.getElementById('tfPrice');
  if(!type||!asset)return;
  document.querySelectorAll('.segment').forEach(function(btn){
    btn.addEventListener('click',function(){type.value=btn.dataset.tradeType;syncTradeControls()});
  });
  document.querySelectorAll('.asset-chip').forEach(function(btn){
    btn.addEventListener('click',function(){asset.value=btn.dataset.asset;syncTradeControls()});
  });
  type.addEventListener('change',syncTradeControls);
  asset.addEventListener('change',syncTradeControls);
  if(shares)shares.addEventListener('input',updateTradeEstimate);
  if(price)price.addEventListener('input',updateTradeEstimate);
  syncTradeControls();
  updateTradeEstimate();
}
function syncOptionControls(){
  var type=document.getElementById('otype'),asset=document.getElementById('osym');
  if(!type||!asset)return;
  document.querySelectorAll('.option-type-segment .segment').forEach(function(btn){
    var active=btn.dataset.optionType===type.value;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-selected',active?'true':'false');
  });
  document.querySelectorAll('.option-asset-chips .asset-chip').forEach(function(btn){
    btn.classList.toggle('active',btn.dataset.optionAsset===asset.value);
  });
}
function initOptionEntryControls(){
  var type=document.getElementById('otype'),asset=document.getElementById('osym');
  if(!type||!asset)return;
  document.querySelectorAll('.option-type-segment .segment').forEach(function(btn){
    btn.addEventListener('click',function(){type.value=btn.dataset.optionType;syncOptionControls()});
  });
  document.querySelectorAll('.option-asset-chips .asset-chip').forEach(function(btn){
    btn.addEventListener('click',function(){asset.value=btn.dataset.optionAsset;syncOptionControls()});
  });
  type.addEventListener('change',syncOptionControls);
  asset.addEventListener('change',syncOptionControls);
  syncOptionControls();
}
function fillTradeForm(sym,price){



  var se=document.getElementById('tfAsset');if(se)se.value=sym;syncTradeControls();



  var de=document.getElementById('tfDate');if(de)de.value=marketDate();



  var pe=document.getElementById('tfPrice');if(pe&&price)pe.value=price.toFixed(2);updateTradeEstimate();



  var qe=document.getElementById('tfShares');if(qe)qe.focus();syncTradeControls();



  var tb=document.querySelector('.tab-btn[data-tab="holding"]');if(tb)tb.click();



}



var _ptrEl=document.getElementById("pullHint"),_ptrBtn=document.getElementById("mobStatusBar");if(_ptrEl&&_ptrBtn){_ptrBtn.style.cursor="pointer";_ptrBtn.addEventListener("click",function(){_ptrEl.style.display="block";_ptrEl.innerHTML="⟳ 刷新中...";refreshPrices().then(function(){_ptrEl.innerHTML="✅ 已刷新";setTimeout(function(){_ptrEl.style.display="none"},1000)})})}







function initAll(){

  var initialTradeDate=document.getElementById('tfDate');if(initialTradeDate&&!initialTradeDate.value)initialTradeDate.value=marketDate();initConsoleEntryControls();



  initOptionEntryControls();



  document.getElementById('msPrices')?.addEventListener('click',function(e){



    var p=e.target.closest('.ms-pill');if(!p)return;



    var s=p.dataset.sym,pr=parseFloat(p.dataset.price);



    document.getElementById('tfAsset').value=s;



    document.getElementById('tfPrice').value=pr.toFixed(2);



    document.getElementById('tfDate').value=marketDate();



    document.getElementById('tfShares').focus();



    var tb=document.querySelector('.tab-btn[data-tab="holding"]');if(tb)tb.click();syncTradeControls();updateTradeEstimate();



  });



  autoBackup=localStorage.getItem('autoBackup')==='1';var cb=document.getElementById('cbAutoBackup');if(cb){cb.checked=autoBackup;cb.addEventListener('change',function(){autoBackup=this.checked;localStorage.setItem('autoBackup',autoBackup?'1':'0')})}var lbt=localStorage.getItem('lastBackupTime');if(lbt){var d2=new Date(parseInt(lbt));document.getElementById('lastBackupTime').textContent='上次备份 '+d2.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}



  try{loadAccent();loadTheme();



  state=loadState();trades=loadTrades();initTradeIds();



  var dcaInput=document.getElementById('monthlyDCAInput');if(dcaInput){dcaInput.value=state.monthlyDCA||2000;dcaInput.addEventListener('change',function(){var v=parseInt(dcaInput.value)||0;v=Math.max(0,Math.min(50000,v));dcaInput.value=v;state.monthlyDCA=v;saveState();updateDCA()})}var dcaOv=document.getElementById('dcaOverride');if(dcaOv){if(state.dcaOverride){var ym2=marketDate().slice(0,7);if(state.dcaOverride.month===ym2&&state.dcaOverride.amount>0)dcaOv.value=state.dcaOverride.amount}dcaOv.addEventListener('input',function(){var v=parseInt(dcaOv.value)||0;if(v<=0){state.dcaOverride={month:'',amount:0};dcaOv.value=''}else{state.dcaOverride={month:marketDate().slice(0,7),amount:v}}saveState();updateDCA()})}



  var rsInput=document.getElementById('roadmapStartInput');if(rsInput){rsInput.value=state.roadmapStart||'2025-01';rsInput.addEventListener('change',function(){state.roadmapStart=rsInput.value;saveState();updateDashboardWidgets()})}



  var raInput=document.getElementById('roadmapAgeInput');if(raInput){raInput.value=state.roadmapAge||27;raInput.addEventListener('change',function(){var v=parseInt(raInput.value)||27;v=Math.max(18,Math.min(70,v));raInput.value=v;state.roadmapAge=v;saveState();updatePlanAges()})}



  var tgInput=document.getElementById('targetGoalInput');if(tgInput){tgInput.value=state.targetGoal||2500000;tgInput.addEventListener('change',function(){var v=parseInt(tgInput.value)||2500000;v=Math.max(100000,Math.min(10000000,v));tgInput.value=v;state.targetGoal=v;saveState();updatePortfolio()});var tl=document.getElementById('targetLabel');if(tl)tl.textContent=fmt$(state.targetGoal||2500000)}



  updateWithdrawal();updateDCA();renderActivity();renderLogHeatmap();renderAnnualMatrix();renderCashLog();







  var ep=document.getElementById('exitPortfolio');if(ep){var saved=localStorage.getItem('exit_portfolio');if(saved)ep.value=saved;ep.addEventListener('change',function(){localStorage.setItem('exit_portfolio',ep.value);markDirty('exit_portfolio');autoPushDebounce()})}



  updateSidebarPrices();initPortfolio();document.getElementById('hmPricesCompact')?.addEventListener('click',function(e){var p=e.target.closest('.price-pill');if(!p)return;var s=p.dataset.sym;if(!s)return;document.getElementById('tfAsset').value=s;var pr=parseFloat(p.dataset.price);if(!isNaN(pr))document.getElementById('tfPrice').value=pr;syncTradeControls();updateTradeEstimate()});document.querySelectorAll('.collapsible-header').forEach(function(h){h.addEventListener('click',function(e){if(e.target.closest('button'))return;this.closest('.collapsible-card').classList.toggle('collapsed')})});setTimeout(autoPull,300);setTimeout(doRebalance,500);showFirstTimeGuide()}catch(e){console.error(e);document.body.innerHTML='<div style="padding:40px"><h2>Error</h2><pre>'+e.message+'</pre><p>Clear cache and reload (Ctrl+Shift+R)</p></div>'}



  var ht=document.querySelector('#holdBody');if(ht){ht=ht.parentElement.querySelector('thead');if(ht){var cols2=['sym','','','','value','pnl','pnlPct'];ht.style.cursor='pointer';ht.querySelectorAll('th').forEach(function(th){var c2=cols2[th.cellIndex];if(c2===holdSort.col)th.textContent+=' ↓';th.style.userSelect='none'});ht.addEventListener('click',function(e){var th=e.target.closest('th');if(!th)return;var col=cols2[th.cellIndex];if(!col)return;if(holdSort.col===col)holdSort.asc=!holdSort.asc;else{holdSort.col=col;holdSort.asc=false}updatePortfolio();var arr=holdSort.asc?' ↑':' ↓';ht.querySelectorAll('th').forEach(function(h,i){var c2=cols2[i];h.textContent=h.textContent.replace(/ [↑↓]$/,'')+(c2===holdSort.col?arr:'')})})}}
  window.__wealthReady=true;clearTimeout(window.__wealthBootTimer);document.documentElement.classList.remove('boot-slow');var fallback=document.getElementById('bootFallback');if(fallback)fallback.remove();



}



window.addEventListener('DOMContentLoaded',initAll);
window.addEventListener('DOMContentLoaded',function(){renderSyncHealth();var source=document.getElementById('syncStatus');if(source)new MutationObserver(renderSyncHealth).observe(source,{childList:true,characterData:true,subtree:true})});
if('serviceWorker' in navigator){var swRefreshing=false;navigator.serviceWorker.addEventListener('controllerchange',function(){if(swRefreshing)return;swRefreshing=true;location.reload()});navigator.serviceWorker.register('/sw.js?v=56',{updateViaCache:'none'}).then(function(reg){return reg.update()}).catch(function(){})}



/* ===== Toast 通知 ===== */



function showToast(msg,type,undoFn){var t=document.getElementById('syncToast');if(!t)return;t.style.pointerEvents='auto';clearTimeout(t._timer);t.onclick=null;if(undoFn){t.className='sync-toast undo show';t.textContent=msg+' · 点击撤销';t.style.cursor='pointer';t.onclick=function(){t.className='sync-toast';undoFn()};t._timer=setTimeout(function(){t.className='sync-toast'},5000)}else{t.className='sync-toast '+(type||'')+' show';t.textContent=msg;t.style.cursor='default';t._timer=setTimeout(function(){t.className='sync-toast'},type?3000:2500)}}function showFirstTimeGuide(){if(localStorage.getItem('wealth_first_time'))return;if(!trades.length&&!cashLog.length){setTimeout(function(){var sb=document.getElementById('syncStatus');if(sb&&sb.parentElement){sb.parentElement.insertAdjacentHTML('afterbegin','<div id="ftGuide" style="padding:8px 12px;background:var(--accent-l);border-radius:8px;font-size:.7rem;color:var(--accent);margin-bottom:8px;line-height:1.6;border-left:3px solid var(--accent);">👋 <b>首次使用？</b><br>📂 有备份文件 → 📥 导入<br>☁️ 有云端Token → ⬇ 下载</div>')}},1000)}localStorage.setItem('wealth_first_time','1')}







function updateHoldCash(){var ts=0,tb=0;trades.forEach(function(t){var a=Math.abs(t.shares)*t.price;if(t.shares<0)ts+=a;else tb+=a});var nc=getNetCash();document.getElementById('hmCash').textContent=fmtFull(nc);document.getElementById('hmDep').textContent=fmtFull((cashLog||[]).reduce(function(s,l){return s+(l.type.indexOf('\u5165\u91d1')>=0?l.amount:0)},0));document.getElementById('hmSel').textContent=fmtFull(ts);document.getElementById('hmBuy').textContent='-'+fmtFull(tb)}document.getElementById('hmDeposit').addEventListener('click',function(){var v=parseFloat(document.getElementById('hmCashAmt').value);if(isNaN(v)||v<=0)return;cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:'入金',amount:v});saveCashLog();document.getElementById('hmCashAmt').value='';addActivity('入金 '+fmtFull(v));refreshCashUI()});document.getElementById('hmWithdraw').addEventListener('click',function(){var v=parseFloat(document.getElementById('hmCashAmt').value),available=getNetCash();if(isNaN(v)||v<=0)return;if(v>available){alert('可用现金不足！\n申请出金：'+fmtFull(v)+'\n当前可用：'+fmtFull(available));return}cashBalance-=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:'出金',amount:v});saveCashLog();document.getElementById('hmCashAmt').value='';addActivity('出金 '+fmtFull(v));refreshCashUI()});







var doRebalance=function(){var rows=[];var holdings={};for(var i=0;i<trades.length;i++){var t=trades[i];if(!holdings[t.symbol])holdings[t.symbol]={shares:0,cost:0};holdings[t.symbol].shares+=Number(t.shares)}var totalV=0;for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var v=h.shares*(livePrices[sym]||0);if(v>0){rows.push({sym:sym,shares:h.shares,priced:!!livePrices[sym],value:v});totalV+=v}}updateRebalance(rows,totalV)};



document.body.addEventListener('click',function(e){var btn=e.target.closest('.rb-mode-btn');if(!btn)return;document.querySelectorAll('.rb-mode-btn').forEach(function(b){b.classList.remove('active')});btn.classList.add('active');rebalanceMode=btn.dataset.mode;doRebalance()});



document.getElementById('tradeFilterSym')?.addEventListener('change',function(){updateTradeList()});



document.getElementById('cashFilter')?.addEventListener('change',function(){renderCashLog()});



document.getElementById('btnRebalanceRecalc').addEventListener('click',doRebalance);







document.getElementById('btnClearTrades').addEventListener('click',function(){if(!trades.length)return;showApproval({title:'清空交易记录',message:'将删除本机全部 '+trades.length+' 条交易记录。清空后仍可点击底部提示条撤销。',confirmText:'清空 '+trades.length+' 条',onConfirm:function(){var old=trades.slice();trades=[];saveTrades();updatePortfolio();showToast('🗑️ 已清空 '+old.length+' 笔交易','ok',function(){trades=old.slice();saveTrades();updatePortfolio();showToast('✅ 已恢复 '+old.length+' 笔交易')})}})});







document.getElementById('btnClearCashLog').addEventListener('click',function(){if(!cashLog.length)return;showApproval({title:'清空资金流水',message:'将删除本机全部 '+cashLog.length+' 条资金流水，并把现金余额重置为 0。清空后可点击底部提示条撤销。',confirmText:'清空 '+cashLog.length+' 条',onConfirm:function(){var oldCash=cashLog.slice(),oldBal=cashBalance;cashLog=[];saveCashLog();cashBalance=0;saveCash();refreshCashUI();showToast('🗑️ 已清空 '+oldCash.length+' 条流水','ok',function(){cashLog=oldCash.slice();saveCashLog();cashBalance=oldBal;saveCash();refreshCashUI();showToast('✅ 已恢复资金流水')})}})});







document.getElementById('btnClearActivity').addEventListener('click',function(){var acts=[];try{acts=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')}catch(e){}if(!acts.length)return;showApproval({title:'清空操作日志',message:'将删除全部 '+acts.length+' 条操作日志。清空后可点击底部提示条撤销。',confirmText:'清空 '+acts.length+' 条',onConfirm:function(){var old=acts.slice();localStorage.setItem(ACTIVITY_KEY,'[]');markDirty('activities');renderActivity();showToast('🗑️ 已清空 '+old.length+' 条日志','ok',function(){localStorage.setItem(ACTIVITY_KEY,JSON.stringify(old));markDirty('activities');renderActivity();showToast('✅ 已恢复操作日志');autoPushDebounce()});autoPushDebounce()}})});










/* ===== 云端同步 ===== */



function sparklinePath(values){var points=(Array.isArray(values)?values:[]).map(Number).filter(function(v){return isFinite(v)&&v>0}).slice(-20);if(points.length<2)return'';var min=Math.min.apply(null,points),max=Math.max.apply(null,points),span=max-min;if(span<.000001)return'M1 11 H57';return points.map(function(v,i){var x=1+i*56/(points.length-1),y=20-(v-min)*18/span;return(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}).join(' ')}
function updateSidebarPrices(){var c={};try{c=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}')}catch(e){}var migrated=false;for(var k in c){if(c[k]&&c[k].ts&&!c[k].time){c[k].time=c[k].ts;migrated=true}}if(migrated)try{localStorage.setItem(PRICE_KEY,JSON.stringify(c))}catch(e){}var names={VGT:'Vanguard 信息科技',SMH:'VanEck 半导体',BTC:'Bitcoin ETF'},h='',hasAnyHistory=false;ETF_SYMS.forEach(function(s){var d=liveQuoteData[s]||c[s],name=names[s]||s;if(d&&d.price){var ch2=Number(d.change)||0,prev=d.price-ch2,pct=prev>0?ch2/prev*100:0,isFlat=Math.abs(ch2)<.0001,chClr=isFlat?'var(--muted)':ch2>0?'var(--accent)':'var(--red)',chSign=ch2>0?'+':'',sparkPath=sparklinePath(d.history),hasHistory=!!sparkPath,title=hasHistory?'近一月真实日线收盘走势':'暂无历史走势';hasAnyHistory=hasAnyHistory||hasHistory;h+='<div class="sb-price-row"><span class="spr-id"><strong>'+s+'</strong><small>'+name+'</small></span><svg class="spr-spark" viewBox="0 0 58 22" role="img" aria-label="'+title+'" style="color:'+chClr+'"><path d="'+(sparkPath||'M1 11 H57')+'"'+(hasHistory?'':' stroke-dasharray="3 3"')+'/></svg><span class="spr-quote"><b class="spr-price">$'+Number(d.price).toFixed(2)+'</b><small class="spr-chg" style="color:'+chClr+'">'+chSign+pct.toFixed(2)+'%</small></span></div>'}else{h+='<div class="sb-price-row"><span class="spr-id"><strong>'+s+'</strong><small>'+name+'</small></span><svg class="spr-spark" viewBox="0 0 58 22" role="img" aria-label="暂无行情数据" style="color:var(--muted)"><path d="M1 11 H57" stroke-dasharray="3 3"/></svg><span class="spr-quote"><b class="spr-price">--</b><small class="spr-chg">等待报价</small></span></div>'}});var live=document.getElementById('sbLivePrices');if(live)live.innerHTML=h||'暂无';var quoteValues=Object.values(Object.assign({},c,liveQuoteData)),t=quoteValues.map(function(d){return d&&(d.time||d.ts)}).filter(Boolean).sort().pop(),age='',ts='',m=Infinity;if(t){m=Math.max(0,Math.round((Date.now()-t)/60000));var relative=m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前';age=m>5?'数据延迟 · '+relative:relative;ts=formatChinaTime(new Date(t))}var marketTime=document.getElementById('sbMarketTime');if(marketTime)marketTime.textContent=!t?'等待':m>5?'延迟':'已更新';var meta=document.getElementById('sbPriceMeta');if(meta)meta.textContent=t?'北京时间 '+ts+' ('+age+') · '+(hasAnyHistory?'近一月日线':'历史曲线待更新'):'曲线等待历史数据';var pt=document.getElementById('hmPriceTime');if(pt)pt.textContent=t?'北京时间 '+ts+' ('+age+')':''}







/* ===== 同步状态追踪 (dirty / cloudTs) — 防止静默覆盖 ===== */
var SYNC_STATE_KEY='wealth_sync_state';
var SYNC_KEYS=['trades','cashBalance','cashLog','state','activities','optionTrades','otmSettings','exit_portfolio'];
function loadSyncState(){try{var s=JSON.parse(localStorage.getItem(SYNC_STATE_KEY)||'{}');s.dirty=s.dirty||{};s.cloudTs=s.cloudTs||{};s.pendingConflicts=Array.isArray(s.pendingConflicts)?s.pendingConflicts:[];s.lastSyncAt=Number(s.lastSyncAt)||0;s.lastSyncErrorAt=Number(s.lastSyncErrorAt)||0;s.lastSyncDirection=s.lastSyncDirection||'';return s}catch(e){return{dirty:{},cloudTs:{},pendingConflicts:[],lastSyncAt:0,lastSyncErrorAt:0,lastSyncDirection:''}}}
function saveSyncState(s){try{localStorage.setItem(SYNC_STATE_KEY,JSON.stringify(s))}catch(e){}if(document.readyState!=='loading')renderSyncHealth()}
function formatHealthTime(timestamp){var ts=Number(timestamp)||0;if(!ts)return '';return new Date(ts).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function setHealthRow(id,status){var row=document.getElementById(id);if(!row)return;row.classList.remove('is-ok','is-warn','is-error');if(status)row.classList.add('is-'+status)}
function recordSyncSuccess(direction,timestamp){var s=loadSyncState();s.lastSyncAt=Number(timestamp)||Date.now();s.lastSyncDirection=direction||'check';s.lastSyncErrorAt=0;saveSyncState(s);renderSyncHealth()}
function recordSyncFailure(timestamp){var s=loadSyncState();s.lastSyncErrorAt=Number(timestamp)||Date.now();saveSyncState(s);renderSyncHealth()}
function setSyncConflicts(conflicts){var s=loadSyncState();s.pendingConflicts=Array.from(new Set(conflicts||[]));saveSyncState(s);renderSyncHealth()}
function renderSyncHealth(){var s=loadSyncState(),configured=!!(typeof syncCfg!=='undefined'&&syncCfg&&syncCfg.token),dirtyCount=SYNC_KEYS.filter(function(k){return !!s.dirty[k]}).length,conflictCount=s.pendingConflicts.length,failed=s.lastSyncErrorAt>s.lastSyncAt,cloudText=!configured?'尚未配置':failed?'失败 · '+formatHealthTime(s.lastSyncErrorAt):s.lastSyncAt?formatHealthTime(s.lastSyncAt):'等待首次同步',backupAt=Number(localStorage.getItem('lastBackupTime'))||0,backupText=backupAt?formatHealthTime(backupAt):'尚未导出',stateText=conflictCount?conflictCount+'项冲突':failed?'同步需重试':!configured?'本地保存':dirtyCount?dirtyCount+'项待同步':s.lastSyncAt?'云端正常':'等待同步',mobileText=conflictCount?'发现数据冲突':failed?'同步需重试':!configured?'本地已保存':dirtyCount?'等待云同步':'云端已同步';var stateEl=document.getElementById('sbSyncState'),cloudEl=document.getElementById('sbSyncLast'),backupEl=document.getElementById('sbBackupLast'),conflictEl=document.getElementById('sbConflictState'),mobileEl=document.getElementById('msSyncText');if(stateEl){stateEl.textContent=stateText;stateEl.classList.toggle('is-error',failed||conflictCount>0)}if(cloudEl)cloudEl.textContent=cloudText;if(backupEl)backupEl.textContent=backupText;if(conflictEl)conflictEl.textContent=conflictCount?conflictCount+'项待处理':'无冲突';if(mobileEl){mobileEl.textContent=mobileText;mobileEl.parentElement.classList.toggle('sync-error',failed||conflictCount>0)}setHealthRow('sbCloudRow',!configured?'':failed?'error':s.lastSyncAt?'ok':'warn');setHealthRow('sbBackupRow',backupAt?'ok':'warn');setHealthRow('sbConflictRow',conflictCount?'error':'ok')}
function markDirty(key){var s=loadSyncState();if(!s.dirty[key]){s.dirty[key]=true;saveSyncState(s)}}
function clearDirty(key){var s=loadSyncState();s.dirty[key]=false;saveSyncState(s)}
function setCloudTs(key,ts){var s=loadSyncState();ts=Number(ts)||Date.now();s.cloudTs[key]=ts<1e12?ts*1000:ts;saveSyncState(s)}
function hasLocalData(key){
  if(key==='trades')return trades.length>0;
  if(key==='cashBalance')return localStorage.getItem(CB_KEY)!==null;
  if(key==='cashLog')return cashLog.length>0;
  if(key==='state')return localStorage.getItem(LSKEY)!==null;
  if(key==='activities')return(JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')).length>0;
  if(key==='optionTrades')return(JSON.parse(localStorage.getItem('wealth_options_v2')||'[]')).length>0;
  if(key==='otmSettings')return localStorage.getItem('otmSettings')!==null;
  if(key==='exit_portfolio')return localStorage.getItem('exit_portfolio')!==null;
  return false;
}
function hasCloudData(key,cv){
  if(cv===undefined||cv===null)return false;
  return true;
}
function isEmptyCloudVal(cv){if(cv===undefined||cv===null)return true;if(Array.isArray(cv))return cv.length===0;if(typeof cv==='object')return Object.keys(cv).length===0;if(typeof cv==='string')return cv==='';if(typeof cv==='number')return cv===0;return false}
function localValOf(key){
  if(key==='trades')return trades;
  if(key==='cashBalance')return cashBalance;
  if(key==='cashLog')return cashLog;
  if(key==='state')return state;
  if(key==='activities')return JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]');
  if(key==='optionTrades')return JSON.parse(localStorage.getItem('wealth_options_v2')||'[]');
  if(key==='otmSettings')return JSON.parse(localStorage.getItem('otmSettings')||'{"vgt":7,"smh":5}');
  if(key==='exit_portfolio')return localStorage.getItem('exit_portfolio')||'';
  return undefined;
}
function applyCloudVal(key,val){
  if(key==='trades'){trades=normalizeTrades(val);saveTradesNoPush()}
  else if(key==='cashBalance'){if(typeof val!=='number'||isNaN(val))val=0;cashBalance=val;saveCashNoPush()}
  else if(key==='cashLog'){cashLog=normalizeCashLogs(val);saveCashLogNoPush()}
  else if(key==='state'){state=normalizeState(val);saveStateNoPush()}
  else if(key==='activities'){localStorage.setItem(ACTIVITY_KEY,JSON.stringify(normalizeActivities(val)))}
  else if(key==='optionTrades'){optionTrades=normalizeOptions(val);localStorage.setItem('wealth_options_v2',JSON.stringify(optionTrades))}
  else if(key==='otmSettings'){if(typeof val!=='object'||!val)val={vgt:7,smh:5};localStorage.setItem('otmSettings',JSON.stringify(val));otmSettings=val;updateOtm()}
  else if(key==='exit_portfolio'){localStorage.setItem('exit_portfolio',val);var ep=document.getElementById('exitPortfolio');if(ep)ep.value=val}
}
function buildPushData(dirtyOnly){
  var expected={};
  var d={};
  var inc=function(key,getter){if(!dirtyOnly||loadSyncState().dirty[key]){d[key]=getter();expected[key]=loadSyncState().cloudTs[key]||0}};
  inc('trades',function(){return trades});
  inc('cashBalance',function(){return cashBalance});
  inc('cashLog',function(){return cashLog});
  inc('state',function(){return state});
  inc('activities',function(){return JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')});
  inc('optionTrades',function(){return JSON.parse(localStorage.getItem('wealth_options_v2')||'[]')});
  inc('otmSettings',function(){return JSON.parse(localStorage.getItem('otmSettings')||'{"vgt":7,"smh":5}')});
  inc('exit_portfolio',function(){return localStorage.getItem('exit_portfolio')||''});
  d['prices']=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');
  d.__expectedVersions=expected;
  return d;
}

function clearAllData(){
  var cfg=syncCfg||{}; var base=(cfg.url||location.origin).replace(/\/$/,'');
  var hasCloud=!!cfg.token;
  var promptText=hasCloud?'确定清除本地与云端的全部投资数据？\n\n请先确认已导出完整备份。云端清除成功后才会清理本机。':'确定清除本机全部投资数据？\n\n当前未配置云同步，只会清理本机。请先确认已导出完整备份。';
  showApproval({title:'清除全部数据',message:promptText,confirmText:'清除全部',onConfirm:function(){
  var empty={trades:[],cashBalance:0,cashLog:[],state:{},activities:[],optionTrades:[],otmSettings:{},exit_portfolio:'',prices:{}};
  var clearLocal=function(){
    ['wealth_trades_v2','wealth_cash_v2','wealth_cashlog_v2','wealth_dashboard_v2','wealth_activity_v1','wealth_options_v2','otmSettings','exit_portfolio','wealth_prices_v2','wealth_sync_state','lastBackupTime','wealth_alert_snooze_v1'].forEach(function(k){try{localStorage.removeItem(k)}catch(e){}});
    location.reload();
  };
  if(!hasCloud){clearLocal();return}
  showToast('正在清除云端数据');
  fetch(base+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Auth-Token':cfg.token},body:JSON.stringify(empty)}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(r){if(!r.ok)throw new Error(r.error||'云端拒绝清除');clearLocal()}).catch(function(e){showToast('云端清除失败，本地数据已保留：'+e.message,'err')});
  }});
}

function showSyncConflict(conflicts,pendingCloud){
  setSyncConflicts(conflicts);
  var existing=document.getElementById('conflictModal');if(existing)existing.remove();
  var labels={trades:'交易记录',cashBalance:'现金余额',cashLog:'资金流水',state:'投资参数',activities:'操作日志',optionTrades:'期权持仓',otmSettings:'OTM百分比',exit_portfolio:'退出策略'};
  var rows=conflicts.map(function(k){var lbl=labels[k]||k;return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--rule);"><span style="font-size:.7rem;font-weight:540;">'+lbl+'</span><span style="display:flex;gap:10px;font-size:.7rem;"><label style="display:flex;align-items:center;gap:3px;cursor:pointer;"><input type="radio" name="cf_'+k+'" value="local" checked><span>保留本地</span></label><label style="display:flex;align-items:center;gap:3px;cursor:pointer;"><input type="radio" name="cf_'+k+'" value="cloud"><span>使用云端</span></label></span></div>'}).join('');
  var modal=document.createElement('div');modal.id='conflictModal';modal.style.cssText='position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:20px;';modal.innerHTML='<div style="background:var(--card-bg);border-radius:14px;padding:20px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3);"><h3 style="font-size:.78rem;font-weight:600;margin-bottom:6px;color:var(--orange);">数据冲突</h3><p style="font-size:.7rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">云端和本地都有更新,请选择保留哪一边。默认保留本地(当前设备的改动)。</p>'+rows+'<div style="display:flex;gap:8px;margin-top:14px;"><button id="cfCancel" class="btn btn-out" style="flex:1;font-size:.7rem;">全部保留本地</button><button id="cfOk" class="btn btn-pri" style="flex:1;font-size:.7rem;">确定</button></div></div>';document.body.appendChild(modal);
  document.getElementById('cfCancel').onclick=function(){conflicts.forEach(function(k){markDirty(k)});setSyncConflicts([]);modal.remove();showToast('已保留本地数据(稍后推送到云端)','ok')};
  document.getElementById('cfOk').onclick=function(){var applied=[];conflicts.forEach(function(k){var chosen=document.querySelector('input[name="cf_'+k+'"]:checked');if(chosen&&chosen.value==='cloud'){applyCloudVal(k,pendingCloud[k]);clearDirty(k);applied.push(k)}else{markDirty(k)}});setSyncConflicts([]);modal.remove();if(applied.length){initTradeIds();updatePortfolio();updateSidebar();renderCashLog();updateAllO();updateOtm();showToast('已使用云端: '+applied.map(function(k){return labels[k]||k}).join(', '),'ok');autoPushDebounce()}else{showToast('已保留本地数据','ok')}}
}

function stableStr(v){if(Array.isArray(v))return '['+v.map(stableStr).join(',')+']';if(v&&typeof v==='object'){return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+stableStr(v[k])}).join(',')+'}'}return JSON.stringify(v)}var autoPushTimer=null;function autoPushDebounce(){if(!syncCfg.url||!syncCfg.token)return;clearTimeout(autoPushTimer);autoPushTimer=setTimeout(autoPush,2000)}
window.addEventListener('beforeunload',function(){if(autoPushTimer){clearTimeout(autoPushTimer);autoPushTimer=null;var data=buildPushData(true);if(Object.keys(data).length<=1)return;var base=syncCfg.url||location.origin;try{fetch(base.replace(/\/$/,'')+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Auth-Token':syncCfg.token},body:JSON.stringify(data),keepalive:true}).catch(function(){})}catch(e){}}});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!document.getElementById('conflictModal'))autoPull()});function autoPush(){var data=buildPushData(true);if(Object.keys(data).length<=2)return;syncPushImpl(data)}function autoPull(){if(!syncCfg.url||!syncCfg.token)return;syncFetch('GET').then(function(r){if(!r.data)return;var meta=r.meta||{};var ss=loadSyncState();var conflicts=[],pendingCloud={},pulled=[];SYNC_KEYS.forEach(function(key){var cv=r.data[key];var cTs=meta[key];var lastTs=ss.cloudTs[key];var dirty=!!ss.dirty[key];var lv=localValOf(key);var hasL=hasLocalData(key);var hasC=hasCloudData(key,cv);if(!hasC){if(hasL)ss.dirty[key]=true;return}if(!hasL){if(isEmptyCloudVal(cv)){ss.dirty[key]=false;if(cTs)ss.cloudTs[key]=cTs;return}applyCloudVal(key,cv);pulled.push(key);ss.dirty[key]=false;if(cTs)ss.cloudTs[key]=cTs;return}var eq=key==='state'?stableStr(normalizeState(lv))===stableStr(normalizeState(cv)):stableStr(lv)===stableStr(cv);if(eq){ss.dirty[key]=false;if(cTs)ss.cloudTs[key]=cTs;return}var cloudChanged=(cTs===undefined)?true:(cTs!==lastTs);if(cloudChanged&&dirty){conflicts.push(key);pendingCloud[key]=cv}else if(cloudChanged&&!dirty){applyCloudVal(key,cv);pulled.push(key);ss.dirty[key]=false;if(cTs)ss.cloudTs[key]=cTs}else if(!cloudChanged&&dirty){}else{ss.dirty[key]=true}});saveSyncState(ss);if(r.data.prices){var lp=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');for(var k in r.data.prices){var cd=r.data.prices[k];if(!cd)continue;if(!lp[k]||!cd.time||cd.time>=(lp[k].time||0)){lp[k]=cd;livePrices[k]=cd.price}}localStorage.setItem(PRICE_KEY,JSON.stringify(lp))}initTradeIds();updatePortfolio();updateSidebarPrices();updateSidebar();renderCashLog();updateAllO();renderActivity();if(pulled.length){var _sl={trades:'交易记录',cashBalance:'现金余额',cashLog:'资金流水',state:'投资参数',activities:'操作日志',optionTrades:'期权持仓',otmSettings:'OTM设置',exit_portfolio:'退出策略'};showToast('☁️ 已从云端同步：'+pulled.map(function(k){return _sl[k]||k}).join('·'),'ok')};if(conflicts.length)showSyncConflict(conflicts,pendingCloud)}).catch(function(){})}function saveTradesNoPush(){try{localStorage.setItem(TRADE_KEY,JSON.stringify(trades))}catch(e){console.error("保存交易记录失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveCashNoPush(){try{localStorage.setItem(CB_KEY,cashBalance.toString())}catch(e){console.error("保存现金余额失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveCashLogNoPush(){try{localStorage.setItem(CLOG_KEY,JSON.stringify(cashLog))}catch(e){console.error("保存现金流水失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveStateNoPush(){try{localStorage.setItem(LSKEY,JSON.stringify(state))}catch(e){console.error("保存投资参数失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function syncPushImpl(data){var dot=document.getElementById('syncDot');if(dot)dot.style.background='var(--orange)';syncFetch('POST',data).then(function(r){var el=document.getElementById('syncStatus');if(el){el.textContent='auto '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});el.style.color='var(--accent)'}if(dot){dot.style.background='var(--accent)';setTimeout(function(){dot.style.background='var(--muted)'},2000)};Object.keys(data).forEach(function(k){if(SYNC_KEYS.indexOf(k)>=0){clearDirty(k);setCloudTs(k,Math.floor((r.ts||Date.now())/1000))}});showToast('已同步到云端','ok')}).catch(function(error){if(dot)dot.style.background='var(--red)';if(error&&error.status===409){autoPull();showToast('云端已有更新，请确认冲突','err')}else{showToast('同步失败,本地改动仍在,稍后会重试','err')}})} var SYNC_KEY='wealth_sync_cfg';var syncCfg=loadSyncCfg();function loadSyncCfg(){try{return JSON.parse(localStorage.getItem(SYNC_KEY)||'{"url":"","token":""}')}catch(e){return{url:"",token:""}}}function saveSyncCfg(){try{localStorage.setItem(SYNC_KEY,JSON.stringify(syncCfg))}catch(e){console.error("保存同步配置失败:",e)}}function syncFetch(method,body){var base=syncCfg.url||location.origin;return fetch(base.replace(/\/$/,'')+'/api/sync',{method:method,headers:{'Content-Type':'application/json','X-Auth-Token':syncCfg.token},body:body?JSON.stringify(body):undefined}).then(function(r){if(!r.ok)return r.json().then(function(body){var err=new Error(body.error||('HTTP '+r.status));err.status=r.status;err.body=body;throw err});return r.json()})}function syncPush(){var data=buildPushData(false);syncFetch('POST',data).then(function(r){Object.keys(data).forEach(function(k){if(SYNC_KEYS.indexOf(k)>=0){clearDirty(k);setCloudTs(k,Math.floor((r.ts||Date.now())/1000))}});var el=document.getElementById('syncStatus');el.textContent='已同步 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});el.style.color='var(--accent)';showToast('已同步到云端','ok')}).catch(function(e){var el=document.getElementById('syncStatus');el.textContent='失败: '+e.message;el.style.color='var(--red)';showToast('同步失败: '+e.message,'err')})}function syncPull(){var ss=loadSyncState();var dirtyN=SYNC_KEYS.filter(function(k){return ss.dirty[k]}).length;if(dirtyN>0){if(!confirm('本地有 '+dirtyN+' 项未同步改动会被云端覆盖,确定?'))return}syncFetch('GET').then(function(r){if(!r.data)throw new Error('空响应');SYNC_KEYS.forEach(function(k){if(r.data[k]!==undefined&&r.data[k]!==null)applyCloudVal(k,r.data[k])});if(r.data.prices){var lp=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');for(var k in r.data.prices){var cd=r.data.prices[k];if(!cd)continue;if(!lp[k]||!cd.time||cd.time>=(lp[k].time||0)){lp[k]=cd;livePrices[k]=cd.price}}localStorage.setItem(PRICE_KEY,JSON.stringify(lp))}SYNC_KEYS.forEach(function(k){clearDirty(k)});showToast('已从云端同步,刷新中...','ok');setTimeout(function(){location.reload()},600)}).catch(function(e){var el=document.getElementById('syncStatus');el.textContent='失败: '+e.message;el.style.color='var(--red)';showToast('同步失败: '+e.message,'err')})}document.getElementById('btnSyncPush').addEventListener('click',syncPush);document.getElementById('btnSyncPull').addEventListener('click',syncPull);document.getElementById('syncUrl').addEventListener('change',function(){syncCfg.url=this.value;saveSyncCfg()});document.getElementById('syncToken').addEventListener('change',function(){syncCfg.token=this.value;saveSyncCfg()});(function(){var el=document.getElementById('syncUrl');if(el){if(syncCfg.url)el.value=syncCfg.url;else{el.value=location.origin;el.placeholder=location.origin;syncCfg.url=location.origin;saveSyncCfg()}}var t2=document.getElementById('syncToken');if(t2&&syncCfg.token)t2.value=syncCfg.token})();



var syncFetchWithoutHealth=syncFetch;
syncFetch=function(method,body){var ms=document.getElementById('msSyncText'),host=ms&&ms.closest('.ms-sync');if(host)host.classList.add('is-syncing');var done=function(){if(host)host.classList.remove('is-syncing')};return syncFetchWithoutHealth(method,body).then(function(result){recordSyncSuccess(method==='GET'?'pull':'push',Date.now());done();return result}).catch(function(error){recordSyncFailure(Date.now());done();throw error})};
document.getElementById('syncToken').addEventListener('change',renderSyncHealth);
document.getElementById('syncPanelHeader').addEventListener('click',function(){document.getElementById('syncPanel').classList.toggle('open')});







// ---- Schwab CSV parser ----



/* ===== CSV 导入 ===== */



function parseCSVRow(line){var out=[],cur='',quoted=false;for(var i=0;i<line.length;i++){var ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){out.push(cur.trim());cur=''}else cur+=ch}out.push(cur.trim());return out}
function parseMoneyValue(v){return Number(cleanText(v,40).replace(/[$,]/g,''))||0}
function parseSchwabCSV(text){
  var lines=String(text||'').split(/\r?\n/).filter(function(l){return l.trim().length>0});
  var colMap={},imported=0,headerFound=false,seen={};
  trades.forEach(function(t){seen[[t.date,t.symbol,t.shares,t.price].join('|')]=true});
  for(var i=0;i<lines.length;i++){
    var row=parseCSVRow(lines[i]);
    if(!headerFound){
      colMap={date:-1,sym:-1,qty:-1,price:-1,action:-1};
      for(var ci=0;ci<row.length;ci++){
        var h=row[ci].toLowerCase();
        if(h.indexOf('date')>=0||h==='日期')colMap.date=ci;
        if(h.indexOf('symbol')>=0||h.indexOf('ticker')>=0||h==='代码'||h==='标的')colMap.sym=ci;
        if(h.indexOf('action')>=0||h.indexOf('description')>=0||h==='方向')colMap.action=ci;
        if(h.indexOf('quantity')>=0||h.indexOf('shares')>=0||h.indexOf('数量')>=0||h.indexOf('qty')>=0)colMap.qty=ci;
        if(h.indexOf('price')>=0||h==='价格'||h==='成交价')colMap.price=ci;
      }
      if(colMap.date>=0&&colMap.sym>=0&&colMap.qty>=0&&colMap.price>=0){headerFound=true;continue}
      continue;
    }
    var date=normalizeDateValue(row[colMap.date]),sym=cleanText(row[colMap.sym],12).toUpperCase();
    var qty=Math.abs(parseMoneyValue(row[colMap.qty])),price=parseMoneyValue(row[colMap.price]);
    var action=colMap.action>=0?cleanText(row[colMap.action],80).toLowerCase():'';
    if(!date||!ETF_SYMS.includes(sym)||qty<=0||price<=0)continue;
    var isSell=action.indexOf('sell')>=0||action.indexOf('sold')>=0||action.indexOf('卖')>=0,shares=isSell?-qty:qty;
    var fingerprint=[date,sym,shares,price].join('|');if(seen[fingerprint])continue;seen[fingerprint]=true;
    trades.push({id:tradeIdCounter++,symbol:sym,date:date,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),shares:shares,price:price,type:isSell?'sell':'buy'});
    imported++;
  }
  if(!headerFound)throw new Error('未找到 Date、Symbol、Quantity、Price 列');
  return imported;
}







function doCSVImport(file){



  var reader=new FileReader();



  reader.onload=function(){



    try{



      var imported=parseSchwabCSV(reader.result);



      if(imported>0){



        trades.sort(function(a,b){return String(a.date).localeCompare(String(b.date))});



        saveTrades();initTradeIds();updatePortfolio();updateSidebar();updateSidebarPrices();



        showToast('已导入 '+imported+' 笔交易','ok');



      }else showToast('未识别有效交易，需 Schwab CSV 格式','err');



    }catch(e){showToast('解析失败: '+e.message,'err')}



  };



  reader.readAsText(file);



}







// Drag & drop



(function(){



  var overlay=document.getElementById('dropOverlay');



  var dragCount=0;



  document.body.addEventListener('dragenter',function(e){e.preventDefault();dragCount++;if(overlay)overlay.classList.add('show')});



  document.body.addEventListener('dragleave',function(e){dragCount--;if(dragCount<=0&&overlay)overlay.classList.remove('show')});



  document.body.addEventListener('dragover',function(e){e.preventDefault()});



  document.body.addEventListener('drop',function(e){e.preventDefault();dragCount=0;if(overlay)overlay.classList.remove('show');



    var f=e.dataTransfer.files[0];if(f&&f.name.endsWith('.csv'))doCSVImport(f);else if(f)showToast('仅支持 .csv 文件','err')});



/* ===== 初始化 & 事件绑定 ===== */



})();








/* === Covered Call === */
var optionTrades=[];
function loadOpt(){try{var raw=JSON.parse(localStorage.getItem("wealth_options_v2")||"[]"),opts=normalizeOptions(raw);if(stableStr(raw)!==stableStr(opts))localStorage.setItem("wealth_options_v2",JSON.stringify(opts));return opts}catch(e){return[]}}
function saveOpt(){optionTrades=normalizeOptions(optionTrades);localStorage.setItem("wealth_options_v2",JSON.stringify(optionTrades));markDirty('optionTrades');autoPushDebounce()}
optionTrades=loadOpt();
function updateAllO(){if(!trades||!trades.forEach||!livePrices)return;var nowInstant=new Date();optionTrades=loadOpt();var vsh=0,ssh=0;trades.forEach(function(t){if(t.symbol==="VGT")vsh+=t.shares;if(t.symbol==="SMH")ssh+=t.shares});var vVGTcalls=optionTrades.filter(function(o){return o.sym==="VGT"&&o.type==="CALL"&&isActiveOption(o,nowInstant)}).reduce(function(s,o){return s+(o.contracts||1)},0);var vSMHcalls=optionTrades.filter(function(o){return o.sym==="SMH"&&o.type==="CALL"&&isActiveOption(o,nowInstant)}).reduce(function(s,o){return s+(o.contracts||1)},0);var vc=document.getElementById("ov");if(vc)vc.textContent=vsh+" 股";var cv=document.getElementById("ocv");if(cv){cv.textContent="可卖 "+Math.max(0,Math.floor(vsh/100)-vVGTcalls)+" 张CALL"}var vd=document.getElementById("vd");if(vd)vd.textContent=ssh+" 股";var cs=document.getElementById("ocs");if(cs){cs.textContent="可卖 "+Math.max(0,Math.floor(ssh/100)-vSMHcalls)+" 张CALL"}var re=document.getElementById("ore");if(re){var thisM=marketDate(nowInstant).slice(0,7);optionTrades=loadOpt();var m=optionTrades.filter(function(o){return o.added&&o.added.slice(0,7)===thisM}).reduce(function(s,o){return s+(o.premium||0)*(o.contracts||1)},0);re.textContent=fmtFull(m)}renderOpt();updatePnLOpt();updateOptStatus();}var showArchivedOpt=false;function renderOpt(){
var el=document.getElementById("holdingsBody");if(!el)return;
optionTrades=loadOpt();var nowInstant=new Date();
if(!optionTrades.length){el.innerHTML='<tr><td colspan="8" style="padding:12px 0">'+emptyStateHTML({title:'暂无期权持仓',hint:'录入一笔 Covered Call 后会显示在这里',compact:true})+'</td></tr>';return}
var archivedCount=optionTrades.filter(function(o){return o.archived}).length;
var visible=showArchivedOpt?optionTrades.slice():optionTrades.filter(function(o){return !o.archived});
if(!visible.length&&archivedCount>0){showArchivedOpt=true;visible=optionTrades.slice()}
var sorted=visible.sort(function(a,b){if(!a.settled&&b.settled)return -1;if(a.settled&&!b.settled)return 1;var ae=a.expiry||'9999',be=b.expiry||'9999';if(ae!==be)return ae.localeCompare(be);return a.type==='CALL'?-1:1});
var rows=sorted.map(function(o){var i=optionTrades.indexOf(o);var oid=o.id;
var exp=o.expiry||"",expiryState=optionExpiryState(exp,nowInstant),isExpired=expiryState.expired,daysLeft=expiryState.days,cp=livePrices[o.sym]||0,status="";
if(o.archived){status="<span style=color:var(--muted)>已归档</span>";isExpired=true}else if(o.settled){status="<span style=color:var(--muted)>已结算</span>";isExpired=true}else if(isExpired){status="<span style=color:var(--muted)>已过期</span>"}else{var itm=o.type==="CALL"&&cp>o.strike;status=itm?"<span style=color:var(--blue)>临近行权 "+daysLeft+"d</span>":"<span style=color:var(--accent)>"+daysLeft+"d</span>"}
return "<tr style="+(isExpired?"opacity:.4":"")+"><td><b>"+o.sym+"</b></td><td style=color:"+(o.type==="CALL"?"var(--accent)":"var(--orange)")+">"+o.type+"</td><td>$"+o.strike.toFixed(2)+"</td><td>"+fmtFull(o.premium||0)+"</td><td>"+(o.contracts||1)+"张</td><td style=color:var(--muted)>"+exp+"</td><td>"+status+"</td><td><span class=opt-actions><button onclick=delOpt(\x27"+oid+"\x27) style=font-size:.7rem;padding:2px 6px;border:1px solid var(--muted);color:var(--muted);border-radius:3px;background:none;cursor:pointer>"+(o.archived?"恢复":o.settled?"归档":"X")+"</button>"+(o.type==="CALL"&&!isExpired&&!o.settled?"<button onclick=assignOpt(\x27"+oid+"\x27) style=font-size:.7rem;padding:4px 10px;border:1px solid var(--accent);color:var(--accent);border-radius:4px;background:none;cursor:pointer>行权</button>":"")+(!o.settled&&isExpired?"<button onclick=settleOpt(\x27"+oid+"\x27) style=font-size:.7rem;padding:4px 10px;border:1px solid var(--muted);color:var(--muted);border-radius:4px;background:none;cursor:pointer>结算</button>":"")+"</span></td></tr>"
;}).join("");
if(archivedCount>0){rows+="<tr><td colspan=8 style=text-align:center;padding:4px><button onclick='showArchivedOpt=!showArchivedOpt;renderOpt()' style='font-size:.7rem;padding:3px 10px;border:1px solid var(--muted);color:var(--muted);border-radius:4px;background:none;cursor:pointer'>"+(showArchivedOpt?"📁 隐藏已归档":"📁 显示已归档 "+archivedCount+" 个")+"</button></td></tr>"}el.innerHTML=rows}
function showBusyToast(msg){
  var t=document.getElementById('syncToast');
  if(!t)return;
  clearTimeout(t._timer);
  t.onclick=null;
  t.style.pointerEvents='auto';
  t.className='sync-toast busy show';
  t.innerHTML='<span class="ds-spinner" aria-hidden="true"></span><span></span>';
  t.lastElementChild.textContent=msg;
}

function showApproval(opts){
  var o=opts||{};
  var existing=document.getElementById('approvalModal');
  if(existing)existing.remove();
  var modal=document.createElement('div');
  modal.id='approvalModal';
  modal.className='ds-approval';
  modal.innerHTML='<div class="ds-approval-card" role="dialog" aria-modal="true" aria-labelledby="approvalTitle"><div class="ds-approval-body"><strong class="ds-approval-title" id="approvalTitle"></strong><p class="ds-approval-text"></p></div><div class="ds-approval-actions"><button type="button" class="ds-approval-btn" data-act="cancel"></button><button type="button" class="ds-approval-btn ds-approval-danger" data-act="ok"></button></div></div>';
  modal.querySelector('.ds-approval-title').textContent=o.title||'请确认';
  modal.querySelector('.ds-approval-text').textContent=o.message||'';
  var cancelBtn=modal.querySelector('[data-act="cancel"]'),okBtn=modal.querySelector('[data-act="ok"]');
  cancelBtn.textContent=o.cancelText||'取消';
  okBtn.textContent=o.confirmText||'确认';
  if(o.danger===false)okBtn.className='ds-approval-btn';
  var closed=false;
  function close(){
    if(closed)return;
    closed=true;
    modal.classList.remove('show');
    if(modal.parentNode)modal.parentNode.removeChild(modal);
    document.removeEventListener('keydown',onKey);
  }
  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();close()}
  }
  cancelBtn.addEventListener('click',close);
  okBtn.addEventListener('click',function(){close();if(typeof o.onConfirm==='function')o.onConfirm()});
  modal.addEventListener('click',function(e){if(e.target===modal)close()});
  document.addEventListener('keydown',onKey);
  document.body.appendChild(modal);
  requestAnimationFrame(function(){modal.classList.add('show')});
  cancelBtn.focus();
  return modal;
}

var dsSearchQuery="";
function applyTableSearch(){
  var q=dsSearchQuery.trim().toLowerCase(),total=0,matched=0;
  ["holdBody","tradeBody","cashLogBody"].forEach(function(id){
    var tb=document.getElementById(id);
    if(!tb)return;
    [].forEach.call(tb.querySelectorAll("tr"),function(tr){
      if(tr.querySelector(".table-empty")||tr.querySelector(".ds-empty"))return;
      total++;
      var hit=!q||tr.textContent.toLowerCase().indexOf(q)>=0;
      tr.style.display=hit?"":"none";
      if(hit)matched++;
    });
  });
  var counter=document.getElementById("dsSearchCount");
  if(counter)counter.textContent=q?(matched+" 条"):"";
  var clearBtn=document.getElementById("dsSearchClear");
  if(clearBtn)clearBtn.hidden=!q;
}
function initTableSearch(){
  var input=document.getElementById("dsSearchInput");
  if(!input)return;
  var timer=null;
  input.addEventListener("input",function(){clearTimeout(timer);var v=input.value;timer=setTimeout(function(){dsSearchQuery=v;applyTableSearch()},120)});
  input.addEventListener("keydown",function(e){if(e.key==="Escape"){input.value="";dsSearchQuery="";applyTableSearch()}});
  var clearBtn=document.getElementById("dsSearchClear");
  if(clearBtn)clearBtn.addEventListener("click",function(){input.value="";dsSearchQuery="";applyTableSearch();input.focus()});
  ["holdBody","tradeBody","cashLogBody"].forEach(function(id){
    var tb=document.getElementById(id);
    if(tb&&window.MutationObserver)new MutationObserver(function(){applyTableSearch()}).observe(tb,{childList:true});
  });
  applyTableSearch();
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initTableSearch)}else{initTableSearch()}

var RECORD_SEG_KEY="wealth_records_segment_v1";
function setRecordSegment(seg,persist){
  var groups=document.querySelectorAll(".record-group");
  if(!groups.length)return;
  [].forEach.call(groups,function(g){g.classList.toggle("active",g.getAttribute("data-group")===seg)});
  [].forEach.call(document.querySelectorAll("#recordSeg .record-seg"),function(b){
    var on=b.getAttribute("data-seg")===seg;
    b.classList.toggle("active",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
  if(persist!==false){try{localStorage.setItem(RECORD_SEG_KEY,seg)}catch(e){}}
}
function initRecordSegment(){
  var seg=document.getElementById("recordSeg");
  if(!seg)return;
  seg.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest(".record-seg"):null;
    if(!b)return;
    setRecordSegment(b.getAttribute("data-seg"));
  });
  var saved="data";
  try{saved=localStorage.getItem(RECORD_SEG_KEY)||"data"}catch(e){}
  setRecordSegment(saved,false);
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initRecordSegment)}else{initRecordSegment()}

function emptyStateHTML(opts){
  var o=opts||{};
  var icon=o.icon||'<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><path d="m4 7 8 6 8-6"/></svg>';
  var cls='ds-empty'+(o.compact?' ds-empty-compact':'');
  var esc=function(s){return String(s).replace(/[<>&]/g,function(c){return c==='<'?'&lt;':c==='>'?'&gt;':'&amp;'})};
  var html='<div class="'+cls+'" role="status"><span class="ds-empty-icon" aria-hidden="true">'+icon+'</span>';
  html+='<span class="ds-empty-title">'+esc(o.title||'暂无数据')+'</span>';
  if(o.hint)html+='<span class="ds-empty-hint">'+esc(o.hint)+'</span>';
  return html+'</div>';
}

function updatePnLOpt(){
var nowInstant=new Date(),now=marketDate(nowInstant),thisM=now.slice(0,7);
optionTrades=loadOpt();
var total=optionTrades.reduce(function(s,o){return s+(o.premium||0)*(o.contracts||1)},0);
var month=optionTrades.filter(function(o){return o.added&&o.added.slice(0,7)===thisM}).reduce(function(s,o){return s+(o.premium||0)*(o.contracts||1)},0);
var me=document.getElementById("mrev"),te=document.getElementById("trev");
if(me)me.textContent=fmtFull(month);if(te)te.textContent=fmtFull(total);var active=optionTrades.filter(function(o){return isActiveOption(o,nowInstant)}),cc=document.getElementById('ccMonthly'),cs=document.getElementById('ccSub'),ca=document.getElementById('ccActive'),cn=document.getElementById('ccNearest');if(cc)cc.textContent=fmtFull(month);if(cs)cs.textContent=optionTrades.filter(function(o){return o.type==='CALL'&&o.added&&o.added.slice(0,7)===thisM}).reduce(function(s,o){return s+(o.contracts||1)},0)+' 张 CALL · 复投核心仓';if(ca)ca.textContent=String(active.length);if(cn){active.sort(function(a,b){return a.expiry.localeCompare(b.expiry)});cn.textContent=active.length?'最近 '+active[0].expiry.slice(5)+' · '+active[0].sym+' $'+active[0].strike.toFixed(0):'暂无待到期期权'}
}
function updateOptStatus(){var el=document.getElementById("optStatus");if(!el)return;var nowInstant=new Date();optionTrades=loadOpt();var active=optionTrades.filter(function(o){return isActiveOption(o,nowInstant)});if(!active.length){el.innerHTML="无活跃持仓";return}el.innerHTML=active.map(function(o){var d=optionExpiryState(o.expiry,nowInstant).days;var cp=livePrices[o.sym]||0;var itm=o.type==="CALL"&&cp>o.strike;var icon=itm?"🔵":"🟢";var txt=itm?"临近行权":"虚值";return "<div style=display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--rule)><span>"+icon+"</span><div style=flex:1><b>"+o.sym+"</b> "+o.type+" @$"+o.strike.toFixed(0)+" x"+(o.contracts||1)+"</div><div style=font-size:.7rem;color:"+(itm?"var(--blue)":"var(--accent)")+">"+txt+" · "+d+"天</div></div>";}).join("");}function delOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o)return;if(o.archived){o.archived=false;saveOpt();updateAllO();showToast("已恢复 "+o.sym+" @$"+o.strike.toFixed(2),"ok");return}if(o.settled){o.archived=true;saveOpt();updateAllO();showToast("已归档 "+o.sym+" @$"+o.strike.toFixed(2)+" · 权利金统计保留","ok");return}var pb=(o.premium||0)*(o.contracts||1);if(pb>0){cashBalance-=pb;saveCash();cashLog.push({id:Date.now(),date:marketDate(),time:marketClock(),type:"权利金退回-"+o.sym,amount:pb});saveCashLog();addActivity("删除期权 "+o.sym+" 退回权利金 "+fmtFull(pb))}optionTrades.splice(i,1);saveOpt();updateAllO();showToast("已删除 "+o.sym+" @$"+o.strike.toFixed(2)+",退回 "+fmtFull(pb),"ok")}function assignOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o||o.type!=="CALL")return;var contracts=o.contracts||1;var need=contracts*100;var held=0;trades.forEach(function(t){if(t.symbol===o.sym)held+=t.shares});if(need>held){alert("持仓不足！\n持有："+held.toFixed(0)+"股\n行权需要："+need+"股");return}var msg="将以 $"+o.strike.toFixed(2)+" 卖出 "+contracts+"张CALL对应的 "+(contracts*100)+" 股 "+o.sym+"\n\n权利金已在卖CALL时入账，无需重复记录。";if(!confirm(msg))return;trades.push({id:tradeIdCounter++,symbol:o.sym,date:marketDate(),time:marketClock(),shares:-(contracts*100),price:o.strike,tag:'assign'});saveTrades();initTradeIds();o.settled=true;saveOpt();updateAllO();updatePortfolio();updateSidebar();updateSidebarPrices();updateTradeList();addActivity('CALL行权 '+o.sym+'×'+contracts+'张 @$'+o.strike.toFixed(2));showToast("已标记行权: "+o.sym+" @$"+o.strike.toFixed(2)+" x"+contracts,"ok")}function settleOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o)return;if(!confirm("确认到期结算 "+o.sym+" "+o.type+" @$"+o.strike.toFixed(2)+" x"+(o.contracts||1)+"张?\n\n权利金已在卖CALL时入账，到期未行权无需其他操作。"))return;o.settled=true;saveOpt();updateAllO();addActivity('CALL到期 '+o.sym+'×'+(o.contracts||1)+'张 @$'+o.strike.toFixed(2));showToast("已到期结算: "+o.sym,"ok")}
document.getElementById("btnAddOption").addEventListener("click",function(){
var t=document.getElementById("otype").value;
var s=document.getElementById("osym").value;
var k=parseFloat(document.getElementById("ostrike").value||0);
var p=parseFloat(document.getElementById("opremium").value||0);
var e=document.getElementById("oexpiry").value;
var c=parseInt(document.getElementById("ocontracts").value||1);
if(!t||!s||!k||!e||k<=0||isNaN(p)||p<0)return;if(isNaN(c)||c<1)c=1;
var premiumTotal=p*(c||1);var optObj={id:Date.now(),sym:s,type:t,strike:k,premium:p,expiry:e,contracts:c,added:marketDate()};optionTrades.push(optObj);addActivity('卖'+t+'开仓 '+s+'×'+c+'张 @$'+k+' 💰$'+p);
cashBalance+=premiumTotal;saveCash();cashLog.push({id:Date.now(),date:marketDate(),time:marketClock(),type:"权利金+"+s,amount:premiumTotal});saveCashLog();saveOpt();updateSidebar();document.getElementById("ostrike").value="";document.getElementById("opremium").value="";updateAllO();
var cc=document.getElementById("ccMonthly"),cs=document.getElementById("ccSub");
if(cc&&cs){var nw=marketDate(),tm=nw.slice(0,7),ccTotal=0,ccCount=0;
optionTrades.forEach(function(o){if(o.type==="CALL"&&o.added&&o.added.slice(0,7)===tm){ccTotal+=(o.premium||0)*(o.contracts||1);ccCount++}});
cc.textContent=fmtFull(ccTotal);cs.textContent=ccCount+" 张CALL · 复投核心仓"}
});
var __us=updateSidebar;updateSidebar=function(){__us();
var sh=document.getElementById("sbOptHoldings");
if(sh&&typeof optionTrades!=="undefined"){
var nowInstant=new Date();
var ac=optionTrades.filter(function(o){return isActiveOption(o,nowInstant)});
if(!ac.length){sh.innerHTML=emptyStateHTML({title:'暂无期权持仓',compact:true})}
else{sh.innerHTML=ac.map(function(o){var d=optionExpiryState(o.expiry,nowInstant).days;return '<div class="sb-option-line"><span><b>'+escapeHtml(o.sym)+'</b> '+escapeHtml(o.type)+' $'+Number(o.strike||0).toFixed(0)+' ×'+(o.contracts||1)+'</span><strong>'+d+'天</strong></div>'}).join("")}
}
};
try{document.getElementById("hmCorrect").addEventListener("click",function(){var v=parseFloat(document.getElementById("hmCorrectAmt").value)||0;if(v===0)return;cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:v>0?"修正+":"修正-",amount:v});saveCashLog();document.getElementById("hmCorrectAmt").value="";addActivity("现金修正 "+fmtFull(v));updateSidebar();updateHoldCash();renderCashLog()})}catch(e){}
try{document.getElementById("hmDividend").addEventListener("click",function(){var s=document.getElementById("divSym").value;var v=parseFloat(document.getElementById("divAmt").value)||0;if(!s||v===0)return;cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:"股息+"+s,amount:v});saveCashLog();document.getElementById("divAmt").value="";addActivity("股息收入 "+s+" "+fmtFull(v));updateSidebar();updateHoldCash();renderCashLog()})}catch(e){}setTimeout(function(){if(typeof updateAllO==="function")updateAllO()},500);
function cashSigned(l){var t=l.type||'',a=l.amount||0;return (t==='出金'||t.indexOf('权利金退回')>=0)?-a:a}
function fetchYearStartPrice(sym,year){return fetch('/api/price?symbol='+encodeURIComponent(PRICE_SYMBOLS[sym]||sym)+'&range=max').then(function(r){return r.json()}).catch(function(){return null}).then(function(d){if(!d||!d.ok||!d.data||!d.data.chart||!d.data.chart.result||!d.data.chart.result[0])return null;var r=d.data.chart.result[0];var ts=r.timestamp||[];var cs=r.indicators.quote[0].close||[];var tgt=year+'-01-01';for(var i=0;i<ts.length;i++){var d2=marketDate(new Date(ts[i]*1000));if(d2>=tgt&&cs[i]!=null)return cs[i]}return cs[cs.length-1]||0}).catch(function(){return null})}
function fetchYearEndPrice(sym,year){return fetch('/api/price?symbol='+encodeURIComponent(PRICE_SYMBOLS[sym]||sym)+'&range=max').then(function(r){return r.json()}).catch(function(){return null}).then(function(d){if(!d||!d.ok||!d.data||!d.data.chart||!d.data.chart.result||!d.data.chart.result[0])return null;var r=d.data.chart.result[0];var ts=r.timestamp||[];var cs=r.indicators.quote[0].close||[];var tgt=year+'-12-31';var last=null;for(var i=0;i<ts.length;i++){var d2=marketDate(new Date(ts[i]*1000));if(d2>tgt)break;if(d2<=tgt&&cs[i]!=null)last=cs[i]}return last||cs[cs.length-1]||0}).catch(function(){return null})}
function calcAttribution(year){var yS=year+'-01-01',yE=year+'-12-31';var ss={},es={},ac={};ETF_SYMS.forEach(function(s){ss[s]=0;es[s]=0;ac[s]=0});var sSell=0,sBuy=0,eSell=0,eBuy=0;trades.forEach(function(t){if(t.date<=yE&&es[t.symbol]!==undefined)es[t.symbol]+=t.shares;if(t.date<yS&&ss[t.symbol]!==undefined)ss[t.symbol]+=t.shares;if(t.date>=yS&&t.date<=yE&&t.shares>0&&ac[t.symbol]!==undefined)ac[t.symbol]+=t.shares*t.price;if(t.date<yS){var a=Math.abs(t.shares)*t.price;if(t.shares<0)sSell+=a;else sBuy+=a}if(t.date<=yE){var ea=Math.abs(t.shares)*t.price;if(t.shares<0)eSell+=ea;else eBuy+=ea}});var sCash=0,eCash=0,ccP=0,div=0,nd=0;cashLog.forEach(function(l){if(l.date<yS)sCash+=cashSigned(l);if(l.date<=yE)eCash+=cashSigned(l);if(l.date>=yS&&l.date<=yE){if(l.type&&l.type.indexOf('入金')>=0)nd+=l.amount||0;if(l.type&&l.type.indexOf('出金')>=0)nd-=Math.abs(l.amount||0);if(l.type&&l.type.indexOf('股息')>=0)div+=l.amount||0}});optionTrades.forEach(function(o){if(o.added&&o.added.slice(0,4)===year)ccP+=(o.premium||0)*(o.contracts||1)});Promise.all(ETF_SYMS.map(function(s){return Promise.all([fetchYearStartPrice(s,year),fetchYearEndPrice(s,year)])})).then(function(pairs){var ps={},pe={};var _unavail=false;ETF_SYMS.forEach(function(s,i){ps[s]=pairs[i][0];pe[s]=pairs[i][1];if(ps[s]===null||pe[s]===null)_unavail=true});var sA=0,eA=eCash+eSell-eBuy,cg={};ETF_SYMS.forEach(function(s){var sp=ps[s]||0,ep=pe[s]||0;sA+=ss[s]*sp;eA+=es[s]*ep;cg[s]=(es[s]*ep)-(ss[s]*sp)-ac[s]});sA+=sCash+sSell-sBuy;var tg=eA-sA-nd;var ot=tg-ETF_SYMS.reduce(function(s,sym){return s+cg[sym]},0)-ccP-div;renderAttribution({year:year,totalGain:tg,startAssets:sA,endAssets:eA,netDep:nd,capGains:cg,ccPrem:ccP,dividend:div,other:ot,unavail:_unavail})})}
function renderAttribution(r){var el=document.getElementById('attrSummary');if(el){el.innerHTML=(r.unavail?'<span style="color:var(--orange)">⚠️ 价格数据不可用，结果可能不准确</span><br>':'')+'<strong style="color:'+(r.totalGain>=0?'var(--accent)':'var(--red)')+'">总收益 '+fmtFull(r.totalGain)+'</strong>'}var ch=document.getElementById('attrChart');if(ch){var items=[{label:'VGT 增值',val:r.capGains.VGT},{label:'SMH 增值',val:r.capGains.SMH},{label:'BTC 增值',val:r.capGains.BTC},{label:'CC 权利金',val:r.ccPrem},{label:'股息',val:r.dividend},{label:'其他',val:r.other}];var mx=Math.max.apply(null,items.map(function(i){return Math.abs(i.val)}))||1;ch.innerHTML=items.map(function(it){var w=Math.abs(it.val)/mx*100;var pos=it.val>=0;return '<div class="attribution-row"><div class="attribution-row-head"><span>'+it.label+'</span><span class="'+(pos?'pos':'neg')+'">'+(pos?'+':'')+fmtFull(it.val)+(r.totalGain!==0?' '+(it.val/r.totalGain*100).toFixed(0)+'%':'')+'</span></div><div class="attribution-bar"><i style="width:'+w+'%;background:'+(pos?'var(--accent)':'var(--red)')+'"></i></div></div>'}).join('')}var det=document.getElementById('attrDetail');if(det){det.innerHTML='年初 '+fmtFull(r.startAssets)+' → 年末 '+fmtFull(r.endAssets)+' · 净入金 '+fmtFull(r.netDep)}}
try{var ay=document.getElementById('attrYear');if(ay){ay.addEventListener('change',function(){calcAttribution(this.value)});var cy=new Date().getFullYear();var ey=9999;cashLog.forEach(function(l){if(l.type&&l.type.indexOf('入金')>=0&&l.date){var y=parseInt(l.date.slice(0,4));if(y<ey)ey=y}});if(ey===9999){cashLog.forEach(function(l){if(l.date){var y=parseInt(l.date.slice(0,4));if(y<ey)ey=y}});trades.forEach(function(t){if(t.date){var y=parseInt(t.date.slice(0,4));if(y<ey)ey=y}})}if(ey===9999)ey=cy;var opts='';for(var y=cy;y>=ey;y--){opts+='<option value="'+y+'">'+y+'</option>'}ay.innerHTML=opts;ay.value=String(cy);setTimeout(function(){calcAttribution(String(cy))},2000)}}catch(e){}

var otmSettings={vgt:7,smh:5};
try{var s2=JSON.parse(localStorage.getItem("otmSettings"));if(s2)otmSettings=s2}catch(e){}
function updateOtm(){otmSettings.vgt=Number(otmSettings.vgt)||7;otmSettings.smh=Number(otmSettings.smh)||5;var vp=livePrices?livePrices.VGT||0:0;var sp=livePrices?livePrices.SMH||0:0;var v=document.getElementById("otmVgtVal");if(v)v.textContent=otmSettings.vgt+"%";var s=document.getElementById("otmSmhVal");if(s)s.textContent=otmSettings.smh+"%";var ve=document.getElementById("otmVgtStrike");if(ve&&vp>0)ve.textContent="$"+vp.toFixed(0)+" → $"+(vp*(1+otmSettings.vgt/100)).toFixed(0);var se=document.getElementById("otmSmhStrike");if(se&&sp>0)se.textContent="$"+sp.toFixed(0)+" → $"+(sp*(1+otmSettings.smh/100)).toFixed(0);}
function adjOtm(sym,dir){var key=sym==="VGT"?"vgt":"smh";otmSettings[key]=Number(otmSettings[key])||(key==='vgt'?7:5);var v2=otmSettings[key]+dir;if(v2<1)v2=1;if(v2>20)v2=20;otmSettings[key]=v2;localStorage.setItem("otmSettings",JSON.stringify(otmSettings));markDirty('otmSettings');updateOtm();autoPushDebounce();}
try{var ep=document.getElementById("otmVgtPlus");if(ep)ep.onclick=function(){adjOtm("VGT",1)};var em=document.getElementById("otmVgtMinus");if(em)em.onclick=function(){adjOtm("VGT",-1)};var sp2=document.getElementById("otmSmhPlus");if(sp2)sp2.onclick=function(){adjOtm("SMH",1)};var sm2=document.getElementById("otmSmhMinus");if(sm2)sm2.onclick=function(){adjOtm("SMH",-1)}}catch(e){}setTimeout(updateOtm,800);


function refreshTradeAffordability(){var sh=document.getElementById('tfShares'),pr=document.getElementById('tfPrice');if(!sh||!pr)return;var s=parseFloat(sh.value),p=parseFloat(pr.value);if(!s||!p||s<=0||p<=0){sh.style.borderColor='';sh.title='';return}var cost=s*p,avail=getNetCash();if(cost>avail){sh.style.borderColor='var(--red)';sh.title='需要 '+fmtFull(cost)+' ，可用 '+fmtFull(avail)}else{sh.style.borderColor='';sh.title=''}}
(function(){var sh=document.getElementById('tfShares'),pr=document.getElementById('tfPrice');if(sh)sh.addEventListener('input',refreshTradeAffordability);if(pr)pr.addEventListener('input',refreshTradeAffordability)})();
function qaToggle(){var s=document.getElementById('qaSheet');if(s.classList.contains('open'))qaClose();else s.classList.add('open')}
function qaClose(){document.getElementById('qaSheet').classList.remove('open')}
function qaDeposit(){qaClose();switchTab('data');setTimeout(function(){var e=document.getElementById('hmCashAmt');if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.focus()}},300)}
function qaBuy(){qaClose();switchTab('console');var t=document.getElementById('tfType');if(t)t.value='buy';syncTradeControls();setTimeout(function(){var e=document.getElementById('tfShares');if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.focus()}},300)}
function qaSell(){qaClose();switchTab('console');var t=document.getElementById('tfType');if(t)t.value='sell';syncTradeControls();setTimeout(function(){var e=document.getElementById('tfShares');if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.focus()}},300)}
function qaCall(){qaClose();switchTab('option');setTimeout(function(){var e=document.getElementById('ostrike');if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.focus()}},300)}

var ALERT_SEVERITY_SCORE={critical:4,high:3,medium:2,low:1};
function normalizeAlerts(alerts){var byId={};(alerts||[]).forEach(function(a){if(!a||!a.id)return;var current=byId[a.id],score=ALERT_SEVERITY_SCORE[a.severity]||0;if(!current||score>(ALERT_SEVERITY_SCORE[current.severity]||0))byId[a.id]=a});return Object.keys(byId).map(function(id){return byId[id]}).sort(function(a,b){return (ALERT_SEVERITY_SCORE[b.severity]||0)-(ALERT_SEVERITY_SCORE[a.severity]||0)||String(a.title).localeCompare(String(b.title),'zh-CN')})}
function renderAlertItem(a,icons){var icon=icons[a.type]||icons.blue;return '<div class="qa-alert-item qa-alert-'+a.type+'" data-alert-id="'+escapeHtml(a.id)+'" data-alert-severity="'+escapeHtml(a.severity)+'"><button type="button" class="qa-alert-main" data-alert-action="'+escapeHtml(a.action)+'"><span class="alert-leading"><i class="alert-icon">'+icon+'</i><span class="alert-copy"><strong>'+escapeHtml(a.title||'待办事项')+'</strong><small>'+escapeHtml(a.detail||'点击查看详情')+'</small></span></span><b aria-hidden="true">›</b></button></div>'}
function updateAlerts(){
var container=document.getElementById('qaAlerts'),mobile=document.getElementById('mobileAlerts'),meta=document.getElementById('mobileAlertMeta');
var alerts=[],nowInstant=new Date(),now=marketDate(nowInstant).slice(0,7),opts=loadOpt(),activeOpts=opts.filter(function(o){return isActiveOption(o,nowInstant)}),callGroups={};
activeOpts.filter(function(o){return o.type==='CALL'}).forEach(function(o){if(!callGroups[o.sym])callGroups[o.sym]=[];callGroups[o.sym].push(o)});
Object.keys(callGroups).sort(function(a,b){var order=['VGT','SMH','BTC'],ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b)}).forEach(function(sym){
var calls=callGroups[sym].slice().sort(function(a,b){return String(a.expiry).localeCompare(String(b.expiry))}),contracts=calls.reduce(function(sum,o){return sum+(Number(o.contracts)||1)},0),nearest=calls[0],days=optionExpiryState(nearest.expiry,nowInstant).days,cp=livePrices[sym]||0,closest=calls.slice().sort(function(a,b){return Math.abs(cp-a.strike)-Math.abs(cp-b.strike)})[0],type='blue',severity='medium',detail='覆盖 '+contracts*100+' 股 · 最近 '+nearest.expiry.slice(5)+' 到期';
if(cp>0&&closest&&cp>=closest.strike*0.98){type='red';severity='critical';detail='当前 $'+cp.toFixed(2)+' · 行权价 $'+closest.strike.toFixed(0)+' · 最近 '+closest.expiry.slice(5)}else if(days<=3&&days>=0){type='orange';severity='high';detail=days+'天后到期 · 行权价 $'+nearest.strike.toFixed(0)+' · 覆盖 '+contracts*100+' 股'}
alerts.push({id:'call:'+sym,type:type,severity:severity,title:sym+' 已卖 '+contracts+' 张 Call',detail:detail,action:'option'})
});
var monthBuys=trades.filter(function(t){return t.date.slice(0,7)===now&&t.shares>0}),buyTotal=monthBuys.reduce(function(s,t){return s+(t.price*Math.abs(t.shares))},0),dcaTarget=state.dcaOverride&&state.dcaOverride.month===now?state.dcaOverride.amount:state.monthlyDCA;
if(dcaTarget&&buyTotal<dcaTarget*0.9){var gap=dcaTarget-buyTotal;alerts.push({id:'dca:'+now,type:'accent',severity:'low',title:'本月定投还差 '+fmtFull(gap),detail:'完成后保持目标资产配比',action:'console'})}
var alertIcons={orange:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>',red:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v5M12 17.5v.5"/></svg>',accent:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/><path d="m14 10 6-6"/></svg>',blue:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 9 12l4 3 7-8"/><path d="M15 7h5v5"/></svg>'},normalized=normalizeAlerts(alerts),buttons=normalized.map(function(a){return renderAlertItem(a,alertIcons)}).join('');
if(container)container.innerHTML=normalized.length?'<div class="qa-alert-title"><span>待办事项 · 风险优先</span></div>'+buttons:'';
if(mobile)mobile.innerHTML=normalized.length?buttons:emptyStateHTML({title:'暂无待办',hint:'纪律执行正常，继续保持',compact:true});
if(meta)meta.textContent=normalized.length?normalized.length+'项 · 风险优先':'风险优先';
}
document.addEventListener('click',function(event){var target=event.target;if(!target||!target.closest)return;var action=target.closest('[data-alert-action]');if(action){qaClose();switchTab(action.getAttribute('data-alert-action'))}});

function updatePresentationMeta(){var dateEl=document.getElementById('desktopDate'),now=new Date(),cn=zonedDateParts(now,HOME_TIME_ZONE),ny=zonedDateParts(now,MARKET_TIME_ZONE),cnWeek={Sun:'星期日',Mon:'星期一',Tue:'星期二',Wed:'星期三',Thu:'星期四',Fri:'星期五',Sat:'星期六'};if(dateEl)dateEl.textContent='北京时间 '+Number(cn.month)+'月'+Number(cn.day)+'日 · '+cnWeek[cn.weekday]+' · '+cn.hour+':'+cn.minute;var mins=(Number(ny.hour)||0)*60+(Number(ny.minute)||0),weekday=['Mon','Tue','Wed','Thu','Fri'].indexOf(ny.weekday)>=0,isSession=weekday&&mins>=570&&mins<960,stateEl=document.getElementById('desktopMarketState'),stateWrap=stateEl&&stateEl.closest('.market-open');if(stateEl)stateEl.textContent='美东 '+ny.month+'/'+ny.day+' '+ny.hour+':'+ny.minute+' · '+(isSession?MARKET_SESSION_LABELS.open:MARKET_SESSION_LABELS.closed);if(stateWrap)stateWrap.classList.toggle('is-closed',!isSession)}
(function initPresentationMeta(){updatePresentationMeta();setInterval(updatePresentationMeta,60000);var labels={otype:'期权类型',osym:'期权标的',oexpiry:'期权到期日',ocontracts:'期权合约数量',divSym:'股息标的',tradeFilterSym:'交易标的筛选',cashFilter:'资金流水筛选',attrYear:'年度归因年份'};Object.keys(labels).forEach(function(id){var el=document.getElementById(id);if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',labels[id])})})();
