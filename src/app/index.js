import {safeNum, cleanText, fmtFull, fmtShares, fmtPnLFull, cashSigned, sparklinePath, dateOrdinal, logSwallowed, fetchWithTimeout, SYNC_TIMEOUT_MS} from './util.js';
import {computeHoldings, buildPositionRows, cashCorrectionPlan} from './calc.js';
import {KEYS, readRaw, writeRaw, removeKey, readJSON, writeJSON, isQuotaError, runMigrations, LS, setStorageNamespace, storageNamespace} from './store.js';
import {buildSyncPayload, classifySyncError, normalizeSyncTs, syncContentEqual, SYNC_FIELDS} from './sync.js';
import {escapeHtml, emptyStateHTML, renderAlertItem, alertSignature} from './render.js';
import {searchSymbols} from './symbols.js';
import {PLAN_DEFAULTS, WD_FIELDS, readPlan as readPlanOf, setPlanText, computeWithdrawal} from './plan.js';
import {normalizeOptions, isActiveOption, optionExpiryState, optionRowStatus, optionTotals, otmPercent, stepOtmPercent, suggestedStrike} from './options.js';
import {planAtOtm, optionProbabilities} from './prob.js';
import {renderProbNote, renderProbUnavailable, renderOtmProbLine, renderOtmExpiryChips, expiryCalendarHtml, fmtChainTimeShort, fmtProb} from './prob-view.js';
import {scheduleRow, complianceStreak, estimateNextExDiv, CC_RULES, weekdayOf} from './cc-schedule.js';
import {renderSchedule} from './cc-view.js';
import {SETTINGS_PANEL_IDS, SETTINGS_FOCUS_IDS, parseSyncConfig, syncHealthSummary} from './settings.js';
import {pushedKeysOf as pushedKeysList, pendingDirtyKeys, shouldSkipPush, planPullSync, planConflictHeal} from './sync-engine.js';
import {buildBackupPayload, planBackupImport} from './backup.js';
import {brandBadgeHTML} from './brand-mark.js';

/** 标的的"代表色"：持仓标的用资产色，其它（比如加密现货）用中性色。
    原先只写在观察列表那个 IIFE 里，搜索结果行够不着 —— 提到顶层共用。 */
/* 会话过期/未登录的自愈：任何 /api/* 回 401 就回登录页。
   必要性：门禁上线后，老设备本地没有会话 cookie —— App 壳子还能从 SW 缓存打开，
   但行情接口会 401。没有这段的话界面会"能开但没数据"，看着像坏了。 */
(function guardUnauthorized(){
  if(typeof window==='undefined'||window.__wtGuard)return;
  window.__wtGuard=true;
  var orig=window.fetch;
  window.fetch=function(input,init){
    var p=orig.apply(this,arguments);
    try{
      var u=String(typeof input==='string'?input:(input&&input.url)||'');
      if(u.indexOf('/api/')>=0&&u.indexOf('/api/login')<0){
        p.then(function(res){if(res&&res.status===401)location.replace('/login')},function(){});
      }
    }catch(e){logSwallowed("guardUnauthorized",e)}
    return p;
  };
})();
/* ===== 多用户：本地存储按账号分区 =====
   必须在任何 localStorage 读写之前执行，所以放在模块体最前面（只依赖同步读 cookie）。 */
(function initStorageNamespace(){
  try{
    var m=document.cookie.match(/(?:^|;\s*)wt_uid=(\d+)/);
    setStorageNamespace(m?m[1]:'');
    /* 老版本的无前缀数据属于"主账号"(user 1)：只搬一次，且只搬到 u1，
       别的账号在这台设备上登录时不会继承到主人的本机数据。 */
    if(!localStorage.getItem('wealth_ns_migrated_v1')){
      var legacy=[],i;
      for(i=0;i<localStorage.length;i+=1){var k=localStorage.key(i);if(k&&k.indexOf('wealth_')===0)legacy.push(k)}
      if(m&&m[1]==='1'){for(i=0;i<legacy.length;i+=1){var v=localStorage.getItem(legacy[i]);if(v!=null&&localStorage.getItem('u1:'+legacy[i])==null)localStorage.setItem('u1:'+legacy[i],v)}}
      localStorage.setItem('wealth_ns_migrated_v1','1');
    }
  }catch(e){logSwallowed("initStorageNamespace",e)}
})();
function symColor(sym){
  if(String(sym)==='BTC')return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  return getAssetColor(WATCH_HELD_OF[sym]||sym);
}
import {buildAlerts, renderAlerts, getCurrentAlerts, markAlertsSeen, updateBellBadge, loadOptPing, saveOptPing} from './alerts-view.js';
import {formatHealthTime, renderSyncHealthView, applySyncBar, syncClockText as syncClockTime, syncFailureText, SYNC_KEY_LABELS, openConflictModal, syncBannerView, applySyncBanner, bindSyncBanner, bindHealthJump} from './sync-view.js';
import {configureWatchUI, paintWatchSort, renderWatch, renderWatchManage, renderHoldings, initWatchUI, updateSidebarPrices, capCellHTML, updateCapCells} from './watch-ui.js';
import {configurePortfolioView, renderMetricsTop, renderMetricsPnl, renderHoldingsBody, renderGoalProgress, renderDrawdownPanel, renderPricePills, renderCashTotals} from './portfolio-view.js';
import {configureSettingsView, bindShellControls, bindSettingsPanel, bindHaptics, haptic, loadAccent, loadTheme, toggleTheme, togglePrivacy, openMobileSettings, openAdvancedSettings, setMobileSettings} from './settings-view.js';
import {portfolioTotals, dailyChange, goalProgress, drawdownLine, summaryRows} from './portfolio.js';
import {disciplineMonths, annualMatrix, heatColorFor, donutSlices} from './charts.js';
import {CRYPTO_NAMES, FALLBACK_NAMES, cleanName as cleanNameOf, quotePrice, historyOf, hi52Of, searchRowPrice, pricePillHTML} from './watch-view.js';
import {TRADE_SYMBOLS, normalizeTrades as normalizeTradesIn, normalizeCashLogs as normalizeCashLogsIn, normalizeActivities as normalizeActivitiesIn, parseSchwabCSV as parseSchwabCSVIn, parseCSVRow, parseMoneyValue, csvSkipSummary} from './records-import.js';
import {HOME_TIME_ZONE, MARKET_TIME_ZONE, MARKET_SESSION_LABELS, zonedDateParts, zonedDate, marketDate, marketClock, localDate, normalizeDateValue} from './time.js';
import {selectTrades, buildTradeRows, selectCashLogs, buildCashLogRows, cashTotals, dataPageTotals, matchRowText, searchCountText} from './rows.js';
import {normalizeWatchlist, toggleWatch, addWatch, removeWatch, moveWatch, toWatchRows, toHoldingRows, collectQuoteSymbols, toExposureRows, WATCH_DEFAULTS, WATCH_HELD_OF, resolveHeldSymbol, mergeWatchlist, splitByHolding} from './watch.js';
var LSKEY=KEYS.dashboard,PRICE_KEY=KEYS.prices,TRADE_KEY=KEYS.trades,CB_KEY=KEYS.cash,CLOG_KEY=KEYS.cashLog;var cashBalance=0,cashLog=[];


var state={monthlyDCA:2000,roadmapStart:'2025-01',roadmapAge:27,targetGoal:2500000,sgovTarget:0,vgt:0.50,smh:0.30,btc:0.20};


var trades=[],livePrices={},liveChanges={},liveSources={},liveQuoteData={},tradeIdCounter=0;

var APP_BUILD='v334';var APP_DATA_VERSION=5;
var PRICE_SYMBOLS={VGT:'VGT',SMH:'SMH',BTC:'BTC'};


function normalizeTrades(list){return normalizeTradesIn(list,ETF_SYMS)}
function normalizeCashLogs(list){return normalizeCashLogsIn(list)}
function normalizeActivities(list){return normalizeActivitiesIn(list)}

function createBackupData(){return buildBackupPayload({appDataVersion:APP_DATA_VERSION,date:new Date().toISOString(),state:normalizeState(state),trades:trades,cashBalance:safeNum(cashBalance),cashLog:cashLog,activities:normalizeActivities(JSON.parse(readRaw(ACTIVITY_KEY)||'[]')),optionTrades:normalizeOptions(JSON.parse(readRaw('wealth_options_v2')||'[]')),otmSettings:JSON.parse(readRaw('otmSettings')||'{"vgt":7,"smh":5}'),exitPortfolio:readRaw('exit_portfolio')||'',watchlist:normalizeWatchlist(watchList),prices:JSON.parse(readRaw(PRICE_KEY)||'{}'),theme:document.documentElement.dataset.theme||'light',accent:document.documentElement.dataset.accent||'forest'})}





/* ===== 格式化工具 ===== */





function chinaDate(d){return zonedDate(d,HOME_TIME_ZONE)}







function fmt$(n){n=safeNum(n);if(Math.abs(n)>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(Math.abs(n)>=1e3)return'$'+(n/1e3).toFixed(0)+'K';return'$'+n.toLocaleString('en-US',{maximumFractionDigits:0})}



function getNetCash(){var ts=0,tb=0;trades.forEach(function(t){var a=Math.abs(t.shares)*t.price;if(t.shares<0)ts+=a;else tb+=a});return cashBalance+ts-tb}
function animateVal(el,to){if(!el)return;var from=parseFloat(el.dataset.v||"0")||0;el.dataset.v=to;var start=Date.now(),dur=500;function step(){var t=Math.min(1,(Date.now()-start)/dur);var v=from+(to-from)*(1-Math.pow(1-t,3));el.textContent=fmtFull(v);if(t<1)requestAnimationFrame(step)}step()}


function fmtPct(n){if(isNaN(n)||!isFinite(n))return'-';return(n*100).toFixed(1)+'%'}


var ETF_NAMES={VGT:'VGT',SMH:'SMH',BTC:'BTC ETF',SGOV:'SGOV'},ETF_SYMS=TRADE_SYMBOLS,ALL_SYMS=TRADE_SYMBOLS;




function getAssetColor(sym){var css=getComputedStyle(document.documentElement),map={VGT:css.getPropertyValue('--violet').trim(),SMH:css.getPropertyValue('--blue').trim(),BTC:css.getPropertyValue('--orange').trim()};return map[sym]||css.getPropertyValue('--muted').trim()}






function updateSidebar(){


  var holdings={},totalV=0,hasAny=false,slices=[];


  for(var i=0;i<trades.length;i++){var t=trades[i],sym=t.symbol;if(!holdings[sym])holdings[sym]={shares:0};holdings[sym].shares+=Number(t.shares)}


  for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var v=h.shares*(livePrices[sym]||0);if(v>0){slices.push({sym:sym,value:v});totalV+=v;hasAny=true}}


  var nc=getNetCash();animateVal(document.getElementById('sbValue'),hasAny?totalV+nc:nc);document.getElementById('sbHoldVal').textContent=fmtFull(totalV);document.getElementById('sbCashVal').textContent=fmtFull(nc);




  var dcaEl=document.getElementById('sbDCACalendar');if(dcaEl){var buyTrades=trades.filter(function(t){return t.shares>0});var months=new Set();buyTrades.forEach(function(t){months.add(t.date.slice(0,7))});var n=months.size+1,marketYM=marketDate(),marketYear=Number(marketYM.slice(0,4)),marketMonth=Number(marketYM.slice(5,7)),nextYear=marketMonth===12?marketYear+1:marketYear,nextMonth=marketMonth===12?1:marketMonth+1;dcaEl.textContent='下次定投 '+nextYear+'年'+nextMonth+'月 · 第'+n+'次'}


  


  updateMobStatusBar();}





/* ===== 价格获取 & 缓存 ===== */


function readPriceCache(){var value=readJSON(PRICE_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
var cachePrice=function(symbol,data){var c=readPriceCache();c[symbol]=data;if(!writeJSON(PRICE_KEY,c))console.warn('cachePrice failed')}


var priceReq={};
async function fetchPriceImpl(symbol){var cached=readPriceCache(),quoteSymbol=PRICE_SYMBOLS[symbol]||symbol;try{var r=await fetchWithTimeout('/api/price?symbol='+encodeURIComponent(quoteSymbol)+'&range=1mo');if(r.ok){var j=await r.json(),result=j.ok&&j.data&&j.data.chart&&j.data.chart.result&&j.data.chart.result[0],m=result&&result.meta,quote=result&&result.indicators&&result.indicators.quote&&result.indicators.quote[0],history=quote&&Array.isArray(quote.close)?quote.close.map(Number).filter(function(v){return isFinite(v)&&v>0}).slice(-20):[];if(m&&m.regularMarketPrice>0){var prevClose=Number(m.previousClose);if(!(prevClose>0))prevClose=history.length>1?history[history.length-2]:m.regularMarketPrice;return{price:m.regularMarketPrice,prevClose:prevClose,change:m.regularMarketPrice-prevClose,hi52:m.fiftyTwoWeekHigh||0,history:history,historyRange:'1mo',source:'yahoo',time:Date.now()}}}}catch(e){console.log('Yahoo error',symbol,e)}try{var r2=await fetchWithTimeout('https://qt.gtimg.cn/q=us'+symbol.toUpperCase());if(r2.ok){var t=await r2.text();var m2=t.match(/"([^"]+)"/);if(m2){var p=m2[1].split('~'),pr=parseFloat(p[3]),prev=parseFloat(p[4]),hi52=parseFloat(p[48]);if(pr>0)return{price:pr,prevClose:prev,change:pr-prev,hi52:hi52||0,history:cached[symbol]&&cached[symbol].history||[],historyRange:cached[symbol]&&cached[symbol].historyRange||'',source:'tencent',time:Date.now()}}}}catch(e2){console.log('Tencent error',symbol,e2)}if(cached[symbol])return Object.assign({},cached[symbol],{source:'缓存',time:cached[symbol].time||cached[symbol].ts});return null}


function pricePill(sym,price,change,source){return pricePillHTML(sym,price,change,source)}
/* v311：同一个标的的并发取价合成一次请求（启动时 refreshPrices 会被调到两次） */function fetchPrice(symbol){var k=String(symbol);if(priceReq[k])return priceReq[k];var p=fetchPriceImpl(symbol);priceReq[k]=p.then(function(r){priceReq[k]=null;return r},function(e){priceReq[k]=null;throw e});return priceReq[k]}
/* ===== v307 行情总线 ===== 这些代码在观察列表那条链路里是加密现货，在持仓这条链路里是美股代码（BTC = Grayscale Bitcoin Mini Trust 的美股代码），两条链路不是同一个标的，所以互不覆盖。 */var holdingsFetchedAt=0;
var CRYPTO_CODES={BTC:1,ETH:1,BNB:1,HYPE:1,SOL:1,XRP:1,DOGE:1,ADA:1,AVAX:1,LINK:1,LTC:1,DOT:1,TRX:1,XLM:1,TON:1,BCH:1,ETC:1,UNI:1,ATOM:1,NEAR:1,APT:1,ARB:1,OP:1,FIL:1,HBAR:1,ICP:1,ALGO:1,VET:1,AAVE:1,INJ:1,SEI:1,TIA:1,TAO:1,KAS:1,GRT:1,SAND:1,MANA:1,CRV:1,MKR:1,LDO:1,ENS:1,WLD:1,ENA:1,ONDO:1,JUP:1,BONK:1,WIF:1,PYTH:1,POL:1,RUNE:1,SHIB:1,PEPE:1,CRO:1,ZEC:1,XMR:1,EOS:1,FLOW:1,CHZ:1,GALA:1,IMX:1,AXS:1,THETA:1,RENDER:1};function isFreshQuote(sym,maxAge){var q=liveQuoteData[sym];if(!q||!(Number(q.price)>0))return false;var t=Number(q.time)||Number(q.asOf)||0;return !!t&&(Date.now()-t)<maxAge}function mirrorQuoteIntoLive(sym,q){try{if(!q)return;var price=Number(q.price);if(!(price>0))return;if(CRYPTO_CODES[String(sym||'').toUpperCase()])return;var prev=Number(q.prevClose);livePrices[sym]=price;liveQuoteData[sym]=Object.assign({},liveQuoteData[sym],{price:price,prevClose:prev,change:prev>0?price-prev:null,source:q.source||"yahoo",time:Number(q.asOf)||Date.now()});if(prev>0)liveChanges[sym]=price-prev;liveSources[sym]=q.source==='tencent'?'腾讯':q.source==='yahoo'?'Yahoo':(q.source||'Yahoo');}catch(e){logSwallowed("mirrorQuoteIntoLive",e)}}async function refreshPrices(){


  var el=document.getElementById("hmPricesCompact");  var syms=['VGT','SMH','BTC','SGOV'];  var fetched=false;  await Promise.all(syms.map(async function(sym){    var manual=readPriceCache()[sym];    if(manual&&manual.source==='manual'&&Number(manual.price)>0){livePrices[sym]=Number(manual.price);liveSources[sym]='手动';return}    if(CRYPTO_CODES[sym]&&!isFreshQuote(sym,5*60*1000)){      var d=await fetchPrice(sym);      if(d&&d.source!=='缓存'&&Number(d.price)>0){        var oldP=(readPriceCache()[sym]||{}).price;        livePrices[sym]=d.price;liveQuoteData[sym]=d;liveSources[sym]=d.source==='tencent'?'腾讯':d.source==='yahoo'?'Yahoo':d.source;        if(d.change!=null&&d.change!==0)liveChanges[sym]=d.change;else if(oldP&&oldP!==d.price)liveChanges[sym]=d.price-oldP;        cachePrice(sym,d);fetched=true;      }    }  }));  if(!syms.some(function(s){var q=liveQuoteData[s];return q&&Number(q.price)>0})&&!fetched){    if(el){el.setAttribute('aria-busy','true');el.innerHTML='<div class="ds-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'}    return;  }  if(el){el.setAttribute('aria-busy','false');el.innerHTML=syms.map(function(sym){    var q=liveQuoteData[sym]||{},price=Number(q.price)||Number(livePrices[sym])||0;    if(!(price>0))return '<span class="price-pill" data-sym="'+sym+'" style="cursor:pointer"><span class="pp-sym">'+sym+'</span><span style="color:var(--orange)">--</span></span>';    var prev=Number(q.prevClose);    return pricePill(sym,price,prev>0?price-prev:liveChanges[sym],liveSources[sym]||q.source||'');  }).join('')}


  updatePortfolio();updateSidebar();updateSidebarPrices();renderHoldings();


}





var holdSort={col:'value',asc:false};function sortHoldRows(rows){var c=holdSort.col,a=holdSort.asc;return rows.sort(function(x,y){var vx=c==='sym'?x.sym:c==='value'?x.value||0:c==='pnl'?x.unrealPnL||0:c==='pnlPct'?x.pnlPct||0:0;var vy=c==='sym'?y.sym:c==='value'?y.value||0:c==='pnl'?y.unrealPnL||0:c==='pnlPct'?y.pnlPct||0:0;if(typeof vx==='string')return a?vy.localeCompare(vx):vx.localeCompare(vy);return a?vx-vy:vy-vx})}

/* v306：给 dailyChange 组装行情入参（现价 / 昨收 / 每股涨跌），三处调用共用 */
function buildDailyQuotes(){var q={};var keys=Object.keys(livePrices||{});keys.forEach(function(s){var d=(liveQuoteData&&liveQuoteData[s])||{};var price=Number(d.price)||Number(livePrices[s])||0;q[s]={price:price,prevClose:Number(d.prevClose)||0,change:Number(liveChanges[s])||0}});return q}


/* ===== 持仓渲染 ===== */


/* v250：持仓视图层需要三个宿主函数（资产色 / 行情胶囊 / 金额缩写），index.js 里都在用，改为注入 */
configurePortfolioView({getAssetColor:getAssetColor,pricePill:pricePill,fmtMoney:fmt$});
function updatePortfolio(){


  var holdingsPack=computeHoldings(trades),holdings=holdingsPack.holdings,totalBuys=holdingsPack.totalBuys,totalInvested=holdingsPack.totalInvested,totalRealized=holdingsPack.totalRealized;
  var rowsPack=buildPositionRows(holdings,livePrices),rows=rowsPack.rows,totalCost=rowsPack.totalCost,totalValue=rowsPack.totalValue,hasPriced=rowsPack.hasPriced,unpriced=rowsPack.unpriced;


  rows.sort(function(a,b){return(b.value||-1)-(a.value||-1)});


  rows=sortHoldRows(rows);


  var totalPnLUnreal=hasPriced?totalValue-totalCost:null;


  var realizedOptionPremium=0;try{realizedOptionPremium=optionTotals(optionTrades).total}catch(e){logSwallowed("updatePortfolio",e)}
  var totals=portfolioTotals({hasPriced:hasPriced,totalValue:totalValue,totalCost:totalCost,totalInvested:totalInvested,totalRealized:totalRealized,optionPremium:realizedOptionPremium,netCash:getNetCash()});
  var totalPnL=totals.total,totalPct=totals.pct;


  


  renderMetricsTop(document,{hasPriced:hasPriced,totalValue:totalValue,totals:totals});


  var daily=dailyChange(rows,buildDailyQuotes(),trades,marketDate()),dailyChg=daily.change,dailyPct=daily.pct;renderMetricsPnl(document,{hasPriced:hasPriced,totalPnL:totalPnL,totalPct:totalPct,unpriced:unpriced,totalPnLUnreal:totalPnLUnreal,totalRealized:totalRealized,realizedOptionPremium:realizedOptionPremium,dailyChg:dailyChg,dailyPct:dailyPct});














  renderHoldingsBody(document,rows);








  updateDonutChart(rows);updateSidebar();updateSidebarPrices();updateHoldCash();updateDCA();updateDashboardWidgets();updatePnlSummary();updateTradeList();updateAlerts();


  var target=state.targetGoal||2500000,totalAssets=totalValue+getNetCash();var goal=goalProgress(totalAssets,target),pctVal=goal.pct,gap=goal.gap;


  renderGoalProgress(document,{pctVal:pctVal,gap:gap,hasPriced:hasPriced,totalAssets:totalAssets,target:target});


  // Rebalance alert


  // 距高点回撤


  var ddLines=[],hasPrice=false;


  ETF_SYMS.forEach(function(sym){


    var cp=livePrices[sym];if(!cp||cp<=0)return;hasPrice=true;
    var key='peak_'+sym,peakP=parseFloat(readRaw(key)||'0');
    var cd=JSON.parse(readRaw(PRICE_KEY)||'{}');
    var line=drawdownLine(sym,cp,peakP,cd[sym]&&cd[sym].hi52);if(!line)return;
    LS.setItem(key,line.peak.toString());
    ddLines.push(line)
  


  });


  renderDrawdownPanel(document,{lines:ddLines});





  renderPricePills(document,{symbols:ETF_SYMS,prices:livePrices,changes:liveChanges,sources:liveSources});





}





function updateDonutChart(rows){var canvas=document.getElementById("chartDonut"),legend=document.getElementById("donutLegend");if(!canvas)return;var dpr=window.devicePixelRatio||1,size=220;canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=size+"px";canvas.style.height=size+"px";var ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,size,size);var pack=donutSlices(rows);if(pack.reason!=='ok'){if(legend)legend.innerHTML=pack.reason==='no-data'?'<div style="color:var(--muted);padding:20px;">暂无数据</div>':'<div style="color:var(--muted);padding:20px;">请先设价</div>';return}var priced=pack.slices,total=pack.total,cx=size/2,cy=90,r=82,angle=-Math.PI/2;var slices=[];priced.forEach(function(row){var slice=row.value/total*2*Math.PI,color=getAssetColor(row.sym);slices.push({sym:row.sym,value:row.value,pct:row.value/total,color:color});ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+slice);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle="rgba(255,255,255,.3)";ctx.lineWidth=1;ctx.stroke();angle+=slice});var dark=document.documentElement.dataset.theme==="dark";ctx.beginPath();ctx.arc(cx,cy,52,0,2*Math.PI);var grd=ctx.createRadialGradient(cx,cy,45,cx,cy,60);grd.addColorStop(0,dark?"#222522":"#faf9f5");grd.addColorStop(1,dark?"#1a1d1a":"#f0ede5");ctx.fillStyle=grd;ctx.fill();ctx.fillStyle=dark?"#e4e4e0":"#1a1a1a";ctx.font="bold 20px "+getComputedStyle(document.body).fontFamily;ctx.textAlign="center";ctx.fillText(fmt$(total),cx,cy-2);ctx.font="10px sans-serif";ctx.fillStyle=dark?"#999":"#777";ctx.fillText("总市值",cx,cy+14);if(!legend)return;var h="";slices.forEach(function(s){h+="<div style=\"display:flex;align-items:center;padding:6px 10px;margin-bottom:4px;border-radius:var(--radius-sm);background:var(--surface);\"><span style=\"width:10px;height:10px;border-radius:50%;background:"+s.color+";flex-shrink:0;\"></span><span style=\"flex:1;margin-left:8px;font-weight:520;font-size:11.5px;\">"+s.sym+"</span><span style=\"font-size:11.5px;color:var(--fg);font-weight:520;\">"+(s.pct*100).toFixed(1)+"%</span><span style=\"font-size:11.5px;color:var(--muted);margin-left:6px;\">"+fmtFull(s.value)+"</span></div>"});legend.innerHTML=h}var rebalanceMode="swap";function updateRebalance(rows,totalValue){


  var el=document.getElementById('rebalanceBody');if(!el)return;


  if(!rows.length||!totalValue){el.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);">添加持仓后自动计算再平衡方案</div>';return}


  var target={VGT:state.vgt,SMH:state.smh,BTC:state.btc};


  var diffs=[];ETF_SYMS.forEach(function(sym){var cv=rows.reduce(function(s,r){return r.sym===sym&&r.priced?s+r.value:s},0);var tv=totalValue*(target[sym]||0);var diff=tv-cv;diffs.push({sym:sym,curPct:(cv/totalValue*100)||0,tgtPct:(target[sym]||0)*100,diff:diff,price:livePrices[sym]||0})});var maxDev=Math.max.apply(null,diffs.map(function(d){return Math.abs(d.curPct-d.tgtPct)}));if(maxDev<2){el.innerHTML='<div style="text-align:center;padding:16px;color:var(--accent);">✓ 已平衡 (偏差<2%)</div>';return}if(rebalanceMode==='inject'){var bi=diffs.filter(function(d){return d.diff>0.01});if(!bi.length){el.innerHTML='<div style="text-align:center;padding:16px;color:var(--accent);">✓ 已平衡</div>';return}var underPctSum=bi.reduce(function(s,d){return s+(target[d.sym]||0)},0);var curUnderPctSum=bi.reduce(function(s,d){return s+d.curPct/100},0);var S=underPctSum>curUnderPctSum?totalValue*(underPctSum-curUnderPctSum)/(1-underPctSum):0;var h='<div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;">注资买入（不卖持仓）</div>';bi.forEach(function(d){var x=target[d.sym]*(totalValue+S)-(totalValue*d.curPct/100);if(x<0)x=0;var sh=d.price>0?x/d.price:0;h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;margin-bottom:2px;background:rgba(229,57,53,.1);border-radius:6px;"><div><strong>'+d.sym+'</strong><span style="font-size:11.5px;color:var(--muted);margin-left:6px;">买入 '+fmtFull(x)+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span></div><span style="font-size:11.5px;color:var(--red);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</span></div>'});h+='<div style="font-size:11.5px;text-align:right;color:var(--red);margin-top:2px;">需注入新资金 '+fmtFull(S)+'</div>';var si=diffs.filter(function(d){return d.diff<-0.01});if(si.length)h+='<div style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:6px;">注资后 '+si.map(function(d){return d.sym}).join('、')+' 占比会被稀释</div>';el.innerHTML=h;return}var buys=diffs.filter(function(d){return d.diff>0.01}).sort(function(a,b){return b.diff-a.diff}),sells=diffs.filter(function(d){return d.diff<-0.01}).sort(function(a,b){return a.diff-b.diff});


  var h2='';var totalSell=0,totalBuy=0;


  sells.forEach(function(d){totalSell+=Math.abs(d.diff);var dev=(d.curPct-d.tgtPct).toFixed(1);var p=d.price||livePrices[d.sym]||0;var sh=p>0?Math.abs(d.diff)/p:0;h2+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-bottom:3px;background:rgba(229,57,53,.1);border-radius:6px;font-size:11.5px;border-left:3px solid var(--red);"><div><strong>'+d.sym+'</strong><span style="font-size:11.5px;color:var(--red);margin-left:4px;">超配 '+dev+'%</span></div><div style="text-align:right;"><span style="color:var(--red);font-weight:540;">↓ 卖 '+fmtFull(Math.abs(d.diff))+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span><div style="font-size:11.5px;color:var(--muted);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</div></div></div>'});


  buys.forEach(function(d){totalBuy+=d.diff;var dev=(d.tgtPct-d.curPct).toFixed(1);var p=d.price||livePrices[d.sym]||0;var sh=p>0?d.diff/p:0;h2+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-bottom:3px;background:rgba(22,153,74,.1);border-radius:6px;font-size:11.5px;border-left:3px solid var(--accent);"><div><strong>'+d.sym+'</strong><span style="font-size:11.5px;color:var(--accent);margin-left:4px;">欠配 '+dev+'%</span></div><div style="text-align:right;"><span style="color:var(--accent);font-weight:540;">↑ 买 '+fmtFull(d.diff)+(sh>0?' / '+sh.toFixed(2)+'股':'')+'</span><div style="font-size:11.5px;color:var(--muted);">'+d.curPct.toFixed(1)+'% → '+d.tgtPct.toFixed(0)+'%</div></div></div>'})


  if(totalBuy>0||totalSell>0)h2+='<div style="border-top:1px solid var(--rule);margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);"><span>换仓总额</span><span style="color:var(--fg);font-weight:540;">'+fmtFull(Math.max(totalBuy,totalSell))+'</span></div>';


  if(!buys.length&&!sells.length)h2='<div style="text-align:center;padding:12px;color:var(--accent);font-size:12.5px;">✓ 已平衡</div>';


  el.innerHTML=h2;


}





/* ===== 数据持久化 ===== */


function normalizeState(s){if(!s)s={};return{monthlyDCA:s.monthlyDCA!==undefined?s.monthlyDCA:2000,dcaOverride:s.dcaOverride||{month:'',amount:0},roadmapStart:s.roadmapStart||'2025-01',roadmapAge:s.roadmapAge!==undefined?s.roadmapAge:27,sgovTarget:s.sgovTarget!==undefined?s.sgovTarget:0,targetGoal:s.targetGoal!==undefined?s.targetGoal:2500000,vgt:s.vgt!==undefined?s.vgt:0.50,smh:s.smh!==undefined?s.smh:0.30,btc:s.btc!==undefined?s.btc:0.20,plan:(s.plan&&typeof s.plan==='object')?s.plan:null}}
function loadState(){try{var s=readRaw(LSKEY);if(s)return normalizeState(JSON.parse(s))}catch(e){logSwallowed("loadState",e)}return{monthlyDCA:2000,dcaOverride:{month:'',amount:0},roadmapStart:'2025-01',roadmapAge:27,sgovTarget:0,vgt:0.50,smh:0.30,btc:0.20}}


function saveState(){try{LS.setItem(LSKEY,JSON.stringify(state));markDirty('state');autoPushDebounce();LS.setItem(LSKEY+'_theme',document.documentElement.dataset.theme)}catch(e){if(isQuotaError(e))alert('存储空间不足，请导出数据后清理旧记录')}}


// ---- DCA (定投) ----


/* ===== DCA 定投 ===== */


function getEffectiveDCA(){var ov=state.dcaOverride,ym=marketDate().slice(0,7);if(ov&&ov.month===ym&&ov.amount>0)return ov.amount;return state.monthlyDCA||2000}


function updateDCA(){var dca=getEffectiveDCA(),baseAmt=state.monthlyDCA||2000;var baseEl=document.getElementById('dcaBaseAmt');if(baseEl)baseEl.textContent='$'+baseAmt.toLocaleString('en-US')+'/月 · 本月';var alloc={VGT:state.vgt,SMH:state.smh,BTC:state.btc},els={},sum=0;ETF_SYMS.forEach(function(s){var amt=dca*alloc[s];sum+=amt;els['dca'+s]=document.getElementById('dca'+s);if(els['dca'+s])els['dca'+s].textContent=fmt$(amt)});var ds=document.getElementById('dcaStatus');if(ds)checkDCAStatus(ds);updateMobileDcaSummary(dca)}
function updateMobileDcaSummary(target){var ym=marketDate().slice(0,7),invested=trades.filter(function(t){return t.shares>0&&t.date.slice(0,7)===ym}).reduce(function(s,t){return s+t.shares*t.price},0),pct=target>0?invested/target*100:0,whole=function(n){return'$'+safeNum(n).toLocaleString('en-US',{maximumFractionDigits:0})};var inv=document.getElementById('mobileDcaInvested'),tar=document.getElementById('mobileDcaTarget'),pe=document.getElementById('mobileDcaPct'),bar=document.getElementById('mobileDcaProgress');if(inv)inv.textContent=whole(invested);if(tar)tar.textContent=whole(target);if(pe)pe.textContent=Math.round(pct)+'%';if(bar)bar.style.width=Math.max(0,Math.min(100,pct))+'%';[['Vgt','vgt'],['Smh','smh'],['Btc','btc']].forEach(function(pair){var ratio=safeNum(state[pair[1]])||0,pctEl=document.getElementById('mobileDca'+pair[0]+'Pct'),amtEl=document.getElementById('mobileDca'+pair[0]+'Amt');if(pctEl)pctEl.textContent=Math.round(ratio*100)+'%';if(amtEl)amtEl.textContent=whole(target*ratio)});var v=safeNum(state.vgt)||0,s=safeNum(state.smh)||0,b=safeNum(state.btc)||0,sum=v+s+b||1,vp=document.getElementById('sbVgtPct'),sp=document.getElementById('sbSmhPct'),bp=document.getElementById('sbBtcPct'),mini=document.querySelector('.sb-mini-donut'),vEnd=v/sum*100,sEnd=(v+s)/sum*100;if(vp)vp.textContent=Math.round(v/sum*100)+'%';if(sp)sp.textContent=Math.round(s/sum*100)+'%';if(bp)bp.textContent=Math.round(b/sum*100)+'%';if(mini)mini.style.background='conic-gradient(var(--violet) 0 '+vEnd+'%, var(--blue) '+vEnd+'% '+sEnd+'%, var(--orange) '+sEnd+'% 100%)'}


function checkDCAStatus(el){el=el||document.getElementById('dcaStatus');if(!el)return;var dca=getEffectiveDCA();if(dca<=0){el.innerHTML='<span style="color:var(--muted);">⚙️ 定投总额为 $0，请在侧边栏设置</span>';el.style.background='var(--surface)';return}var ym=marketDate().slice(0,7),buys=trades.filter(function(t){return t.shares>0&&t.date.slice(0,7)===ym});if(!buys.length){el.innerHTML='<span style="color:var(--orange);">⏳ 本月尚未开始定投</span>';el.style.background='linear-gradient(135deg,rgba(204,125,42,.08),transparent)';return}var bySym={};buys.forEach(function(t){bySym[t.symbol]=(bySym[t.symbol]||0)+t.shares*t.price});var v=bySym.VGT||0,m=bySym.SMH||0,b=bySym.BTC||0,total=v+m+b;var targetV=dca*state.vgt,targetM=dca*state.smh,targetB=dca*state.btc;var complete=total>=dca*0.9;if(complete){el.innerHTML='✅ 已完成 · 总额 '+fmt$(total)+'/'+fmt$(dca);el.style.background='var(--accent)';el.style.color='#fff'}


  else{if(v+m+b>0){el.innerHTML='⏳ 进行中 · '+fmt$(total)+'/'+fmt$(dca)+' ('+(total/dca*100).toFixed(0)+'%)';el.style.background='var(--orange)';el.style.color='#fff'}else{el.innerHTML='⏳ 本月待执行';el.style.background='rgba(204,125,42,.15)';el.style.color='var(--orange)'}}}


// ---- 日志页 ----


var ACTIVITY_KEY=KEYS.activity;


/* ===== 活动日志 ===== */


function addActivity(action,detail){var acts=[];try{acts=JSON.parse(readRaw(ACTIVITY_KEY)||'[]')}catch(e){logSwallowed("addActivity",e)}acts.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),action:action,detail:detail||''});if(acts.length>200)acts=acts.slice(-200);LS.setItem(ACTIVITY_KEY,JSON.stringify(acts));markDirty('activities');renderActivity();autoPushDebounce()}


function renderActivity(){var el=document.getElementById('activityLog');if(!el)return;var acts=normalizeActivities(JSON.parse(readRaw(ACTIVITY_KEY)||'[]'));if(!acts.length){el.innerHTML='<div class="table-empty">暂无操作记录</div>';return}el.innerHTML=acts.slice().reverse().map(function(a){var kind=a.action.indexOf('买入')>=0?'buy':a.action.indexOf('卖出')>=0?'sell':a.action.indexOf('入金')>=0?'deposit':a.action.indexOf('出金')>=0?'withdraw':'note',icon=kind==='buy'||kind==='deposit'?'<path d="m5 12 4 4 10-10"/>':kind==='sell'||kind==='withdraw'?'<path d="M6 6l12 12M18 6 6 18"/>':'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>';return'<div class="activity-item"><span class="activity-mark '+kind+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+icon+'</svg></span><div class="activity-body"><div class="activity-title">'+escapeHtml(a.action)+'</div>'+(a.detail?'<div class="activity-detail">'+escapeHtml(a.detail)+'</div>':'')+'</div><span class="activity-time">'+escapeHtml(a.date.slice(5)+' '+a.time)+'</span><button class="trade-del" data-act="'+a.id+'" aria-label="删除这条日志">×</button></div>'}).join('')}


function renderLogHeatmap(){


  var container=document.getElementById('logHeatmap');if(!container)return;


  var dca=getEffectiveDCA(),pack=disciplineMonths({trades:trades,dca:dca,symbols:ETF_SYMS}),months=pack.months,streak=pack.streak;
  var sc=document.getElementById('streakCount');if(sc)sc.textContent=streak;


  // Render


  var htm='';months.forEach(function(mt){var bg,txt,icon;


    if(mt.isFuture){bg='transparent';txt='var(--rule)';icon=mt.icon}


    else if(!mt.hasBuy){bg='rgba(217,69,53,.08)';txt='var(--red)';icon=mt.icon}


    else if(mt.complete){bg='var(--accent)';txt='#fff';icon=mt.icon}


    else{bg='var(--orange)';txt='#fff';icon=mt.icon}


    var state=mt.state;htm+='<div class="discipline-month '+state+'" title="'+mt.ym+'：'+fmt$(mt.totalV)+'/'+fmt$(dca)+(mt.isFuture?' (未来)':'')+'"><span>'+mt.label+'</span>'+(icon?'<strong>'+icon+'</strong>':'')+'<span>'+fmt$(mt.totalV)+'</span></div>'});container.innerHTML=htm


}


function renderAnnualMatrix(){
  var grid=document.getElementById('annualMatrixGrid'),stats=document.getElementById('annualMatrixStats');
  if(!grid||!stats)return;

  var pack=annualMatrix({trades:trades,optionTrades:optionTrades,cashLog:cashLog,prices:livePrices,netCash:getNetCash(),targetGoal:state.targetGoal||2500000,symbols:ETF_SYMS,now:new Date()});
  if(pack.empty){grid.innerHTML=emptyStateHTML({title:'暂无纪律数据',hint:'记录第一笔买入后，这里会自动生成月度热力图'});stats.innerHTML='';return}
 var cells=pack.cells,totalInvested=pack.totalInvested,activeYears=pack.activeYears,totalAssets=pack.totalAssets,cagr=pack.cagr,targetGap=pack.targetGap,totalMktV=pack.totalMktV;
  var heatColor=heatColorFor;   /* v245：色阶来自 charts.js（别名保留，渲染处不改） */
  var fmtSh=function(n){return n===Math.floor(n)?n.toFixed(0):n.toFixed(1)};
  
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


function updateDataPage(){var totals=dataPageTotals(trades,cashLog);var dc=document.getElementById('dataCashBal');if(dc)dc.textContent=fmtFull(getNetCash());var dd=document.getElementById('dataDep');if(dd)dd.textContent=fmtFull(totals.deposit);var dl=document.getElementById('dataSel');if(dl)dl.textContent=fmtFull(totals.sold);var db=document.getElementById('dataBuy');if(db)db.textContent=fmtFull(totals.bought);updateTradeList();updatePnlSummary();renderCashLog()}


function updateTradeList(){var body=document.getElementById('tradeBody');if(!body)return;var filter=document.getElementById('tradeFilterSym'),sym=filter?filter.value:'';body.innerHTML=buildTradeRows(selectTrades(trades,sym))}


function updatePnlSummary(){var el=document.getElementById('pnlSummary');if(!el)return;
  var rows=summaryRows(trades,livePrices,['VGT','SMH','BTC']);
  var total=rows.reduce(function(s,r){return s+r.value},0);el.innerHTML=rows.map(function(r){var color=getAssetColor(r.sym),width=total>0?r.value/total*100:0;return '<button class="asset-row" onclick="switchTab(\'data\')"><span class="asset-identity"><i style="background:'+color+'"></i><span><strong>'+r.sym+'</strong><small>'+r.shares.toFixed(2)+' 股</small></span></span><span class="asset-allocation"><i style="width:'+width.toFixed(1)+'%;background:'+color+'"></i></span><span class="asset-result"><strong>'+fmtFull(r.value)+'</strong><small class="'+(r.pct>=0?'positive':'negative')+'">'+(r.pct>=0?'+':'')+r.pct.toFixed(2)+'%</small></span><b>›</b></button>'}).join('')||'<div class="asset-empty">暂无持仓，在操作台录入第一笔交易</div>';var ars=el.querySelectorAll('.asset-row');rows.forEach(function(r,i){var b=ars[i];if(!b)return;var share=total>0?r.value/total*100:0;var tgt=(r.sym==='VGT'?state.vgt:r.sym==='SMH'?state.smh:state.btc)*100;var dev=share-tgt;b.setAttribute('data-share',share.toFixed(1));b.setAttribute('data-tgt','目标 '+tgt.toFixed(0)+'%');b.setAttribute('data-dev','偏离 '+(dev>=0?'+':'')+dev.toFixed(1)+'%');b.style.setProperty('--tgt',Math.max(0,Math.min(100,tgt)).toFixed(1)+'%')})}


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


  else{var next=new Date(now.getFullYear()+((m===12&&d>31)?1:0),11,31,23,59,59);if(next<=now){next=new Date(now.getFullYear()+1,11,31,23,59,59)}var days=Math.ceil((next-now)/86400000);badge.textContent='计划中';badge.style.background='var(--surface)';badge.style.color='var(--muted)';msg.style.display='block';msg.innerHTML='年度再平衡计划在 <strong>12月31日</strong> 执行<br><span style="font-size:11.5px;">距执行还有 <strong>'+days+'</strong> 天 · 下面的建议现在就能预览</span>';msg.style.background='var(--surface)';content.style.opacity='1';content.style.pointerEvents='auto'}


}


function loadCash(){try{var s=readRaw(CB_KEY);var n=s?parseFloat(s):0;return isNaN(n)?0:n}catch(e){if(isQuotaError(e)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')};return 0}}function saveCash(){try{if(isNaN(cashBalance))cashBalance=0;LS.setItem(CB_KEY,cashBalance.toString());markDirty('cashBalance');doAutoBackup();autoPushDebounce()}catch(e){if(isQuotaError(e)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')}}}function loadCashLog(){try{var s=readRaw(CLOG_KEY);return normalizeCashLogs(s?JSON.parse(s):[])}catch(e){return[]}}function saveCashLog(){try{cashLog=normalizeCashLogs(cashLog);LS.setItem(CLOG_KEY,JSON.stringify(cashLog));markDirty('cashLog');doAutoBackup();autoPushDebounce()}catch(e){if(isQuotaError(e)){var b=document.getElementById('storageBanner');if(b)b.classList.add('show')}}}function renderCashLog(){var b=document.getElementById("cashLogBody");if(!b)return;var f=document.getElementById('cashFilter'),fv=f?f.value:'';var tot=cashTotals(cashLog),ci=document.getElementById('cashTotalIn');if(ci)ci.textContent=fmtFull(tot.totalIn);var co=document.getElementById('cashTotalOut');if(co)co.textContent=fmtFull(tot.totalOut);b.innerHTML=buildCashLogRows(selectCashLogs(cashLog,fv))}function refreshCashUI(){renderCashLog();updateHoldCash();updateSidebar();updateDataPage()}function loadTrades(){try{var s=readRaw(TRADE_KEY);return normalizeTrades(s?JSON.parse(s):[])}catch(e){return[]}}


function saveTrades(){try{trades=normalizeTrades(trades);LS.setItem(TRADE_KEY,JSON.stringify(trades));markDirty('trades');doAutoBackup();autoPushDebounce()}catch(e){if(isQuotaError(e))alert('存储空间不足，请导出数据后清理旧记录')}}














function initTradeIds(){var max=0;for(var i=0;i<trades.length;i++){if(trades[i].id>max)max=trades[i].id}tradeIdCounter=max+1}





/* ===== 主题 & UI ===== */


function refreshVisualPalette(){if(typeof updatePortfolio==='function')updatePortfolio();if(typeof updateSidebar==='function')updateSidebar()}
configureSettingsView({refreshVisualPalette:refreshVisualPalette});
bindShellControls();







// Sidebar toggle







// Mobile settings drawer






// ---- TABS ----


document.querySelectorAll('.tab-btn').forEach(function(b){b.addEventListener('click',function(){switchTab(b.dataset.tab)})});





/* v312：观察列表卡头的刷新按钮（原来刷新藏在「…」菜单里，不好找） */document.getElementById('btnWatchRefresh').addEventListener('click',function(){var btn=this;btn.style.opacity='.4';btn.style.pointerEvents='none';var rowsBox=document.getElementById('watchRows');/* v312：刷新期间把列表压暗，给出正在进行的反馈 */if(rowsBox){rowsBox.style.transition='opacity .18s var(--ease-out)';rowsBox.style.opacity='.45'}var done=function(){btn.style.opacity='1';btn.style.pointerEvents='auto';if(rowsBox)rowsBox.style.opacity='1'};try{watchFetchedAt=0}catch(e){logSwallowed('btnWatchRefresh',e)}Promise.resolve(fetchMarketData()).then(function(){return refreshPrices()}).then(function(){done()},function(){done()});});
document.getElementById('hmRefresh').addEventListener('click',function(){var btn=this;btn.style.opacity='.4';btn.style.pointerEvents='none';var priceBox=document.getElementById('hmPricesCompact');/* v312：恢复刷新中的可见反馈 —— 行情区先变骨架微光，取完再回填 */if(priceBox){priceBox.setAttribute('aria-busy','true');priceBox.innerHTML='<div class="ds-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'}var done=function(){btn.style.opacity='1';btn.style.pointerEvents='auto';/* 兜底：万一取数失败也要把行情区画回来，别把骨架留在那儿 */try{refreshPrices()}catch(e){logSwallowed('hmRefresh',e)}};try{watchFetchedAt=0}catch(e){logSwallowed('hmRefresh',e)}Promise.resolve(fetchMarketData()).then(function(){return refreshPrices()}).then(function(){done()},function(){done()});});


document.getElementById('hmManualSet').addEventListener('click',function(){var sym=document.getElementById('hmManualSym').value.toUpperCase().trim();var price=parseFloat(document.getElementById('hmManualPrice').value);if(!sym)return formError('请输入标的代码','hmManualSym');if(!ETF_SYMS.includes(sym))return formError('仅支持 '+ETF_SYMS.join('/'),'hmManualSym');if(!price||price<=0)return formError('请输入有效的价格','hmManualPrice');var manualData={price:price,source:'manual',time:Date.now()};livePrices[sym]=price;liveQuoteData[sym]=manualData;liveSources[sym]='手动';cachePrice(sym,manualData);document.getElementById('hmManualSym').value='';document.getElementById('hmManualPrice').value='';updatePortfolio();updateSidebar();updateSidebarPrices();showToast('✅ '+sym+' 价格已设为 $'+price.toFixed(2))});





document.getElementById('btnAddTrade').addEventListener('click',function(){


  var sym=document.getElementById('tfAsset').value,date=document.getElementById('tfDate').value||marketDate();


  var type=document.getElementById('tfType').value,shares=parseFloat(document.getElementById('tfShares').value),price=parseFloat(document.getElementById('tfPrice').value);


  if(!shares||shares<=0)return formError('请输入有效的股数','tfShares');if(!price||price<=0)return formError('请输入有效的价格','tfPrice');


  if(type==='buy'){var avail=getNetCash();var cost=shares*price;if(cost>avail){showToast('现金不足：需要 '+fmtFull(cost)+'，可用 '+fmtFull(avail)+' · 已跳到「现金管理」，入金后再录这笔','err');try{qaDeposit()}catch(e){logSwallowed("btnAddTrade",e)}return}}if(type==='sell'){var held=0;trades.forEach(function(t){if(t.symbol===sym)held+=t.shares});if(shares>held){showToast('持仓不足！\n持有：'+held.toFixed(2)+'股\n卖出：'+shares.toFixed(2)+'股','err');return}}


  var qty=type==='sell'?-shares:shares;


  trades.push({id:tradeIdCounter++,symbol:sym,date:date,time:marketClock(),shares:qty,price:price,type:type});trades.sort(function(a,b){return a.date.localeCompare(b.date)});


  saveTrades();updatePortfolio();updateDCA();document.getElementById('tfShares').value='';document.getElementById('tfPrice').value='';updateTradeEstimate();


  addActivity((type==='sell'?'卖出 ':'买入 ')+sym+' '+shares.toFixed(2)+'股 @ $'+price.toFixed(2));


haptic('success');showToast('✅ 录入成功','ok');try{closeTradeSheet()}catch(e){logSwallowed("closeTradeSheet",e)}


});





document.getElementById('btnExport').addEventListener('click',function(){var url=location.origin+location.pathname;navigator.clipboard.writeText(url).then(function(){var b=document.getElementById('btnExport');b.textContent='已复制!';setTimeout(function(){b.textContent='复制链接'},1500)}).catch(function(){alert(url)})});





function recordBackupTime(timestamp){var ts=Number(timestamp)||Date.now();LS.setItem('lastBackupTime',String(ts));var el=document.getElementById('lastBackupTime');if(el)el.textContent='上次备份 '+new Date(ts).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});renderSyncHealth()}
document.getElementById('btnExportData').addEventListener('click',function(){showBusyToast('正在生成完整备份');setTimeout(function(){var data=createBackupData(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wealth-complete-'+localDate()+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);recordBackupTime(Date.now());showToast('完整备份已导出 · '+data.trades.length+' 笔交易 · '+data.optionTrades.length+' 个期权','ok')},80)});


function importBackupData(data){
  var plan=planBackupImport(data,{appDataVersion:APP_DATA_VERSION,etfSymbols:ETF_SYMS,current:{trades:trades,cashLog:cashLog,optionTradesRaw:JSON.parse(readRaw('wealth_options_v2')||'[]'),activitiesRaw:JSON.parse(readRaw(ACTIVITY_KEY)||'[]'),watchlist:watchList}});
  if(!plan.ok)throw new Error(plan.error);
  if(!confirm('准备恢复以下数据：\n\n'+plan.summary+'\n\n现有对应数据将被覆盖，是否继续？'))return false;
  var next=plan.next,has=plan.has;
  if(has.state){state=normalizeState(data.state);LS.setItem(LSKEY,JSON.stringify(state));markDirty('state')}
  if(has.trades){trades=next.trades;LS.setItem(TRADE_KEY,JSON.stringify(trades));markDirty('trades')}
  if(has.cashBalance){cashBalance=safeNum(Number(data.cashBalance));LS.setItem(CB_KEY,String(cashBalance));markDirty('cashBalance')}
  if(has.cashLog){cashLog=next.cashLog;LS.setItem(CLOG_KEY,JSON.stringify(cashLog));markDirty('cashLog')}
  if(has.activities){LS.setItem(ACTIVITY_KEY,JSON.stringify(next.activities));markDirty('activities')}
  if(has.optionTrades){optionTrades=next.optionTrades;LS.setItem('wealth_options_v2',JSON.stringify(optionTrades));markDirty('optionTrades')}
  if(plan.otm){otmSettings=plan.otm;LS.setItem('otmSettings',JSON.stringify(otmSettings));markDirty('otmSettings')}
  if(plan.exitValue!==undefined){LS.setItem('exit_portfolio',cleanText(plan.exitValue,120));markDirty('exit_portfolio')}
  if(has.watchlist){watchList=next.watchlist;LS.setItem(WATCH_KEY,JSON.stringify(watchList));markDirty('watchlist');try{renderWatch();renderWatchManage()}catch(e){logSwallowed("importBackupData",e)}}
  if(has.prices)LS.setItem(PRICE_KEY,JSON.stringify(plan.prices));
  if(has.theme)LS.setItem(LSKEY+'_theme',data.theme);
  if(has.accent)LS.setItem(LSKEY+'_accent',data.accent);
  autoPushDebounce();return true
}
document.getElementById('fileImport').addEventListener('change',function(){var input=this,file=input.files[0];if(!file)return;if(file.size>5*1024*1024){showToast('备份文件过大，已取消导入','err');input.value='';return}var reader=new FileReader();reader.onload=function(){try{var data=JSON.parse(reader.result);if(importBackupData(data)){showToast('备份恢复成功，正在刷新','ok');setTimeout(function(){location.reload()},700)}}catch(e){showToast('导入失败：'+e.message,'err')}finally{input.value=''}};reader.readAsText(file)});


document.getElementById('csvImport').addEventListener('change',function(){var file=this.files[0];if(file)doCSVImport(file);this.value=''});














// Global event delegation


document.body.addEventListener('click',function(e){var b=e.target.closest('.trade-del');if(!b)return;var hid=b.dataset.hold;if(hid){var holdCnt=trades.filter(function(t){return t.symbol===hid}).length;showApproval({title:'清仓 '+hid,message:'将删除 '+hid+' 的全部 '+holdCnt+' 条交易记录。删除后可点击底部提示条撤销。',confirmText:'清仓 '+holdCnt+' 条',onConfirm:function(){var oldT=trades.slice();trades=trades.filter(function(t){return t.symbol!==hid});saveTrades();updatePortfolio();showToast('已清仓 '+hid,'ok',function(){trades=oldT;saveTrades();updatePortfolio();showToast('已恢复 '+hid)})}});return}var tid=parseInt(b.dataset.id);if(tid){var rmed=trades.find(function(t){return t.id===tid});if(!rmed)return;trades=trades.filter(function(t){return t.id!==tid});saveTrades();updatePortfolio();showToast(rmed.symbol+' 交易已删除','ok',function(){trades.push(rmed);trades.sort(function(a,b){return a.date.localeCompare(b.date)});saveTrades();updatePortfolio()});return}var cid=parseInt(b.dataset.clog);if(cid){var rmedLog=cashLog.find(function(l){return l.id===cid});if(!rmedLog)return;cashLog=cashLog.filter(function(l){return l.id!==cid});cashBalance-=cashSigned(rmedLog);saveCashLog();saveCash();refreshCashUI();showToast(rmedLog.type+' 流水已删除','ok',function(){cashLog.push(rmedLog);cashLog.sort(function(a,b){return a.date.localeCompare(b.date)});cashBalance+=cashSigned(rmedLog);saveCashLog();saveCash();refreshCashUI()})}var aid=parseInt(b.dataset.act);if(aid){/* 操作日志的单条删除：以前只渲染了 data-act，没有任何监听器 → 按钮点不动 */var acts=[];try{acts=JSON.parse(readRaw(ACTIVITY_KEY)||'[]')}catch(e){logSwallowed("loadTheme",e)}var rmedAct=acts.filter(function(x){return Number(x.id)===aid})[0];if(!rmedAct)return;var keptAct=acts.filter(function(x){return Number(x.id)!==aid});LS.setItem(ACTIVITY_KEY,JSON.stringify(keptAct));markDirty('activities');renderActivity();autoPushDebounce();showToast('已删除这条操作日志','ok',function(){LS.setItem(ACTIVITY_KEY,JSON.stringify(acts));markDirty('activities');renderActivity();autoPushDebounce();showToast('✅ 已恢复操作日志')})}});





runMigrations(reportError);
cashBalance=loadCash();cashLog=loadCashLog();function initPortfolio(){initTradeIds();var cached=readPriceCache();for(var sym in cached){livePrices[sym]=cached[sym].price||cached[sym];liveQuoteData[sym]=cached[sym];liveSources[sym]=cached[sym].source==='tencent'?'腾讯':cached[sym].source||'缓存';if(cached[sym].change!=null)liveChanges[sym]=cached[sym].change}updatePortfolio();refreshPrices();setInterval(refreshPrices,300000)}





function updateWithdrawal(){var out=computeWithdrawal({portfolio:parseInt(document.getElementById('rWdPortfolio').value),ratePct:parseFloat(document.getElementById('rWdRate').value),returnPct:parseFloat(document.getElementById('rWdReturn').value),inflPct:parseFloat(document.getElementById('rWdInfl').value)});document.getElementById('wdAnnual').textContent=fmt$(out.annual);document.getElementById('wdMonthly').textContent=fmt$(out.monthly);document.getElementById('wdDeplete').textContent=out.depletionYears===null?'永续':out.depletionYears+' 年';document.getElementById('wdPerpetual').textContent=out.realReturn>0?fmtPct(out.realReturn):'不可'}


['rWdPortfolio','rWdRate','rWdReturn','rWdInfl'].forEach(function(id){var e=document.getElementById(id);if(!e)return;e.addEventListener('input',function(){var v=document.getElementById('v'+id.slice(1));if(v)v.textContent=id.indexOf('Portfolio')>=0?fmt$(parseInt(e.value)):(parseFloat(e.value).toFixed(1)+'%');updateWithdrawal()})});







var autoBackup=false;function doAutoBackup(){if(!autoBackup)return;var data=createBackupData(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='wealth-auto-complete-'+localDate()+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},5000);recordBackupTime(Date.now())}





function switchTab(tab){if(window.navigator&&navigator.vibrate)navigator.vibrate(8);if(tab==='log'||tab==='logs')tab='data';document.body.dataset.activeTab=tab;var titleMap={holding:'My Portfolio',console:'操作台',option:'期权',data:'记录',log:'记录'},desktopTitleMap={holding:'投资仪表盘',console:'操作台',option:'期权管理',data:'记录',log:'记录'};var mt=document.getElementById('msPageTitle');if(mt)mt.textContent=titleMap[tab]||'My Portfolio';var dt=document.getElementById('desktopPageTitle');if(dt)dt.textContent=desktopTitleMap[tab]||'投资仪表盘';


  document.querySelectorAll('.tab-btn').forEach(function(x){x.classList.remove('active')});


  document.querySelectorAll('.tab-panel').forEach(function(x){x.classList.remove('active')});


  var tb=document.querySelector('.tab-btn[data-tab="'+tab+'"]');


  if(tb)tb.classList.add('active');


  var panel=document.getElementById('tab-'+tab);


  if(panel)panel.classList.add('active');


  document.querySelectorAll('.bb-btn').forEach(function(b){b.classList.remove('active');b.removeAttribute('aria-current')});


  var bba=document.getElementById(tab==='holding'?'bbHoldings':tab==='holdings'?'bbHoldings':'bb'+tab.charAt(0).toUpperCase()+tab.slice(1));


  if(bba){bba.classList.add('active');bba.setAttribute('aria-current','page')}


  if(tab==='holdings'||tab==='holding')updatePortfolio();




  if(tab==='log'){renderActivity();renderLogHeatmap();renderAnnualMatrix()}


  if(tab==='data'||tab==='console')updateDataPage()
  if(tab==='option')setTimeout(function(){if(typeof updateAllO==="function")updateAllO()},50)
  if(tab==='console'&&typeof refreshTradeAffordability==='function')refreshTradeAffordability()

  var main=document.querySelector('.main');if(main&&window.innerWidth<=800)main.scrollTo({top:0,behavior:'auto'});setMobileSettings(false)


  try{document.activeElement.blur()}catch(e){logSwallowed("switchTab",e)}


}







function updateMobStatusBar(){
  var bar=document.getElementById('mobStatusBar');if(!bar)return;
  var bals={};trades.forEach(function(t){bals[t.symbol]=(bals[t.symbol]||0)+t.shares});var totalV=0;var mobRows=ETF_SYMS.map(function(sym){var sh=Math.max(0,bals[sym]||0);totalV+=sh*(livePrices[sym]||0);return{sym:sym,shares:sh,priced:!!livePrices[sym]}});var mobDaily=dailyChange(mobRows,buildDailyQuotes(),trades,marketDate()),daily=mobDaily.change;var nc=getNetCash();
  var vm=document.getElementById('msTotal');if(vm)animateVal(vm,totalV+nc);
  /* v320：桌面卡的「总资产 / 现金占比」交给视图层写（本函数是手机状态栏，不该管桌面 DOM）。
     这里只负责在现金变化后触发一次 —— 口径与文案都在 portfolio-view.js 里，只有一份。 */
  renderCashTotals(document,totalV+nc,nc);
  var mc=document.getElementById('msCash');if(mc)mc.textContent=fmtFull(nc);
  var mp=document.getElementById('msPnl'),srcPnl=document.getElementById('hmPnL');if(mp&&srcPnl){mp.textContent=srcPnl.textContent;mp.classList.toggle('pnl-neg',srcPnl.textContent.indexOf('-')===0);mp.classList.toggle('pnl-pos',srcPnl.textContent.indexOf('-')!==0)}
  var md=document.getElementById('msDaily'),dailyPct=mobDaily.pct,dailyText='今日 '+(daily>=0?'+':'-')+fmtFull(Math.abs(daily))+' · '+(dailyPct==null?'—':((dailyPct>=0?'+':'')+dailyPct.toFixed(2)+'%'));if(md){md.textContent=dailyText;md.classList.toggle('negative',daily<0)}var sd=document.getElementById('sbToday');if(sd){sd.textContent=dailyText;sd.style.color=daily<0?'var(--red)':'var(--accent)'}
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


var _ptrEl=document.getElementById("pullHint");if(_ptrEl)_ptrEl.style.display="none";/* 顶部状态栏不再响应点击刷新，避免误触；刷新入口在操作台的刷新按钮 */





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


  autoBackup=readRaw('autoBackup')==='1';var cb=document.getElementById('cbAutoBackup');if(cb){cb.checked=autoBackup;cb.addEventListener('change',function(){autoBackup=this.checked;LS.setItem('autoBackup',autoBackup?'1':'0')})}var lbt=readRaw('lastBackupTime');if(lbt){var d2=new Date(parseInt(lbt));document.getElementById('lastBackupTime').textContent='上次备份 '+d2.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}


  /* v256：【品牌徽标两版对比】?brand=mono 用单色剪影，默认用品牌原色（见 main.css 的 .sym-badge 一段） */
  try{document.documentElement.dataset.brand=/[?&]brand=mono/.test(location.search)?'mono':'color'}catch(e){logSwallowed("initBrandStyle",e)}
  try{loadAccent();loadTheme();


  state=loadState();trades=loadTrades();initTradeIds();


  var dcaInput=document.getElementById('monthlyDCAInput');if(dcaInput){dcaInput.value=state.monthlyDCA||2000;dcaInput.addEventListener('change',function(){var v=parseInt(dcaInput.value)||0;v=Math.max(0,Math.min(50000,v));dcaInput.value=v;state.monthlyDCA=v;saveState();updateDCA()})}var dcaOv=document.getElementById('dcaOverride');if(dcaOv){if(state.dcaOverride){var ym2=marketDate().slice(0,7);if(state.dcaOverride.month===ym2&&state.dcaOverride.amount>0)dcaOv.value=state.dcaOverride.amount}dcaOv.addEventListener('input',function(){var v=parseInt(dcaOv.value)||0;if(v<=0){state.dcaOverride={month:'',amount:0};dcaOv.value=''}else{state.dcaOverride={month:marketDate().slice(0,7),amount:v}}saveState();updateDCA()})}


  var rsY=document.getElementById('roadmapStartYear'),rsM=document.getElementById('roadmapStartMonth');if(rsY&&rsM){var rs=String(state.roadmapStart||'2025-01'),ry=Number(rs.slice(0,4))||2025,rm=Number(rs.slice(5,7))||1,nowY=new Date().getFullYear(),optY='';for(var yy=2020;yy<=nowY+20;yy++)optY+='<option value="'+yy+'">'+yy+' 年</option>';rsY.innerHTML=optY;var optM='';for(var mm=1;mm<=12;mm++){var mv=mm<10?'0'+mm:String(mm);optM+='<option value="'+mv+'">'+mm+' 月</option>'}rsM.innerHTML=optM;rsY.value=String(ry);rsM.value=(rm<10?'0':'')+rm;var syncRoadmapStart=function(){state.roadmapStart=rsY.value+'-'+rsM.value;saveState();updateDashboardWidgets()};rsY.addEventListener('change',syncRoadmapStart);rsM.addEventListener('change',syncRoadmapStart)}


  var raInput=document.getElementById('roadmapAgeInput');if(raInput){raInput.value=state.roadmapAge||27;raInput.addEventListener('change',function(){var v=parseInt(raInput.value)||27;v=Math.max(18,Math.min(70,v));raInput.value=v;state.roadmapAge=v;saveState();updatePlanAges()})}


  var tgInput=document.getElementById('targetGoalInput');if(tgInput){tgInput.value=state.targetGoal||2500000;tgInput.addEventListener('change',function(){var v=parseInt(tgInput.value)||2500000;v=Math.max(100000,Math.min(10000000,v));tgInput.value=v;state.targetGoal=v;saveState();updatePortfolio()});var tl=document.getElementById('targetLabel');if(tl)tl.textContent=fmt$(state.targetGoal||2500000)}


  updateWithdrawal();updateDCA();renderActivity();renderLogHeatmap();renderAnnualMatrix();renderCashLog();





  var ep=document.getElementById('exitPortfolio');if(ep){var saved=readRaw('exit_portfolio');if(saved)ep.value=saved;ep.addEventListener('change',function(){LS.setItem('exit_portfolio',ep.value);markDirty('exit_portfolio');autoPushDebounce()})}


  updateSidebarPrices();initPortfolio();document.getElementById('hmPricesCompact')?.addEventListener('click',function(e){var p=e.target.closest('.price-pill');if(!p)return;var s=p.dataset.sym;if(!s)return;document.getElementById('tfAsset').value=s;var pr=parseFloat(p.dataset.price);if(!isNaN(pr))document.getElementById('tfPrice').value=pr;syncTradeControls();updateTradeEstimate();/* v309：给出可见反馈 —— 高亮这一行（防止点串看不出），并把录入弹层打开 */try{var rows=document.querySelectorAll('#hmPricesCompact .price-pill');for(var i=0;i<rows.length;i+=1)rows[i].classList.remove('is-picked');p.classList.add('is-picked');setTimeout(function(){p.classList.remove('is-picked')},1400);}catch(err){logSwallowed('pricePick',err)}try{openTradeSheet()}catch(err){logSwallowed('pricePick',err)}});document.querySelectorAll('.collapsible-header').forEach(function(h){h.addEventListener('click',function(e){if(e.target.closest('button'))return;this.closest('.collapsible-card').classList.toggle('collapsed')})});setTimeout(autoPull,300);setTimeout(doRebalance,500);showFirstTimeGuide()}catch(e){console.error(e);reportError('boot: '+((e&&e.message)||e),(e&&e.stack)||'');document.body.innerHTML='<div style="padding:32px 20px;max-width:440px;margin:0 auto;font:15px/1.7 -apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;color:#17211b"><h2 style="font-size:18px;margin:0 0 10px">页面启动失败了</h2><p style="margin:0 0 14px;color:#6e7771">你的本地数据仍然保存在这台设备上，没有被清除。可以先点“重新加载”；若仍然失败，用“复制诊断信息”把详情发给开发者。</p><pre style="overflow:auto;padding:12px;border-radius:10px;background:#f3f5f2;color:#6e7771;font-size:12.5px;line-height:1.5;margin:0 0 16px">'+String((e&&e.message)||e).slice(0,300)+'</pre><div style="display:flex;gap:10px;flex-wrap:wrap"><button onclick="location.reload()" style="flex:1;min-width:120px;min-height:44px;border:0;border-radius:12px;background:#147a4b;color:#fff;font:inherit;font-weight:600;cursor:pointer">重新加载</button><button onclick="copyDiagnostics()" style="flex:1;min-width:120px;min-height:44px;border:1px solid #dfe4df;border-radius:12px;background:#fff;color:#17211b;font:inherit;cursor:pointer">复制诊断信息</button></div></div>'}


  var ht=document.querySelector('#holdBody');if(ht){ht=ht.parentElement.querySelector('thead');if(ht){var cols2=['sym','','','value','pnl','pnlPct',''];ht.style.cursor='pointer';ht.querySelectorAll('th').forEach(function(th){var c2=cols2[th.cellIndex];if(c2===holdSort.col)th.textContent+=' ↓';th.style.userSelect='none'});ht.addEventListener('click',function(e){var th=e.target.closest('th');if(!th)return;var col=cols2[th.cellIndex];if(!col)return;if(holdSort.col===col)holdSort.asc=!holdSort.asc;else{holdSort.col=col;holdSort.asc=false}updatePortfolio();var arr=holdSort.asc?' ↑':' ↓';ht.querySelectorAll('th').forEach(function(h,i){var c2=cols2[i];h.textContent=h.textContent.replace(/ [↑↓]$/,'')+(c2===holdSort.col?arr:'')})})}}
  window.__wealthReady=true;clearTimeout(window.__wealthBootTimer);document.documentElement.classList.remove('boot-slow');var fallback=document.getElementById('bootFallback');if(fallback)fallback.remove();


}


window.addEventListener('DOMContentLoaded',initAll);
function reportError(message,detail){try{var msg=String(message||'unknown').slice(0,300),det=String(detail||'').slice(0,1500);window.__lastError=msg+' | '+det;var key='wealth_err_'+msg.slice(0,60);var last=Number(sessionStorage.getItem(key)||0);if(Date.now()-last<300000)return;sessionStorage.setItem(key,String(Date.now()));fetch('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:APP_BUILD,message:msg,detail:det,ua:navigator.userAgent,ts:Date.now()})}).catch(function(){})}catch(e){logSwallowed("reportError",e)}}
function copyDiagnostics(){try{var info=['版本 '+APP_BUILD,'时间 '+new Date().toISOString(),'URL '+location.href,'UA '+navigator.userAgent,'最近错误 '+(window.__lastError||'无')].join('\n');var fallback=function(){try{prompt('复制以下信息反馈：',info)}catch(e){logSwallowed("copyDiagnostics",e)}};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(info).then(function(){try{showToast('诊断信息已复制')}catch(e){logSwallowed("copyDiagnostics",e)}},fallback)}else fallback()}catch(e){logSwallowed("copyDiagnostics",e)}}
window.addEventListener('error',function(e){reportError((e&&e.message)||'error',(e&&e.error&&e.error.stack)||((e&&e.filename)||'')+':'+((e&&e.lineno)||0))});
window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;reportError('unhandledrejection: '+((r&&r.message)||r),(r&&r.stack)||'')});

document.addEventListener('focusin',function(e){var el=e.target;if(!el||!el.tagName)return;var tg=el.tagName;if(tg!=='INPUT'&&tg!=='SELECT'&&tg!=='TEXTAREA')return;if(el.type==='checkbox'||el.type==='radio'||el.type==='range'||el.type==='file')return;if(window.innerWidth>800)return;clearTimeout(window.__kbScrollT);window.__kbScrollT=setTimeout(function(){try{var r=el.getBoundingClientRect();var vh=window.innerHeight||document.documentElement.clientHeight;if(r.bottom>vh*0.55||r.top<56){el.scrollIntoView({block:'center',behavior:'smooth'})}}catch(err){logSwallowed("copyDiagnostics",err)}},320)},true);
window.addEventListener('DOMContentLoaded',function(){renderSyncHealth();var source=document.getElementById('syncStatus');if(source)new MutationObserver(renderSyncHealth).observe(source,{childList:true,characterData:true,subtree:true})});
if('serviceWorker' in navigator){/* v315：以前"新版接管只提示、不刷新"，实测部署后第一次打开仍是旧版，要再开一次才生效；连着部署几次就会一直卡在旧版。现在自愈：控制本页的 SW 不是这一版 → 自动刷一次；新版接管（controllerchange）→ 也刷一次。最多连刷两次，稳定 6 秒后清零，不会打转。 */var SW_RELOAD_KEY='wealth_sw_reload_v1';var swHadController=!!navigator.serviceWorker.controller;function swIsOldBuild(){try{var c=navigator.serviceWorker.controller;if(!c||!c.scriptURL)return false;return c.scriptURL.indexOf('v='+APP_BUILD.replace(/^v/,''))<0}catch(e){return false}}function swReloadOnce(why){var n=0;try{n=Number(sessionStorage.getItem(SW_RELOAD_KEY)||0)}catch(e){logSwallowed('swReload',e)}if(n>=2)return;try{sessionStorage.setItem(SW_RELOAD_KEY,String(n+1))}catch(e){logSwallowed('swReload',e)}try{console.warn('[wealth] 自动刷新到 '+APP_BUILD+'（'+why+'）')}catch(e){logSwallowed('swReload',e)}location.reload()}navigator.serviceWorker.addEventListener('controllerchange',function(){if(!swHadController)return;swReloadOnce('controllerchange')});setTimeout(function(){try{sessionStorage.removeItem(SW_RELOAD_KEY)}catch(e){logSwallowed('swReload',e)}},6000);navigator.serviceWorker.register('/sw.js?v=334',{updateViaCache:'none'}).then(function(reg){return reg.update()}).then(function(){setTimeout(function(){if(swIsOldBuild())swReloadOnce('stale-controller')},1500)}).catch(function(){})}


/* ===== Toast 通知 ===== */


function formError(msg,fieldId){try{showToast(msg,'err')}catch(e){logSwallowed("formError",e)}if(fieldId){var el=document.getElementById(fieldId);if(el){el.classList.add('is-invalid');setTimeout(function(){el.classList.remove('is-invalid')},1500)}}}
function showToast(msg,type,undoFn){var t=document.getElementById('syncToast');if(!t)return;if(undoFn)pushSoon(60);if(t._undoActive&&!undoFn)return;clearTimeout(t._timer);t.onclick=null;t.style.cursor=undoFn?'default':'';var icon=type==='err'?'\u2715':(undoFn?'\u2715':'\u2713');t._undoActive=!!undoFn;if(undoFn){t.className='sync-toast toast-undo show '+(type||'');t.innerHTML='<span class="toast-icon"></span><span class="toast-msg"></span><button type="button" class="toast-action">\u64a4\u9500</button>';t.querySelector('.toast-icon').textContent=icon;t.querySelector('.toast-msg').textContent=msg;t.querySelector('.toast-action').addEventListener('click',function(ev){ev.stopPropagation();clearTimeout(t._timer);t.className='sync-toast';t._undoActive=false;undoFn();pushSoon(60)});t._timer=setTimeout(function(){t.className='sync-toast';t._undoActive=false},8000)}else{var dur=type==='ok'?3000:2500;t.className='sync-toast show '+(type||'');t.innerHTML='<span class="toast-icon"></span><span class="toast-msg"></span>';t.querySelector('.toast-icon').textContent=icon;t.querySelector('.toast-msg').textContent=msg;t._timer=setTimeout(function(){t.className='sync-toast'},dur)}}function showFirstTimeGuide(){if(readRaw('wealth_first_time'))return;if(!trades.length&&!cashLog.length){setTimeout(function(){var sb=document.getElementById('syncStatus');if(sb&&sb.parentElement){sb.parentElement.insertAdjacentHTML('afterbegin','<div id="ftGuide" style="padding:8px 12px;background:var(--accent-l);border-radius:8px;font-size:11.5px;color:var(--accent);margin-bottom:8px;line-height:1.6;border-left:3px solid var(--accent);">👋 <b>首次使用？</b><br>📂 有备份文件 → 📥 导入<br>☁️ 有云端Token → ⬇ 下载</div>')}},1000)}LS.setItem('wealth_first_time','1')}





function updateHoldCash(){var ts=0,tb=0;trades.forEach(function(t){var a=Math.abs(t.shares)*t.price;if(t.shares<0)ts+=a;else tb+=a});var nc=getNetCash();document.getElementById('hmCash').textContent=fmtFull(nc);document.getElementById('hmDep').textContent=fmtFull((cashLog||[]).reduce(function(s,l){return s+(l.type.indexOf('\u5165\u91d1')>=0?l.amount:0)},0));document.getElementById('hmSel').textContent=fmtFull(ts);document.getElementById('hmBuy').textContent=fmtFull(tb)}document.getElementById('hmDeposit').addEventListener('click',function(){var v=parseFloat(document.getElementById('hmCashAmt').value);if(isNaN(v)||v<=0)return formError('请输入入金金额','hmCashAmt');cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:'入金',amount:v});saveCashLog();document.getElementById('hmCashAmt').value='';addActivity('入金 '+fmtFull(v));refreshCashUI()});document.getElementById('hmWithdraw').addEventListener('click',function(){var v=parseFloat(document.getElementById('hmCashAmt').value),available=getNetCash();if(isNaN(v)||v<=0)return formError('请输入出金金额','hmCashAmt');if(v>available){showToast('可用现金不足：申请 '+fmtFull(v)+'，当前可用 '+fmtFull(available),'err');return}cashBalance-=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:'出金',amount:v});saveCashLog();document.getElementById('hmCashAmt').value='';addActivity('出金 '+fmtFull(v));refreshCashUI()});





var doRebalance=function(){var rows=[];var holdings={};for(var i=0;i<trades.length;i++){var t=trades[i];if(!holdings[t.symbol])holdings[t.symbol]={shares:0,cost:0};holdings[t.symbol].shares+=Number(t.shares)}var totalV=0;for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var v=h.shares*(livePrices[sym]||0);if(v>0){rows.push({sym:sym,shares:h.shares,priced:!!livePrices[sym],value:v});totalV+=v}}updateRebalance(rows,totalV)};


document.body.addEventListener('click',function(e){var btn=e.target.closest('.rb-mode-btn');if(!btn)return;document.querySelectorAll('.rb-mode-btn').forEach(function(b){b.classList.remove('active')});btn.classList.add('active');rebalanceMode=btn.dataset.mode;doRebalance()});


document.getElementById('tradeFilterSym')?.addEventListener('change',function(){updateTradeList()});


document.getElementById('cashFilter')?.addEventListener('change',function(){renderCashLog()});


document.getElementById('btnRebalanceRecalc').addEventListener('click',doRebalance);





document.getElementById('btnClearTrades').addEventListener('click',function(){if(!trades.length)return;showApproval({title:'清空交易记录',message:'将删除本机全部 '+trades.length+' 条交易记录。清空后仍可点击底部提示条撤销。',confirmText:'清空 '+trades.length+' 条',onConfirm:function(){var old=trades.slice();trades=[];saveTrades();updatePortfolio();showToast('🗑️ 已清空 '+old.length+' 笔交易','ok',function(){trades=old.slice();saveTrades();updatePortfolio();showToast('✅ 已恢复 '+old.length+' 笔交易')})}})});





document.getElementById('btnClearCashLog').addEventListener('click',function(){if(!cashLog.length)return;showApproval({title:'清空资金流水',message:'将删除本机全部 '+cashLog.length+' 条资金流水，并把现金余额重置为 0。清空后可点击底部提示条撤销。',confirmText:'清空 '+cashLog.length+' 条',onConfirm:function(){var oldCash=cashLog.slice(),oldBal=cashBalance;cashLog=[];saveCashLog();cashBalance=0;saveCash();refreshCashUI();showToast('🗑️ 已清空 '+oldCash.length+' 条流水','ok',function(){cashLog=oldCash.slice();saveCashLog();cashBalance=oldBal;saveCash();refreshCashUI();showToast('✅ 已恢复资金流水')})}})});





document.getElementById('btnClearActivity').addEventListener('click',function(){var acts=[];try{acts=JSON.parse(readRaw(ACTIVITY_KEY)||'[]')}catch(e){logSwallowed("updateHoldCash",e)}if(!acts.length)return;showApproval({title:'清空操作日志',message:'将删除全部 '+acts.length+' 条操作日志。清空后可点击底部提示条撤销。',confirmText:'清空 '+acts.length+' 条',onConfirm:function(){var old=acts.slice();LS.setItem(ACTIVITY_KEY,'[]');markDirty('activities');renderActivity();showToast('🗑️ 已清空 '+old.length+' 条日志','ok',function(){LS.setItem(ACTIVITY_KEY,JSON.stringify(old));markDirty('activities');renderActivity();showToast('✅ 已恢复操作日志');autoPushDebounce()});autoPushDebounce()}})});







/* ===== 云端同步 ===== */









/* ===== 同步状态追踪 (dirty / cloudTs) — 防止静默覆盖 ===== */
var SYNC_STATE_KEY=KEYS.syncState;
var SYNC_KEYS=SYNC_FIELDS.slice();   // 与 payload 组装共用同一份清单，避免再次漂移
function loadSyncState(){try{var s=JSON.parse(readRaw(SYNC_STATE_KEY)||'{}');s.dirty=s.dirty||{};s.cloudTs=s.cloudTs||{};s.pendingConflicts=Array.isArray(s.pendingConflicts)?s.pendingConflicts:[];s.lastSyncAt=Number(s.lastSyncAt)||0;s.lastSyncErrorAt=Number(s.lastSyncErrorAt)||0;s.lastSyncDirection=s.lastSyncDirection||'';s.lastPushAt=Number(s.lastPushAt)||0;s.lastPullAt=Number(s.lastPullAt)||0;return s}catch(e){return{dirty:{},cloudTs:{},pendingConflicts:[],lastSyncAt:0,lastSyncErrorAt:0,lastSyncDirection:'',lastPushAt:0,lastPullAt:0}}}
function saveSyncState(s){try{LS.setItem(SYNC_STATE_KEY,JSON.stringify(s))}catch(e){logSwallowed("saveSyncState",e)}if(document.readyState!=='loading')renderSyncHealth()}
function recordSyncSuccess(direction,timestamp){try{var s=loadSyncState();s.lastSyncAt=Number(timestamp)||Date.now();s.lastSyncDirection=direction||'check';if(s.lastSyncDirection==='push')s.lastPushAt=s.lastSyncAt;else if(s.lastSyncDirection==='pull')s.lastPullAt=s.lastSyncAt;s.lastSyncErrorAt=0;s.lastSyncError='';s.failStreak=0;saveSyncState(s);renderSyncHealth()}catch(e){logSwallowed("recordSyncSuccess",e)}}
function recordSyncFailure(timestamp,message){try{var s=loadSyncState();s.lastSyncErrorAt=Number(timestamp)||Date.now();s.lastSyncError=String(message||'').slice(0,200);s.failStreak=(Number(s.failStreak)||0)+1;saveSyncState(s);renderSyncHealth()}catch(e){logSwallowed("recordSyncFailure",e)}}
function setSyncConflicts(conflicts){var s=loadSyncState();s.pendingConflicts=Array.from(new Set(conflicts||[]));saveSyncState(s);renderSyncHealth()}
function renderSyncHealth(){var s=loadSyncState();var h=syncHealthSummary(s,{configured:!!(typeof syncCfg!=='undefined'&&syncCfg&&syncCfg.url),keys:SYNC_KEYS,backupAt:Number(readRaw('lastBackupTime'))||0,formatTime:formatHealthTime});renderSyncHealthView(document,h,{state:s,afterRender:updateSyncBanner})}
function markDirty(key){var s=loadSyncState();if(!s.dirty[key]){s.dirty[key]=true;saveSyncState(s)}}
function clearDirty(key){var s=loadSyncState();s.dirty[key]=false;saveSyncState(s)}
function setCloudTs(key,ts){var s=loadSyncState();s.cloudTs[key]=normalizeSyncTs(ts)||Date.now();saveSyncState(s)}
function hasLocalData(key){
  if(key==='trades')return trades.length>0;
  if(key==='cashBalance')return readRaw(CB_KEY)!==null;
  if(key==='cashLog')return cashLog.length>0;
  if(key==='state')return readRaw(LSKEY)!==null;
  if(key==='activities')return(JSON.parse(readRaw(ACTIVITY_KEY)||'[]')).length>0;
  if(key==='optionTrades')return(JSON.parse(readRaw('wealth_options_v2')||'[]')).length>0;
  if(key==='otmSettings')return readRaw('otmSettings')!==null;
  if(key==='exit_portfolio')return readRaw('exit_portfolio')!==null;
  if(key==='watchlist')return readRaw('wealth_watchlist_v1')!==null;
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
  if(key==='activities')return JSON.parse(readRaw(ACTIVITY_KEY)||'[]');
  if(key==='optionTrades')return JSON.parse(readRaw('wealth_options_v2')||'[]');
  if(key==='otmSettings')return JSON.parse(readRaw('otmSettings')||'{"vgt":7,"smh":6}');
  if(key==='exit_portfolio')return readRaw('exit_portfolio')||'';
  if(key==='watchlist')return watchList;
  return undefined;
}
function applyCloudVal(key,val){
  if(key==='trades'){trades=normalizeTrades(val);saveTradesNoPush()}
  else if(key==='cashBalance'){if(typeof val!=='number'||isNaN(val))val=0;cashBalance=val;saveCashNoPush()}
  else if(key==='cashLog'){cashLog=normalizeCashLogs(val);saveCashLogNoPush()}
  else if(key==='state'){state=normalizeState(val);saveStateNoPush()}
  else if(key==='activities'){LS.setItem(ACTIVITY_KEY,JSON.stringify(normalizeActivities(val)))}
  else if(key==='optionTrades'){optionTrades=normalizeOptions(val);LS.setItem('wealth_options_v2',JSON.stringify(optionTrades))}
  else if(key==='otmSettings'){if(typeof val!=='object'||!val)val={vgt:7,smh:6};LS.setItem('otmSettings',JSON.stringify(val));otmSettings=val;updateOtm()}
  else if(key==='exit_portfolio'){LS.setItem('exit_portfolio',val);var ep=document.getElementById('exitPortfolio');if(ep)ep.value=val}
  else if(key==='watchlist'){
    watchList=mergeWatchlist(watchList,val);   // 并集：云端项在前，本地独有的补上，按代码去重
    LS.setItem(WATCH_KEY,JSON.stringify(watchList));
    renderWatch();renderWatchManage();
  }
}
function buildPushData(dirtyOnly){
  var st=loadSyncState();
  return buildSyncPayload({dirtyOnly:!!dirtyOnly,dirty:st.dirty||{},cloudTs:st.cloudTs||{},read:{
    trades:function(){return trades},
    cashBalance:function(){return cashBalance},
    cashLog:function(){return cashLog},
    state:function(){return state},
    activities:function(){return JSON.parse(readRaw(ACTIVITY_KEY)||'[]')},
    optionTrades:function(){return JSON.parse(readRaw(KEYS.options)||'[]')},
    otmSettings:function(){return JSON.parse(readRaw('otmSettings')||'{"vgt":7,"smh":6}')},
    exit_portfolio:function(){return readRaw('exit_portfolio')||''},
    watchlist:function(){return watchList}
  },readPrices:function(){return JSON.parse(readRaw(PRICE_KEY)||'{}')}});
}

/* 退出登录：清掉服务端的会话 cookie，然后回登录页（/login 不走 SW 缓存） */
function logoutNow(){var go=function(){location.replace('/login')};try{fetchWithTimeout('/api/logout',{method:'POST'}).then(go,go)}catch(e){go()}}
/* ===== v305 回退按钮：本地快照 + 24 小时撤销条（纯前端；恢复后走现有同步推回云端） ===== */
var CLEAR_SNAP_KEY='wealth_clear_snapshot_v1',CLEAR_SNAP_TTL=24*60*60*1000;
function readClearSnapshot(){try{var s=JSON.parse(LS.getItem(CLEAR_SNAP_KEY)||'null');if(!s||!s.data||!s.ts)return null;if(Date.now()-s.ts>CLEAR_SNAP_TTL){LS.removeItem(CLEAR_SNAP_KEY);return null}return s}catch(e){return null}}
function hideClearUndoBar(){var b=document.getElementById('clearUndoBar');if(b){if(b._t)clearInterval(b._t);b.remove()}}
function restoreClearSnapshot(){
  var s=readClearSnapshot();
  if(!s){showToast('快照已过期，没有可恢复的数据','err');hideClearUndoBar();return}
  showApproval({title:'撤销清除',message:'把清除前的数据恢复回来，并立即推回云端。\n\n如果清除后你又录了新数据，这段新记录会被覆盖。',confirmText:'确认恢复',danger:false,onConfirm:function(){
    var n=0;Object.keys(s.data).forEach(function(k){try{applyCloudVal(k,s.data[k]);markDirty(k);n+=1}catch(e){logSwallowed("restoreClearSnapshot",e)}});
    try{LS.removeItem(CLEAR_SNAP_KEY)}catch(e){logSwallowed("restoreClearSnapshot",e)}
    try{initTradeIds();updatePortfolio();updateSidebar();renderCashLog();updateAllO();updateOtm();renderActivity()}catch(e){logSwallowed("restoreClearSnapshot",e)}
    hideClearUndoBar();
    showToast('已恢复清除前的数据，正在同步回云端','ok');
    pushSoon(300);
  }});
}
function renderClearUndoBar(){
  var s=readClearSnapshot();
  if(!s){hideClearUndoBar();return}
  var bar=document.getElementById('clearUndoBar');
  if(!bar){bar=document.createElement('div');bar.id='clearUndoBar';bar.className='clear-undo-bar';bar.setAttribute('role','status');document.body.appendChild(bar)}
  bar.innerHTML='<span class="cub-text"></span><button type="button" class="cub-btn" id="clearUndoBtn">撤销</button><button type="button" class="cub-x" id="clearUndoDismiss" aria-label="关闭提示条">×</button>';
  bar.querySelector('.cub-text').textContent='已清除全部数据 · 可撤销';
  bar.querySelector('#clearUndoBtn').addEventListener('click',restoreClearSnapshot);
  /* × 只是把提示条收起来，不删快照 —— 之后还能在「设置 → 数据与备份 → 云端快照」里恢复 */
  bar.querySelector('#clearUndoDismiss').addEventListener('click',hideClearUndoBar);
  var left=Math.max(0,CLEAR_SNAP_TTL-(Date.now()-s.ts));
  var hh=Math.floor(left/3600000),mm=Math.floor(left%3600000/60000);
  bar.querySelector('.cub-text').textContent='已清除全部数据 · 还剩 '+hh+':'+(mm<10?'0':'')+mm+' 可撤销';
  if(bar._t)clearInterval(bar._t);
  bar._t=setInterval(function(){var t=readClearSnapshot();if(!t){hideClearUndoBar();return}var l=Math.max(0,CLEAR_SNAP_TTL-(Date.now()-t.ts));var H=Math.floor(l/3600000),M=Math.floor(l%3600000/60000);var tx=bar.querySelector('.cub-text');if(tx)tx.textContent='已清除全部数据 · 还剩 '+H+':'+(M<10?'0':'')+M+' 可撤销'},30000);
}
setTimeout(renderClearUndoBar,900);
/* v306 方案 B：云端快照列表 —— 清除前由服务端留一份，换设备也能恢复 */
function closeSnapshotSheet(){var s=document.getElementById('snapshotSheet');if(!s)return;var p=s.querySelector('.qa-panel');if(p)p.style.transform='';s.classList.remove('open')}
function confirmRestoreSnapshot(id){
  showApproval({title:'从云端快照恢复',message:'会用这份快照覆盖当前的云端数据，然后重新拉取到本机。\n\n快照之后新录的数据会丢失，请确认。',confirmText:'恢复',danger:false,holdMs:3000,onConfirm:function(){
    fetchWithTimeout('/api/snapshots/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(id)})}).then(function(r){return r.json().catch(function(){return{}})}).then(function(j){
      if(!j||!j.ok){showToast('恢复失败：'+((j&&j.error)||'未知错误'),'err');return}
      closeSnapshotSheet();
      showToast('已从云端快照恢复，正在重新拉取…','ok');
      setTimeout(function(){location.reload()},900);
    }).catch(function(){showToast('恢复失败，请稍后再试','err')});
  }});
}
function openSnapshotSheet(){
  var sh=document.getElementById('snapshotSheet');
  if(!sh){
    sh=document.createElement('div');sh.id='snapshotSheet';sh.className='qa-sheet';
    sh.innerHTML='<div class="qa-panel"><div class="qa-title">云端快照</div><div class="snapshot-list" id="snapshotList"></div><button type="button" class="btn btn-out" id="snapshotClose" style="width:100%;margin-top:12px;">关闭</button></div>';
    sh.addEventListener('click',function(e){if(e.target===sh)closeSnapshotSheet()});
    sh.querySelector('#snapshotClose').addEventListener('click',closeSnapshotSheet);
    try{enableSheetDrag(sh.querySelector('.qa-panel'),closeSnapshotSheet)}catch(e){logSwallowed("openSnapshotSheet",e)}
    document.body.appendChild(sh);
  }
  sh.classList.add('open');
  var list=sh.querySelector('#snapshotList');
  var tip=document.createElement('div');tip.className='table-empty';tip.textContent='正在读取…';
  list.textContent='';list.appendChild(tip);
  fetchWithTimeout('/api/snapshots?limit=5').then(function(r){return r.ok?r.json():null}).then(function(j){
    list.textContent='';
    if(!j||!j.ok){var e1=document.createElement('div');e1.className='table-empty';e1.textContent='读取失败，请检查登录状态';list.appendChild(e1);return}
    if(!j.snapshots.length){var e2=document.createElement('div');e2.className='table-empty';e2.textContent='还没有云端快照 · 点「清除所有数据」时会自动留一份';list.appendChild(e2);return}
    j.snapshots.forEach(function(s){
      var sum={};try{sum=JSON.parse(s.summary||'{}')}catch(e){logSwallowed("openSnapshotSheet",e)}
      var when=new Date(s.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      var row=document.createElement('div');row.className='snapshot-row';
      var meta=document.createElement('div');meta.className='snapshot-meta';
      var b=document.createElement('b');b.textContent=when;
      var small=document.createElement('small');small.textContent=(sum.trades||0)+' 笔交易 · '+(sum.options||0)+' 个期权 · 现金 '+fmtFull(Number(sum.cash)||0);
      meta.appendChild(b);meta.appendChild(small);
      var btn=document.createElement('button');btn.type='button';btn.className='btn btn-out btn-sm';btn.textContent='恢复';
      btn.addEventListener('click',function(){confirmRestoreSnapshot(s.id)});
      row.appendChild(meta);row.appendChild(btn);list.appendChild(row);
    });
  }).catch(function(){list.textContent='';var e3=document.createElement('div');e3.className='table-empty';e3.textContent='读取失败，请稍后再试';list.appendChild(e3)});
}
(function(){var b=document.getElementById('btnCloudSnapshots');if(b)b.addEventListener('click',openSnapshotSheet)})();
function clearAllData(){
  var cfg=syncCfg||{}; var base=(cfg.url||location.origin).replace(/\/$/,'');
  /* v302：不再用 cfg.token 判断"有没有云端"——token 已退役，登录后走的是会话 cookie。
     旧写法让非主账号（localStorage 里没有历史 token）走进"只清本机"分支，
     云端数据原样保留，重载后又被拉回来，表现就是"点了没反应"。 */
  showApproval({title:'清除全部数据',message:'确定清除本地与云端的全部投资数据？\n\n请先确认已导出完整备份。云端清除成功后才会清理本机。\n\n（误删可在 24 小时内用底部横条一键撤销）',confirmText:'清除全部',holdMs:3000,onConfirm:function(){
  var empty={trades:[],cashBalance:0,cashLog:[],state:{},activities:[],optionTrades:[],otmSettings:{},exit_portfolio:'',prices:{}};
  /* v305 方案A：先留一份快照，万一误删能一键撤回（24 小时有效） */
  try{var snap={ts:Date.now(),data:{}};SYNC_KEYS.forEach(function(k){try{snap.data[k]=localValOf(k)}catch(e){logSwallowed("clearAllData",e)}});LS.setItem(CLEAR_SNAP_KEY,JSON.stringify(snap))}catch(e){logSwallowed("clearAllData",e)}
  var clearLocal=function(){
    ['wealth_trades_v2','wealth_cash_v2','wealth_cashlog_v2','wealth_dashboard_v2','wealth_activity_v1','wealth_options_v2','otmSettings','exit_portfolio','wealth_prices_v2','wealth_sync_state','lastBackupTime','wealth_alert_snooze_v1'].forEach(function(k){try{removeKey(k)}catch(e){logSwallowed("clearAllData",e)}});
    location.reload();
  };
  showToast('正在清除云端数据');
  var clrHeaders={'Content-Type':'application/json'};if(cfg.token)clrHeaders['X-Auth-Token']=cfg.token;
  // __snapshotBefore：让云端先把"清除前"的样子存成一份快照（方案 B），再落空值
  fetchWithTimeout(base+'/api/sync',{method:'POST',headers:clrHeaders,body:JSON.stringify(Object.assign({__snapshotBefore:true},empty))}).then(function(r){
    // 没有云端后端（静态部署）→ 只清本机；401 说明登录失效，此时绝不能清本机，
    // 否则云端数据会在下次进入时被拉回来，用户会以为"清了个寂寞"。
    if(r.status===404)return{ok:true,noCloud:true};
    return r.json().catch(function(){return{}}).then(function(body){
      if(r.ok&&(!body||body.ok!==false))return body||{ok:true};
      var err=new Error(r.status===401?'登录状态已失效，请重新登录后再清除（数据未改动）':((body&&body.error)||('HTTP '+r.status)));
      err.status=r.status;throw err;
    });
  }).then(function(){clearLocal()}).catch(function(e){showToast('云端清除失败，本地数据已保留：'+e.message,'err')});
  }});
}

function showSyncConflict(conflicts,pendingCloud){
  setSyncConflicts(conflicts);
  openConflictModal({doc:document,conflicts:conflicts,labels:SYNC_KEY_LABELS,
    onAllLocal:function(modal){var payload={};try{SYNC_KEYS.forEach(function(k){payload[k]=localValOf(k)})}catch(e){logSwallowed("showSyncConflict",e)}showBusyToast('正在以本机数据覆盖云端');syncFetchWithoutHealth('POST',payload).then(function(){conflicts.forEach(function(k){try{clearDirty(k)}catch(e){logSwallowed("showSyncConflict",e)}});var st=loadSyncState();st.pendingConflicts=[];st.lastSyncErrorAt=0;st.lastSyncError='';st.failStreak=0;saveSyncState(st);setSyncConflicts([]);modal.remove();showToast('已用本机数据覆盖云端','ok');renderSyncHealth()}).catch(function(e){showToast('上传失败：'+(e&&e.message?e.message:'未知错误'),'err')})},
    onConfirm:function(modal,picks){var applied=[],kept=[];conflicts.forEach(function(k){if(picks[k]==='cloud'){applyCloudVal(k,pendingCloud[k]);clearDirty(k);applied.push(k)}else{markDirty(k);kept.push(k)}});setSyncConflicts([]);modal.remove();if(applied.length){initTradeIds();updatePortfolio();updateSidebar();renderCashLog();updateAllO();updateOtm();showToast('已使用云端: '+applied.map(function(k){return SYNC_KEY_LABELS[k]||k}).join(', '),'ok');autoPushDebounce()}if(kept.length)pushKeysForce(kept,'已用本机数据覆盖云端');else if(!applied.length)showToast('已保留本地数据','ok')}})
}

function stableStr(v){if(Array.isArray(v))return '['+v.map(stableStr).join(',')+']';if(v&&typeof v==='object'){return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+stableStr(v[k])}).join(',')+'}'}return JSON.stringify(v)}var autoPushTimer=null;function autoPushDebounce(){if(!syncCfg||!syncCfg.url)return;clearTimeout(autoPushTimer);autoPushTimer=setTimeout(autoPush,700)}
function pushSoon(delay){if(!syncCfg||!syncCfg.url)return;clearTimeout(autoPushTimer);autoPushTimer=setTimeout(autoPush,delay===undefined?60:delay)}
function pushNow(){pushSoon(0)}
var syncBarTimer=null;
function setSyncBar(state,text){clearTimeout(syncBarTimer);var r=applySyncBar(document,state,text);if(r.holdMs)syncBarTimer=setTimeout(function(){setSyncBar('')},r.holdMs)}
function syncClockText(){return syncClockTime()}
function pushPendingSoon(delay){try{if(pendingDirtyKeys(loadSyncState(),SYNC_KEYS).length>0)pushSoon(delay)}catch(e){logSwallowed("pushPendingSoon",e)}}
function pushedKeysOf(data){return pushedKeysList(data,SYNC_KEYS)}
function pushKeysForce(keys,label){if(!keys||!keys.length)return;if(!syncCfg||!syncCfg.url)return;var payload={};keys.forEach(function(k){payload[k]=localValOf(k)});setSyncBar('busy','正在覆盖云端…');syncFetchWithoutHealth('POST',payload).then(function(r){var st=loadSyncState();keys.forEach(function(k){clearDirty(k);if(r&&r.ts)setCloudTs(k,r.ts)});st.pendingConflicts=[];st.lastSyncErrorAt=0;st.lastSyncError='';st.failStreak=0;saveSyncState(st);setSyncConflicts([]);setSyncBar('ok','已覆盖云端 '+syncClockText());showToast(label||'已用本机数据覆盖云端','ok')}).catch(function(e){setSyncBar('err','覆盖失败：'+((e&&e.message)||'未知错误'))})}
function healPushConflict(data){var sent=pushedKeysOf(data);if(!syncCfg||!syncCfg.url){autoPull();return}setSyncBar('busy','正在核对…');syncFetchWithoutHealth('GET').then(function(r){if(!r||!r.data){setSyncBar('');autoPull();showToast('云端已有更新，请确认冲突','err');return}var meta=r.meta||{},st=loadSyncState();
var heal=planConflictHeal({sentKeys:sent,cloudData:r.data,meta:meta,state:st,normalizeTs:normalizeSyncTs,equal:function(key){return syncContentEqual(key,localValOf(key),r.data[key],normalizeState)}});
var diff=heal.diff;st.dirty=heal.dirty;st.cloudTs=heal.cloudTs;
  saveSyncState(st);if(diff.length){setSyncBar('');autoPull();showToast('云端已有更新，请确认冲突','err')}else{setSyncBar('ok','已对齐云端 '+syncClockText());showToast('云端内容与本机一致，已自动对齐','ok')}}).catch(function(){setSyncBar('');autoPull();showToast('云端已有更新，请确认冲突','err')})}
function flushDirtyOnHide(){try{if(!syncCfg||!syncCfg.url)return;var st=loadSyncState();if(!pendingDirtyKeys(st,SYNC_KEYS).length)return;var payload=buildPushData(true);delete payload.__expectedVersions;var body=JSON.stringify(payload);if(!body||body.length>60000)return;fetch((syncCfg.url||location.origin).replace(/\/$/,'')+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Auth-Token':syncCfg.token},body:body,keepalive:true}).catch(function(){})}catch(e){logSwallowed("flushDirtyOnHide",e)}}

(function initPendingPush(){var run=function(){pushPendingSoon(1500)};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run)}else{run()}})();

/* v316：网络恢复（VPN 重连、切回 WiFi）时自动补一次同步，不用等下一次打开 */
window.addEventListener('online',function(){try{autoPull();pushPendingSoon(300)}catch(e){logSwallowed("syncOnline",e)}});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!document.getElementById('conflictModal')){autoPull();pushPendingSoon(1200)}else if(document.visibilityState==='hidden'){flushDirtyOnHide()}});window.addEventListener('pagehide',flushDirtyOnHide);var pushInFlight=false,pushQueued=false;
function autoPush(){if(pushInFlight){pushQueued=true;return}var data=buildPushData(true);if(shouldSkipPush(data,SYNC_KEYS))return;pushInFlight=true;var finish=function(){pushInFlight=false;if(pushQueued){pushQueued=false;setTimeout(autoPush,60)}};syncPushImpl(data).then(finish,finish)}/* v312 撤掉"先问版本号再拉全文"的两段式：数据只有 5KB，省下的下载量抵不过多出来的一轮往返（实测慢网络下会把同步拖到 20 秒以上）。现在打开就是一次 GET，和以前一样。 */function autoPull(){if(!syncCfg.url)return;syncFetch('GET').then(function(r){if(!r.data)return;var meta=r.meta||{};var ss=loadSyncState();var conflicts=[],pendingCloud={},pulled=[];var plan=planPullSync({keys:SYNC_KEYS,cloudData:r.data,meta:meta,state:ss,normalizeTs:normalizeSyncTs,hasCloud:hasCloudData,hasLocal:hasLocalData,isEmptyCloud:isEmptyCloudVal,equal:function(key){return syncContentEqual(key,localValOf(key),r.data[key],normalizeState)}});
var conflicts=plan.conflicts,pendingCloud=plan.pendingCloud,pulled=plan.applies;
plan.applies.forEach(function(key){applyCloudVal(key,r.data[key])});
ss.dirty=plan.dirty;ss.cloudTs=plan.cloudTs;saveSyncState(ss);
  if(r.data.prices){var lp=JSON.parse(readRaw(PRICE_KEY)||'{}');for(var k in r.data.prices){var cd=r.data.prices[k];if(!cd)continue;if(!lp[k]||!cd.time||cd.time>=(lp[k].time||0)){lp[k]=cd;livePrices[k]=cd.price}}LS.setItem(PRICE_KEY,JSON.stringify(lp))}initTradeIds();updatePortfolio();updateSidebarPrices();updateSidebar();renderCashLog();updateAllO();renderActivity();if(pulled.length){var _sl={trades:'交易记录',cashBalance:'现金余额',cashLog:'资金流水',state:'投资参数',activities:'操作日志',optionTrades:'期权持仓',otmSettings:'OTM设置',exit_portfolio:'退出策略',watchlist:'观察列表'};showToast('☁️ 已从云端同步：'+pulled.map(function(k){return _sl[k]||k}).join('·'),'ok')};if(conflicts.length)showSyncConflict(conflicts,pendingCloud)}).catch(function(){})}function saveTradesNoPush(){try{LS.setItem(TRADE_KEY,JSON.stringify(trades))}catch(e){console.error("保存交易记录失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveCashNoPush(){try{LS.setItem(CB_KEY,cashBalance.toString())}catch(e){console.error("保存现金余额失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveCashLogNoPush(){try{LS.setItem(CLOG_KEY,JSON.stringify(cashLog))}catch(e){console.error("保存现金流水失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function saveStateNoPush(){try{LS.setItem(LSKEY,JSON.stringify(state))}catch(e){console.error("保存投资参数失败:",e);showToast("保存失败，请导出数据后清理旧记录","err")}}function syncPushImpl(data){return syncFetch('POST',data).then(function(r){var el=document.getElementById('syncStatus');if(el){el.textContent='已上传 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});el.style.color='var(--accent)'}Object.keys(data).forEach(function(k){if(SYNC_KEYS.indexOf(k)>=0){clearDirty(k);setCloudTs(k,(r.ts||Date.now()))}})}).catch(function(error){if(error&&error.status===409){healPushConflict(data);return}/* 其它失败（断网 / 401 / 429 / 5xx）以前完全静默，用户会以为"已经同步了"；现在明确提示，dirty 保留等重试 */var st=syncFailureText(error,(typeof navigator!=='undefined'&&navigator.onLine===false));try{setSyncBar('err',st)}catch(e){logSwallowed("syncPushImpl",e)}try{if(!window.__syncErrAt||Date.now()-window.__syncErrAt>60000){window.__syncErrAt=Date.now();showToast(st,'err')}}catch(e){logSwallowed("syncPushImpl",e)}})} var SYNC_KEY=KEYS.syncConfig;var syncCfg=loadSyncCfg();
/* token 退役：登录后就用自己这台的站点同步，不需要再填任何东西 */
if(!syncCfg.url){syncCfg.url=location.origin;try{saveSyncCfg()}catch(e){logSwallowed("defaultSyncCfg",e)}}function loadSyncCfg(){return parseSyncConfig(readRaw(SYNC_KEY))}function saveSyncCfg(){try{LS.setItem(SYNC_KEY,JSON.stringify(syncCfg))}catch(e){console.error("保存同步配置失败:",e)}}/* v316：同步请求硬超时 —— 网络黑洞时（VPN 掉线 / SNI 被拦）fetch 可能永远不返回，
   没有超时的话状态条就永远等不到结局，"连不上"会被翻译成一直"正在下载"。
   15 秒足够慢网络跑完，超时按失败处理（AbortError 由包装层翻译成人话）。 */
function syncFetch(method,body,suffix){var base=syncCfg.url||location.origin;var headers={'Content-Type':'application/json'};if(syncCfg.token)headers['X-Auth-Token']=syncCfg.token;var ctrl=null;try{ctrl=new AbortController()}catch(e){logSwallowed("syncFetch",e)}var opts={method:method,headers:headers,body:body?JSON.stringify(body):undefined};var timer=0;if(ctrl){opts.signal=ctrl.signal;timer=setTimeout(function(){try{ctrl.abort()}catch(e){logSwallowed("syncFetch",e)}},SYNC_TIMEOUT_MS)}var stopTimer=function(){if(timer){clearTimeout(timer);timer=0}};return fetch(base.replace(/\/$/,'')+'/api/sync'+(suffix||''),opts).then(function(r){if(!r.ok)return r.json().then(function(body){var err=new Error(body.error||('HTTP '+r.status));err.status=r.status;err.body=body;throw err});return r.json()}).then(function(v){stopTimer();return v},function(e){stopTimer();throw e})}
function syncPush(){var data=buildPushData(false);syncFetch('POST',data).then(function(r){Object.keys(data).forEach(function(k){if(SYNC_KEYS.indexOf(k)>=0){clearDirty(k);setCloudTs(k,(r.ts||Date.now()))}});var el=document.getElementById('syncStatus');el.textContent='已上传 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});el.style.color='var(--accent)';showToast('已上传到云端','ok')}).catch(function(e){var el=document.getElementById('syncStatus');el.textContent='失败: '+e.message;el.style.color='var(--red)';if(e&&e.status===409){healPushConflict(data)}else{showToast('同步失败: '+e.message,'err')}})}function syncPull(){var ss=loadSyncState();var dirtyN=SYNC_KEYS.filter(function(k){return ss.dirty[k]}).length;if(dirtyN>0){if(!confirm('本地有 '+dirtyN+' 项未同步改动会被云端覆盖,确定?'))return}syncFetch('GET').then(function(r){if(!r.data)throw new Error('空响应');SYNC_KEYS.forEach(function(k){if(r.data[k]!==undefined&&r.data[k]!==null)applyCloudVal(k,r.data[k])});if(r.data.prices){var lp=JSON.parse(readRaw(PRICE_KEY)||'{}');for(var k in r.data.prices){var cd=r.data.prices[k];if(!cd)continue;if(!lp[k]||!cd.time||cd.time>=(lp[k].time||0)){lp[k]=cd;livePrices[k]=cd.price}}LS.setItem(PRICE_KEY,JSON.stringify(lp))}SYNC_KEYS.forEach(function(k){clearDirty(k)});showToast('已从云端同步,刷新中...','ok');setTimeout(function(){location.reload()},600)}).catch(function(e){var el=document.getElementById('syncStatus');el.textContent='失败: '+e.message;el.style.color='var(--red)';showToast('同步失败: '+e.message,'err')})}document.getElementById('btnSyncPush').addEventListener('click',syncPush);document.getElementById('btnSyncPull').addEventListener('click',syncPull);


var syncFetchWithoutHealth=syncFetch;
syncFetch=function(method,body,suffix){var ms=document.getElementById('msSyncText'),host=ms&&ms.closest('.ms-sync');var clearSpin=function(){if(host)host.classList.remove('is-syncing')};if(host)host.classList.add('is-syncing');if(typeof navigator!=='undefined'&&navigator.onLine===false){setSyncBar('err','当前离线 · 数据已存本机')}else{setSyncBar('busy',method==='GET'?'正在下载…':'正在上传…')};var spinTimer=setTimeout(clearSpin,12000);/* v316：删掉 v314 的 20 秒 stall 兜底。它只改文案、不结束状态，而 busy 态的自动收起是 0 ——
   于是"连不上云端"被翻译成一条永久挂在屏幕上的提示。底层已有 15 秒硬超时，兜底不再需要。 */var done=function(){clearTimeout(spinTimer);clearSpin()};try{return syncFetchWithoutHealth(method,body,suffix).then(function(result){if(method!=='GET'&&result&&result.ts&&body){try{Object.keys(body).forEach(function(k){if(k!=='__expectedVersions')setCloudTs(k,result.ts)})}catch(e){logSwallowed("syncPull",e)}}setSyncBar('ok','已同步 '+syncClockText());done();recordSyncSuccess(method==='GET'?'pull':'push',Date.now());return result}).catch(function(error){done();if(error&&console&&console.warn)console.warn('[sync]',error.message);/* v316：把"连不上"和"云端拒绝"分开说。超时/离线都指向网络，用户能自己处理；其它才是真的同步失败。 */var offline=(typeof navigator!=='undefined'&&navigator.onLine===false);var failText=syncFailureText(error,offline);if(error&&error.status===409){setSyncBar('busy','正在核对…')}else{setSyncBar('err',failText)};recordSyncFailure(Date.now(),error&&error.message);throw error})}catch(e){done();throw e}};
/* 令牌输入框已移除，这里不再监听 */
/* v242：数据健康整块可点 → 直达同步设置（原来要经过 设置 → 云端同步 → 连接配置 三层） */
/* v242：数据健康整块可点 → 直达同步设置（DOM 细节在 sync-view.js） */
bindHealthJump({doc:document,win:window,desktopOpen:function(){try{openMobileSettings()}catch(e){logSwallowed("initHealthJump",e)}try{openAdvancedSettings('sync')}catch(e){logSwallowed("initHealthJump",e)}}});





// ---- Schwab CSV parser ----


/* ===== CSV 导入 ===== */




function parseSchwabCSV(text){
  var parsed=parseSchwabCSVIn(text,{symbols:ETF_SYMS,existingTrades:trades});
  parsed.rows.forEach(function(r){r.id=tradeIdCounter++;trades.push(r)});
  return {imported:parsed.imported,skipped:parsed.skipped};
}





function doCSVImport(file){


  var reader=new FileReader();


  reader.onload=function(){


    try{


      var res=parseSchwabCSV(reader.result);
      /* v319：被跳过的行要说清楚（标的不在核心仓 / 价格无效 / 与已有记录重复…），
         以前只报"已导入 N 笔"，用户根本不知道有行没进来 */
      var skippedText=csvSkipSummary(res.skipped);


      if(res.imported>0){


        trades.sort(function(a,b){return String(a.date).localeCompare(String(b.date))});


        saveTrades();initTradeIds();updatePortfolio();updateSidebar();updateSidebarPrices();


        showToast('已导入 '+res.imported+' 笔交易'+(skippedText?'（'+skippedText+'）':''),'ok');


      }else showToast(skippedText?('没有可导入的交易（'+skippedText+'）'):'未识别有效交易，需 Schwab CSV 格式','err');


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
function loadOpt(){try{var raw=JSON.parse(readRaw(KEYS.options)||"[]"),opts=normalizeOptions(raw);if(stableStr(raw)!==stableStr(opts))LS.setItem(KEYS.options,JSON.stringify(opts));return opts}catch(e){return[]}}
function saveOpt(){optionTrades=normalizeOptions(optionTrades);LS.setItem(KEYS.options,JSON.stringify(optionTrades));markDirty('optionTrades');autoPushDebounce()}
optionTrades=loadOpt();
function updateAllO(){if(!trades||!trades.forEach||!livePrices)return;var nowInstant=new Date();optionTrades=loadOpt();var vsh=0,ssh=0;trades.forEach(function(t){if(t.symbol==="VGT")vsh+=t.shares;if(t.symbol==="SMH")ssh+=t.shares});var vVGTcalls=optionTrades.filter(function(o){return o.sym==="VGT"&&o.type==="CALL"&&isActiveOption(o,nowInstant)}).reduce(function(s,o){return s+(o.contracts||1)},0);var vSMHcalls=optionTrades.filter(function(o){return o.sym==="SMH"&&o.type==="CALL"&&isActiveOption(o,nowInstant)}).reduce(function(s,o){return s+(o.contracts||1)},0);var vc=document.getElementById("ov");if(vc)vc.textContent=vsh+" 股";var cv=document.getElementById("ocv");if(cv){cv.textContent="可卖 "+Math.max(0,Math.floor(vsh/100)-vVGTcalls)+" 张CALL"}var vd=document.getElementById("vd");if(vd)vd.textContent=ssh+" 股";var cs=document.getElementById("ocs");if(cs){cs.textContent="可卖 "+Math.max(0,Math.floor(ssh/100)-vSMHcalls)+" 张CALL"}var re=document.getElementById("ore");if(re){var thisM=marketDate(nowInstant).slice(0,7);optionTrades=loadOpt();var m=optionTrades.filter(function(o){return o.added&&o.added.slice(0,7)===thisM}).reduce(function(s,o){return s+(o.premium||0)*(o.contracts||1)},0);re.textContent=fmtFull(m)}renderOpt();updatePnLOpt();updateOptStatus();}var showArchivedOpt=false;function toggleArchivedOpt(){showArchivedOpt=!showArchivedOpt;renderOpt()}
function renderOpt(){
var el=document.getElementById("holdingsBody");if(!el)return;
optionTrades=loadOpt();var nowInstant=new Date();
/* 被行权概率并入持仓表（v329）：原先"被行权概率"卡里另有一张活跃持仓表，和这张完全重复。
   现在只在这里算一次，按 option.id 映射；期权链没到就整列不显示。 */
var optProbById={};
try{
  ['VGT','SMH'].forEach(function(sym){
    var ch=chainFor(sym);if(!ch)return;
    optionProbabilities(ch,optionTrades,{chains:optionChains}).forEach(function(r){if(r.prob!=null)optProbById[r.id]=r.prob});
  });
}catch(e){logSwallowed("optProbById",e)}
if(!optionTrades.length){el.innerHTML='<tr><td colspan="8" style="padding:12px 0">'+emptyStateHTML({title:'暂无期权持仓',hint:'录入一笔 Covered Call 后会显示在这里',compact:true})+'</td></tr>';return}
var archivedCount=optionTrades.filter(function(o){return o.archived}).length;
var visible=showArchivedOpt?optionTrades.slice():optionTrades.filter(function(o){return !o.archived});
if(!visible.length&&archivedCount>0){showArchivedOpt=true;visible=optionTrades.slice()}
var sorted=visible.sort(function(a,b){if(!a.settled&&b.settled)return -1;if(a.settled&&!b.settled)return 1;var ae=a.expiry||'9999',be=b.expiry||'9999';if(ae!==be)return ae.localeCompare(be);return a.type==='CALL'?-1:1});
var rows=sorted.map(function(o){var i=optionTrades.indexOf(o);var oid=o.id;
var exp=o.expiry||"",cp=livePrices[o.sym]||0,st=optionRowStatus(o,{now:nowInstant,spot:cp}),isExpired=st.expired,daysLeft=st.days,status="<span class=\"opt-status is-"+st.statusKind+"\">"+st.statusText+"</span>"+(optProbById[o.id]!=null?"<span class=\"opt-prob\">被行权 "+fmtProb(optProbById[o.id])+"</span>":""),distD=st.distancePct;var distHtml=distD==null?"":"<span class=\"opt-dist "+(distD>=0?"is-otm":"is-itm")+"\">距现价 "+(distD>=0?"+":"")+distD.toFixed(1)+"%</span>";return "<tr class=\"opt-row"+(isExpired?" is-done":"")+"\"><td data-cell=\"sym\" class=\"opt-sym\"><b>"+o.sym+"</b></td><td data-cell=\"type\"><span class=\"opt-type "+(o.type==="CALL"?"is-call":"is-put")+"\">"+o.type+"</span></td><td data-cell=\"strike\" class=\"opt-strike\">$"+o.strike.toFixed(2)+"</td><td data-cell=\"premium\">"+fmtFull(o.premium||0)+"</td><td data-cell=\"contracts\">"+(o.contracts||1)+"张</td><td data-cell=\"expiry\" class=\"opt-expiry\">"+exp+"</td><td data-cell=\"status\">"+status+"</td><td data-cell=\"actions\" class=\"opt-foot\">"+distHtml+"<span class=opt-actions><button class=\"opt-del\" onclick=delOpt(\x27"+oid+"\x27)>"+(o.archived?"恢复":o.settled?"归档":"X")+"</button>"+(st.canAssign?"<button class=\"opt-assign\" onclick=assignOpt(\x27"+oid+"\x27)>行权</button>":"")+(st.canSettle?"<button class=\"opt-settle\" onclick=settleOpt(\x27"+oid+"\x27)>结算</button>":"")+"</span></td></tr>"
;}).join("");
if(archivedCount>0){rows+="<tr><td colspan=8 style=text-align:center;padding:4px><button class=\"opt-toggle\" onclick='toggleArchivedOpt()'>"+(showArchivedOpt?"📁 隐藏已归档":"📁 显示已归档 "+archivedCount+" 个")+"</button></td></tr>"}el.innerHTML=rows}
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

/**
 * 底部面板的"下拉关闭"：跟手位移，松手时超过阈值或快速下滑就关。
 * 原生 sheet 的手感基本就靠这一条 —— 之前只能点遮罩或按钮。
 */
function enableSheetDrag(panel, onClose){
  if(!panel||panel.dataset.dragReady)return;
  panel.dataset.dragReady='1';
  var startY=0,dy=0,active=false,t0=0;
  function reset(){
    panel.style.transition='';
    panel.style.transform='';
  }
  panel.addEventListener('pointerdown',function(e){
    // 面板里可点的控件不参与拖拽（否则点按钮会变成拖拽）
    if(e.target.closest('input,textarea,button,select,a,label'))return;
    active=true;startY=e.clientY;dy=0;t0=Date.now();
    panel.style.transition='none';
  });
  panel.addEventListener('pointermove',function(e){
    if(!active)return;
    dy=Math.max(0,e.clientY-startY);
    panel.style.transform='translateY('+dy+'px)';
  });
  function end(){
    if(!active)return;
    active=false;
    var fast=(Date.now()-t0)<450;
    if(dy>110||(fast&&dy>56)){panel.style.transform='translateY(102%)';onClose();}
    else reset();
  }
  panel.addEventListener('pointerup',end);
  panel.addEventListener('pointercancel',end);
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
  /* v321：记住弹层打开前的焦点，关闭后还回去 —— 否则键盘/读屏用户关掉弹层就"失位"了 */
  var prevFocus=document.activeElement;
  function close(){
    if(closed)return;
    closed=true;
    modal.classList.remove('show');
    if(modal.parentNode)modal.parentNode.removeChild(modal);
    document.removeEventListener('keydown',onKey);
    try{if(prevFocus&&prevFocus!==document.body&&prevFocus.isConnected&&typeof prevFocus.focus==='function')prevFocus.focus()}catch(e){logSwallowed("showApproval",e)}
  }
  function onKey(e){
    if(e.key==='Escape'){e.preventDefault();close();return}
    if(e.key==='Tab'){
      /* v321：焦点陷阱 —— 别让 Tab 跑到背后的页面上（键盘用户会看不见自己在操作谁） */
      var items=Array.prototype.slice.call(modal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function(el){return !el.disabled});
      if(!items.length)return;
      var first=items[0],last=items[items.length-1],active=document.activeElement;
      if(e.shiftKey&&active===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&active===last){e.preventDefault();first.focus()}
      else if(items.indexOf(active)<0){e.preventDefault();first.focus()}
    }
  }
  cancelBtn.addEventListener('click',close);
  if(o.holdMs){
    /* v305 方案C：危险操作要按住 holdMs 才生效，手滑点一下不会执行 */
    var sec=Math.round(o.holdMs/1000);
    okBtn.textContent=(o.confirmText||'确认')+'（长按 '+sec+' 秒）';
    var held=false,holdTimer=null,raf=null,startAt=0;
    var resetHold=function(){held=false;startAt=0;if(holdTimer){clearTimeout(holdTimer);holdTimer=null}if(raf){cancelAnimationFrame(raf);raf=null}okBtn.style.setProperty('--hold-pct','0%');okBtn.classList.remove('is-holding')};
    var tick=function(){if(!held)return;var p=Math.min(1,(Date.now()-startAt)/o.holdMs);okBtn.style.setProperty('--hold-pct',(p*100).toFixed(1)+'%');if(p<1)raf=requestAnimationFrame(tick)};
    var fire=function(){resetHold();close();if(typeof o.onConfirm==='function')o.onConfirm()};
    var startHold=function(e){if(e&&e.preventDefault)e.preventDefault();held=true;startAt=Date.now();okBtn.classList.add('is-holding');okBtn.style.setProperty('--hold-pct','0%');clearTimeout(holdTimer);holdTimer=setTimeout(fire,o.holdMs);raf=requestAnimationFrame(tick)};
    okBtn.addEventListener('pointerdown',startHold);
    okBtn.addEventListener('pointerup',resetHold);
    okBtn.addEventListener('pointercancel',resetHold);
    okBtn.addEventListener('pointerleave',resetHold);
    /* v321：键盘也必须"按住"——以前是 keydown 阻止默认 + keyup 直接 fire()，
       等于键盘一次按键就执行了本该长按的破坏性操作（读屏用户常用 Enter/Space 激活按钮）。 */
    okBtn.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Enter'){if(!held)startHold(e)}});
    okBtn.addEventListener('keyup',function(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();resetHold()}});
  }else{
    okBtn.addEventListener('click',function(){close();if(typeof o.onConfirm==='function')o.onConfirm()});
  }
  modal.addEventListener('click',function(e){if(e.target===modal)close()});
  enableSheetDrag(modal.querySelector('.ds-approval-card'),close);
  document.addEventListener('keydown',onKey);
  document.body.appendChild(modal);
  haptic('warning');
  requestAnimationFrame(function(){modal.classList.add('show')});
  cancelBtn.focus();
  return modal;
}

var dsSearchQuery="";
function applyTableSearch(){var q=dsSearchQuery.trim().toLowerCase(),total=0,matched=0,first=null;['holdBody','tradeBody','cashLogBody'].forEach(function(id){var tb=document.getElementById(id);if(!tb)return;[].forEach.call(tb.querySelectorAll('tr'),function(tr){if(tr.querySelector('.table-empty')||tr.querySelector('.ds-empty'))return;total++;var hit=matchRowText(tr.textContent,q);tr.style.display=hit?'':'none';tr.classList.toggle('is-hidden-row',!hit);if(hit){matched++;if(!first&&q)first=tr}})});var counter=document.getElementById('dsSearchCount');if(counter)counter.textContent=searchCountText(matched,q);var clearBtn=document.getElementById('dsSearchClear');if(clearBtn)clearBtn.hidden=!q;var tip=document.getElementById('dsSearchEmpty');if(tip)tip.hidden=!(q&&matched===0);if(q&&first){first.classList.add('is-search-hit');setTimeout(function(){first.classList.remove('is-search-hit')},1200);if(!first._jumpLock){first._jumpLock=true;try{first.scrollIntoView({behavior:'smooth',block:'center'})}catch(e){first.scrollIntoView()}setTimeout(function(){first._jumpLock=false},1400)}}}
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

var RECORD_SEG_KEY=KEYS.recordsSegment;
function setRecordSegment(seg,persist){
  var groups=document.querySelectorAll(".record-group");
  if(!groups.length)return;
  [].forEach.call(groups,function(g){g.classList.toggle("active",g.getAttribute("data-group")===seg)});
  [].forEach.call(document.querySelectorAll("#recordSeg .record-seg"),function(b){
    var on=b.getAttribute("data-seg")===seg;
    b.classList.toggle("active",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
  if(persist!==false){try{LS.setItem(RECORD_SEG_KEY,seg)}catch(e){logSwallowed("setRecordSegment",e)}}
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
  try{saved=readRaw(RECORD_SEG_KEY)||"data"}catch(e){logSwallowed("initRecordSegment",e)}
  setRecordSegment(saved,false);
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",initRecordSegment)}else{initRecordSegment()}


function updatePnLOpt(){
var nowInstant=new Date(),now=marketDate(nowInstant),thisM=now.slice(0,7);
optionTrades=loadOpt();
var tot=optionTotals(optionTrades,{now:nowInstant,ym:thisM}),month=tot.month,total=tot.total;
var me=document.getElementById("mrev"),te=document.getElementById("trev");
if(me)me.textContent=fmtFull(month);if(te)te.textContent=fmtFull(total);var cc=document.getElementById('ccMonthly'),cs=document.getElementById('ccSub'),ca=document.getElementById('ccActive'),cn=document.getElementById('ccNearest');if(cc)cc.textContent=fmtFull(month);if(cs)cs.textContent=tot.callsThisMonth+' 张 CALL · 复投核心仓';if(ca)ca.textContent=String(tot.activeCount);if(cn){cn.textContent=tot.nearest?('最近 '+tot.nearest.expiry.slice(5)+' · '+tot.nearest.sym+' $'+tot.nearest.strike.toFixed(0)):'暂无待到期期权'}
}
function updateOptStatus(){var el=document.getElementById("optStatus");if(!el)return;var nowInstant=new Date();optionTrades=loadOpt();var active=optionTrades.filter(function(o){return isActiveOption(o,nowInstant)});if(!active.length){el.innerHTML="无活跃持仓";return}el.innerHTML=active.map(function(o){var st=optionRowStatus(o,{now:nowInstant,spot:livePrices[o.sym]||0});var d=st.days;var itm=st.itm;var icon=itm?"🔵":"🟢";var txt=itm?"临近行权":"虚值";return "<div style=display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--rule)><span>"+icon+"</span><div style=flex:1><b>"+o.sym+"</b> "+o.type+" @$"+o.strike.toFixed(0)+" x"+(o.contracts||1)+"</div><div style=font-size:11.5px;color:"+(itm?"var(--blue)":"var(--accent)")+">"+txt+" · "+d+"天</div></div>";}).join("");}function delOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o)return;if(o.archived){o.archived=false;saveOpt();updateAllO();showToast("已恢复 "+o.sym+" @$"+o.strike.toFixed(2),"ok");return}if(o.settled){o.archived=true;saveOpt();updateAllO();showToast("已归档 "+o.sym+" @$"+o.strike.toFixed(2)+" · 权利金统计保留","ok");return}var pb=(o.premium||0)*(o.contracts||1);if(pb>0){cashBalance-=pb;saveCash();cashLog.push({id:Date.now(),date:marketDate(),time:marketClock(),type:"权利金退回-"+o.sym,amount:pb});saveCashLog();addActivity("删除期权 "+o.sym+" 退回权利金 "+fmtFull(pb))}optionTrades.splice(i,1);saveOpt();pushNow();updateAllO();showToast("已删除 "+o.sym+" @$"+o.strike.toFixed(2)+",退回 "+fmtFull(pb),"ok")}function assignOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o||o.type!=="CALL")return;var contracts=o.contracts||1;var need=contracts*100;var held=0;trades.forEach(function(t){if(t.symbol===o.sym)held+=t.shares});if(need>held){alert("持仓不足！\n持有："+held.toFixed(0)+"股\n行权需要："+need+"股");return}var recDate=(o.expiry&&o.expiry<=marketDate())?o.expiry:marketDate();var msg="将以 $"+o.strike.toFixed(2)+" 卖出 "+contracts+"张CALL对应的 "+(contracts*100)+" 股 "+o.sym+"\n\n权利金已在卖CALL时入账，无需重复记录。\n\n记账日期：\n"+recDate+"（到期日；提前行权则记今天）";if(!confirm(msg))return;trades.push({id:tradeIdCounter++,symbol:o.sym,date:recDate,time:marketClock(),shares:-(contracts*100),price:o.strike,tag:'assign'});saveTrades();initTradeIds();o.settled=true;saveOpt();updateAllO();updatePortfolio();updateSidebar();updateSidebarPrices();updateTradeList();addActivity('CALL行权 '+o.sym+'×'+contracts+'张 @$'+o.strike.toFixed(2));showToast("已标记行权: "+o.sym+" @$"+o.strike.toFixed(2)+" x"+contracts,"ok")}function settleOpt(id){var i=optionTrades.findIndex(function(x){return x.id==id});if(i<0)return;var o=optionTrades[i];if(!o)return;if(!confirm("确认到期结算 "+o.sym+" "+o.type+" @$"+o.strike.toFixed(2)+" x"+(o.contracts||1)+"张?\n\n权利金已在卖CALL时入账，到期未行权无需其他操作。"))return;o.settled=true;saveOpt();updateAllO();addActivity('CALL到期 '+o.sym+'×'+(o.contracts||1)+'张 @$'+o.strike.toFixed(2));showToast("已到期结算: "+o.sym,"ok")}
document.getElementById("btnAddOption").addEventListener("click",function(){
var t=document.getElementById("otype").value;
var s=document.getElementById("osym").value;
var k=parseFloat(document.getElementById("ostrike").value||0);
var p=parseFloat(document.getElementById("opremium").value||0);
var e=document.getElementById("oexpiry").value;
var c=parseInt(document.getElementById("ocontracts").value||1);
if(!t)return formError('请选择期权类型','otype');if(!s)return formError('请选择标的','osym');if(!k||k<=0)return formError('请填写行权价','ostrike');if(isNaN(p)||p<0)return formError('请填写有效的权利金','opremium');if(!e)return formError('请选择到期日','oexpiry');if(isNaN(c)||c<1)c=1;if(t==='CALL'){try{var heldShares=0;trades.forEach(function(tr){if(tr.symbol===s)heldShares+=Number(tr.shares)||0});var needShares=(Number(c)||1)*100;if(heldShares<needShares){showToast('提醒：卖 '+c+' 张 CALL 通常需要 '+needShares+' 股 '+s+'，当前 '+heldShares.toFixed(2)+' 股（仍会记录）','err')}}catch(e){logSwallowed("settleOpt",e)}}
/* 到期日校验（v326）：拿市场真实挂牌的到期日对一遍。VGT 只有月度（第三个周五），
   输一个周三的日期是很可能手滑——给提示但**不阻止**记录（行情拿不到时也照记）。 */
try{
  var _chkChain=chainFor(s);
  if(_chkChain&&_chkChain.expiries&&_chkChain.expiries.length&&!_chkChain.expiries.some(function(x){return x.date===e})){
    var _near=_chkChain.expiries.slice().sort(function(a,b){return Math.abs(Date.parse(a.date)-Date.parse(e))-Math.abs(Date.parse(b.date)-Date.parse(e))})[0];
    showToast('提醒：'+s+' 在 '+e+' 没有挂牌到期日'+(e.slice(0,7)===_near.date.slice(0,7)?'（该月是 '+_near.date+'）':('，最近的是 '+_near.date))+'（仍会记录）','err');
  }
}catch(e2){logSwallowed("optExpiryCheck",e2)}
var premiumTotal=p*(c||1);var optObj={id:Date.now(),sym:s,type:t,strike:k,premium:p,expiry:e,contracts:c,added:marketDate()};optionTrades.push(optObj);if(typeof closeOptSheet==="function")closeOptSheet();addActivity('卖'+t+'开仓 '+s+'×'+c+'张 @$'+k+' 💰$'+p);
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
/* v319：负数修正是"往回改"的非常规操作，先二次确认（会修成负数时再明确警告一次）——
   以前只挡了 v===0，填负数就能把可用现金直接改成负数，总资产跟着变负而且毫无提示 */
function applyCashCorrection(v){cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:v>0?"修正+":"修正-",amount:v});saveCashLog();document.getElementById("hmCorrectAmt").value="";addActivity("现金修正 "+fmtFull(v));updateSidebar();updateHoldCash();renderCashLog()}
try{document.getElementById("hmCorrect").addEventListener("click",function(){var v=parseFloat(document.getElementById("hmCorrectAmt").value)||0;if(v===0)return formError("请输入修正金额","hmCorrectAmt");var plan=cashCorrectionPlan(cashBalance,v);if(!plan.needsConfirm)return applyCashCorrection(v);showApproval({title:"确认减少现金",message:"现金修正填了负数，会把可用现金从 "+fmtFull(cashBalance)+" 改成 "+fmtFull(plan.next)+"。"+(plan.willGoNegative?"\n\n⚠️ 修正后可用现金为负数，总资产也会跟着变成负数。":""),confirmText:"确认修正",onConfirm:function(){applyCashCorrection(v)}})})}catch(e){logSwallowed("settleOpt",e)}
try{document.getElementById("hmDividend").addEventListener("click",function(){var s=document.getElementById("divSym").value;var v=parseFloat(document.getElementById("divAmt").value)||0;if(!s)return formError("请选择股息标的","divSym");if(v===0)return formError("请输入股息金额","divAmt");cashBalance+=v;saveCash();cashLog.push({id:Date.now(),date:localDate(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),type:"股息+"+s,amount:v});saveCashLog();document.getElementById("divAmt").value="";addActivity("股息收入 "+s+" "+fmtFull(v));updateSidebar();updateHoldCash();renderCashLog()})}catch(e){logSwallowed("settleOpt",e)}setTimeout(function(){if(typeof updateAllO==="function")updateAllO()},500);

/* range=max 是历史数据：同一个标的只请求一次，年初/年末两个口径共用（原先一次开屏要打 6 次） */
var maxPriceReq={};
function fetchMaxData(sym){var k=String(sym);if(maxPriceReq[k])return maxPriceReq[k];var p=fetchWithTimeout('/api/price?symbol='+encodeURIComponent(PRICE_SYMBOLS[sym]||sym)+'&range=max').then(function(r){return r.json()}).catch(function(){return null});maxPriceReq[k]=p;return p}
function fetchYearStartPrice(sym,year){return fetchMaxData(sym).then(function(d){if(!d||!d.ok||!d.data||!d.data.chart||!d.data.chart.result||!d.data.chart.result[0])return null;var r=d.data.chart.result[0];var ts=r.timestamp||[];var cs=r.indicators.quote[0].close||[];var tgt=year+'-01-01';for(var i=0;i<ts.length;i++){var d2=marketDate(new Date(ts[i]*1000));if(d2>=tgt&&cs[i]!=null)return cs[i]}return cs[cs.length-1]||0}).catch(function(){return null})}
function fetchYearEndPrice(sym,year){return fetchMaxData(sym).then(function(d){if(!d||!d.ok||!d.data||!d.data.chart||!d.data.chart.result||!d.data.chart.result[0])return null;var r=d.data.chart.result[0];var ts=r.timestamp||[];var cs=r.indicators.quote[0].close||[];var tgt=year+'-12-31';var last=null;for(var i=0;i<ts.length;i++){var d2=marketDate(new Date(ts[i]*1000));if(d2>tgt)break;if(d2<=tgt&&cs[i]!=null)last=cs[i]}return last||cs[cs.length-1]||0}).catch(function(){return null})}
function calcAttribution(year){var yS=year+'-01-01',yE=year+'-12-31';var ss={},es={},ac={};ETF_SYMS.forEach(function(s){ss[s]=0;es[s]=0;ac[s]=0});var sSell=0,sBuy=0,eSell=0,eBuy=0;trades.forEach(function(t){if(t.date<=yE&&es[t.symbol]!==undefined)es[t.symbol]+=t.shares;if(t.date<yS&&ss[t.symbol]!==undefined)ss[t.symbol]+=t.shares;if(t.date>=yS&&t.date<=yE&&t.shares>0&&ac[t.symbol]!==undefined)ac[t.symbol]+=t.shares*t.price;if(t.date<yS){var a=Math.abs(t.shares)*t.price;if(t.shares<0)sSell+=a;else sBuy+=a}if(t.date<=yE){var ea=Math.abs(t.shares)*t.price;if(t.shares<0)eSell+=ea;else eBuy+=ea}});var sCash=0,eCash=0,ccP=0,div=0,nd=0;cashLog.forEach(function(l){if(l.date<yS)sCash+=cashSigned(l);if(l.date<=yE)eCash+=cashSigned(l);if(l.date>=yS&&l.date<=yE){if(l.type&&l.type.indexOf('入金')>=0)nd+=l.amount||0;if(l.type&&l.type.indexOf('出金')>=0)nd-=Math.abs(l.amount||0);if(l.type&&l.type.indexOf('股息')>=0)div+=l.amount||0}});optionTrades.forEach(function(o){if(o.added&&o.added.slice(0,4)===year)ccP+=(o.premium||0)*(o.contracts||1)});Promise.all(ETF_SYMS.map(function(s){return Promise.all([fetchYearStartPrice(s,year),fetchYearEndPrice(s,year)])})).then(function(pairs){var ps={},pe={};var _unavail=false;ETF_SYMS.forEach(function(s,i){ps[s]=pairs[i][0];pe[s]=pairs[i][1];if(ps[s]===null||pe[s]===null)_unavail=true});var sA=0,eA=eCash+eSell-eBuy,cg={};ETF_SYMS.forEach(function(s){var sp=ps[s]||0,ep=pe[s]||0;sA+=ss[s]*sp;eA+=es[s]*ep;cg[s]=(es[s]*ep)-(ss[s]*sp)-ac[s]});sA+=sCash+sSell-sBuy;var tg=eA-sA-nd;var ot=tg-ETF_SYMS.reduce(function(s,sym){return s+cg[sym]},0)-ccP-div;renderAttribution({year:year,totalGain:tg,startAssets:sA,endAssets:eA,netDep:nd,capGains:cg,ccPrem:ccP,dividend:div,other:ot,unavail:_unavail})})}
function renderAttribution(r){var el=document.getElementById('attrSummary');if(el){el.innerHTML=(r.unavail?'<span style="color:var(--orange)">⚠️ 价格数据不可用，结果可能不准确</span><br>':'')+'<strong style="color:'+(r.totalGain>=0?'var(--accent)':'var(--red)')+'">总收益 '+fmtFull(r.totalGain)+'</strong>'}var ch=document.getElementById('attrChart');if(ch){var items=[{label:'VGT 增值',val:r.capGains.VGT},{label:'SMH 增值',val:r.capGains.SMH},{label:'BTC 增值',val:r.capGains.BTC},{label:'CC 权利金',val:r.ccPrem},{label:'股息',val:r.dividend},{label:'其他',val:r.other}];var mx=Math.max.apply(null,items.map(function(i){return Math.abs(i.val)}))||1;ch.innerHTML=items.map(function(it){var w=Math.abs(it.val)/mx*100;var pos=it.val>=0;return '<div class="attribution-row"><div class="attribution-row-head"><span>'+it.label+'</span><span class="'+(pos?'pos':'neg')+'">'+(pos?'+':'')+fmtFull(it.val)+(r.totalGain!==0?' '+(it.val/r.totalGain*100).toFixed(0)+'%':'')+'</span></div><div class="attribution-bar"><i style="width:'+w+'%;background:'+(pos?'var(--accent)':'var(--red)')+'"></i></div></div>'}).join('')}var det=document.getElementById('attrDetail');if(det){det.innerHTML='年初 '+fmtFull(r.startAssets)+' → 年末 '+fmtFull(r.endAssets)+' · 净入金 '+fmtFull(r.netDep)}}
try{var ay=document.getElementById('attrYear');if(ay){ay.addEventListener('change',function(){calcAttribution(this.value)});var cy=new Date().getFullYear();var ey=9999;cashLog.forEach(function(l){if(l.type&&l.type.indexOf('入金')>=0&&l.date){var y=parseInt(l.date.slice(0,4));if(y<ey)ey=y}});if(ey===9999){cashLog.forEach(function(l){if(l.date){var y=parseInt(l.date.slice(0,4));if(y<ey)ey=y}});trades.forEach(function(t){if(t.date){var y=parseInt(t.date.slice(0,4));if(y<ey)ey=y}})}if(ey===9999)ey=cy;var opts='';for(var y=cy;y>=ey;y--){opts+='<option value="'+y+'">'+y+'</option>'}ay.innerHTML=opts;ay.value=String(cy);setTimeout(function(){calcAttribution(String(cy))},2000)}}catch(e){logSwallowed("renderAttribution",e)}

/* ===== 被行权概率：CBOE 期权链 → N(d2) =====
   链数据由 Worker 代理（CBOE 主源 / Yahoo 兜底），边缘缓存 30 分钟；数学全在 prob.js。
   v330 移除了"按目标概率反推行权价"：算出来的行权价要吸附到挂牌档，实际还是回到
   OTM 百分比这一个自由度上，多一层反推只是把同一件事说了两遍。现在只有一个入口：
   调 OTM%，直接看对应的概率与权利金。到期日也不再手选 —— 由「节奏」卡的固定日历决定。 */
var optionChains={};
var chainStatus={loading:false,loadedAt:0,error:''};
function chainFor(sym){var c=optionChains[sym];return c&&Number(c.spot)>0?c:null}
function anyChain(){return chainFor('VGT')||chainFor('SMH')||null}
/** CBOE 顶层的官方 30 天 IV（百分数）→ { VGT: 22.485, ... }，只收有效的。 */
function iv30Map(){var m={};['VGT','SMH'].forEach(function(s){var c=chainFor(s);if(c&&Number(c.iv30)>0)m[s]=Number(c.iv30)});return m}
var CHAIN_TTL_MS=5*60*1000;
function renderProbCard(){
  var src=document.getElementById('probSrc');
  var chain=anyChain();
  if(!chain){
    if(src)src.textContent=chainStatus.loading?'加载中…':'';
    renderProbNote(document,{});
    /* 必须先写说明、再写错误提示 —— 顺序反了会被说明文案覆盖掉 */
    if(!chainStatus.loading)renderProbUnavailable(document,chainStatus.error?('数据源暂不可用（'+chainStatus.error+'）'):'稍后会自动重试');
    renderExpiryCalendar();
    return;
  }
  /* 时间不能用 CBOE 的原始字符串：它是美东时间且不带时区标记，非美东用户会误读成"昨天" */
  if(src){var _lab=chain.source==='cboe'?'CBOE 延迟':(chain.source==='yahoo'?'Yahoo':'');var _t=fmtChainTimeShort(chain.updated,Date.now());src.textContent=_lab+(_t?' · '+_t:'');src.title='点击刷新期权链（CBOE 免费接口为延迟报价，非实时）'}
  renderProbNote(document,{source:chain.source,updated:chain.updated,nowMs:Date.now(),iv30:iv30Map()});
  renderExpiryCalendar();
}
/** 到期日历：把市场真实挂牌的到期日列出来，标清月度/周度、剩余天数、自己有没有持仓。 */
function isMonthlyExpiry(date){
  var d=new Date(date+'T00:00:00Z');
  var day=Number(String(date).slice(8,10));
  return d.getUTCDay()===5&&day>=15&&day<=21;   /* 标准月度 = 每月第三个周五 */
}
var calShowAll=false,calTab='VGT';
function renderExpiryCalendar(){
  var el=document.getElementById('expiryCalendar');
  if(!el)return;
  if(calTab!=='VGT'&&calTab!=='SMH')calTab='VGT';
  var sym=calTab;
  var fixed={};
  try{ccRows().forEach(function(r){fixed[r.sym]=r.nextExpiry})}catch(e){logSwallowed("ccRows",e)}
  var entries=[];
  var chain=chainFor(sym);
  if(chain){
    var all=(chain.expiries||[]).filter(function(e){return e&&(e.calls||[]).length});
    /* 默认只列近 3 档：节奏那一档 + 期间的月度档。
       SMH 有十几档周度，全铺出来等于把有用信息淹掉。 */
    var picked=calShowAll?all:all.filter(function(e){return isMonthlyExpiry(e.date)||e.date===fixed[sym]}).slice(0,3);
    picked.forEach(function(e){
      entries.push({date:e.date,dte:e.dte,monthly:isMonthlyExpiry(e.date),
        listed:Number(e.listed)||0,gapPct:Number(e.gapPct)||0});
    });
  }
  var holdings={};
  (optionTrades||[]).forEach(function(o){
    if(!o||o.settled||o.archived||!o.expiry)return;
    var k=o.sym+'|'+o.expiry;holdings[k]=(holdings[k]||0)+(Number(o.contracts)||1);
  });
  var tabs=document.getElementById('calTabs');
  if(tabs)tabs.innerHTML=['VGT','SMH'].map(function(s){
    return '<button type="button" class="prob-chip'+(s===calTab?' is-on':'')+'" data-caltab="'+s+'">'+s+'</button>';
  }).join('');
  el.innerHTML=expiryCalendarHtml(entries,{sym:sym,holdings:holdings,fixed:fixed[sym],
    emptyHint:chainStatus.error?('数据源暂不可用（'+chainStatus.error+'）'):'期权链加载中…'});
  var btn=document.getElementById('calToggle');
  if(btn)btn.textContent=calShowAll?'只看近 3 档':'显示全部到期日';
}
function toggleCalShowAll(){calShowAll=!calShowAll;renderExpiryCalendar();haptic('light')}
/** 「行权价参考」两行的概率联动：调 OTM 百分比时实时看到对应的被行权概率。 */
/** 该标的按固定节奏的下一次到期日（联动要锁到这一档，而不是让用户手选期限）。 */
function ccNextExpiry(sym){
  try{var r=scheduleRow(sym,ccSchedule,marketDate());return r?r.nextExpiry:''}catch(e){return ''}
}
function renderOtmProbLines(){
  ['VGT','SMH'].forEach(function(sym){
    var chain=chainFor(sym);
    var otm=sym==='VGT'?otmSettings.vgt:otmSettings.smh;
    var fixed=ccNextExpiry(sym);
    var opts=otmExpiryOptions(sym);
    /* 临时选的档位如果已经不在链里（日期推进/链刷新），自动回到节奏那一档 */
    var chosen=otmViewExpiry[sym];
    if(!chosen||!opts.some(function(e){return e.date===chosen}))chosen=fixed;
    otmViewExpiry[sym]=chosen;
    renderOtmExpiryChips(document,sym,opts,chosen,fixed);
    if(!chain||!(otm>0)){renderOtmProbLine(document,sym,null);return}
    var plan=null;
    try{plan=planAtOtm({chain:chain,sym:sym,spot:Number(livePrices&&livePrices[sym])||chain.spot,otmPct:otm,expiry:chosen})}catch(e){logSwallowed("planAtOtm",e)}
    renderOtmProbLine(document,sym,plan);
  });
}
/* '' = 跟着固定节奏；否则是临时查看的到期日（只看不改，刷新后回到节奏档） */
var otmViewExpiry={VGT:'',SMH:''};
/** 该标的可选的到期档：节奏那一档 + 之后最近的几档月度（最多 4 个）。 */
function otmExpiryOptions(sym){
  var ch=chainFor(sym);
  if(!ch)return [];
  var all=(ch.expiries||[]).filter(function(e){return e&&e.dte>0});
  var fixed=ccNextExpiry(sym);
  var out=all.filter(function(e){return e.date===fixed});
  all.filter(function(e){return isMonthlyExpiry(e.date)&&e.date!==fixed})
    .sort(function(a,b){return a.dte-b.dte})
    .forEach(function(e){if(out.length<4)out.push(e)});
  return out.sort(function(a,b){return a.dte-b.dte});
}
async function fetchChain(sym){
  try{
    var r=await fetchWithTimeout('/api/chain?sym='+encodeURIComponent(sym));
    if(!r.ok)return{ok:false,error:'HTTP '+r.status};
    var j=await r.json();
    if(!j||!j.ok||!j.chain)return{ok:false,error:(j&&j.error)||'payload'};
    return{ok:true,chain:j.chain};
  }catch(e){return{ok:false,error:(e&&e.message)||'failed'}}
}
async function refreshChains(force){
  if(chainStatus.loading)return;
  if(!force&&Date.now()-chainStatus.loadedAt<CHAIN_TTL_MS&&anyChain())return;
  chainStatus.loading=true;
  if(!anyChain())renderProbCard();          /* 首屏先出"加载中" */
  var results=await Promise.all(['VGT','SMH'].map(fetchChain));
  var errs=[];
  ['VGT','SMH'].forEach(function(sym,i){if(results[i].ok)optionChains[sym]=results[i].chain;else errs.push(sym+': '+results[i].error)});
  chainStatus.loading=false;
  chainStatus.error=errs.join(' | ');
  if(!errs.length)chainStatus.loadedAt=Date.now();
  renderProbCard();
  updateOtm();
  /* 持仓表的「被行权概率」列要等期权链到位才有值 —— 链刷新后补渲一次表 */
  try{renderOpt()}catch(e){logSwallowed("renderOpt",e)}
}
function bindProbControls(){
  var src=document.getElementById('probSrc');
  if(src)src.addEventListener('click',function(){if(!chainStatus.loading)refreshChains(true)});
  /* 行权 / 结算 / 删除之后，日历里的「我的持仓」要跟着变 —— 期权表格的按钮是 onclick 直挂的，
     所以在容器上做事件委托，等原处理器跑完再重绘。 */
  var ob=document.getElementById('holdingsBody');
  /* 行权 / 结算 / 删除之后，到期判定与买回待办要立刻跟着变 */
  if(ob)ob.addEventListener('click',function(){setTimeout(function(){renderProbCard();updateOtm();refreshCcAlerts()},150)});
  /* 到期档位切换：只看不改 —— 选一档就重画那一行的概率/权利金，节奏本身不受影响 */
  ['VGT','SMH'].forEach(function(sym){
    var el=document.getElementById(sym==='VGT'?'otmVgtExp':'otmSmhExp');
    if(!el)return;
    el.addEventListener('click',function(e){
      var b=e.target.closest('[data-otmexp]');if(!b)return;
      var parts=String(b.dataset.otmexp).split('|');
      if(parts[0]!==sym||!parts[1])return;
      otmViewExpiry[sym]=parts[1];
      renderOtmProbLines();
      haptic('light');
    });
  });
  var calBtn=document.getElementById('calToggle');
  if(calBtn)calBtn.addEventListener('click',toggleCalShowAll);
  /* 到期日历按标的切页（VGT / SMH）—— 两个标的的到期日结构完全不同，一张表塞不下 */
  var calTabs=document.getElementById('calTabs');
  if(calTabs)calTabs.addEventListener('click',function(e){
    var b=e.target.closest('[data-caltab]');if(!b)return;
    calTab=b.dataset.caltab;
    renderExpiryCalendar();
    haptic('light');
  });
}
(function initProb(){
  var run=function(){
    bindProbControls();renderProbCard();
    bindCcControls();renderCcSchedule();
    /* 切到期权页时刷新（refreshChains 自带 5 分钟节流，不会每切一次就打上游） */
    document.querySelectorAll('.tab-btn').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.tab==='option')refreshChains(false)})});
    setTimeout(function(){refreshChains(false);refreshDividends(false)},1200);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();

/* ===== 卖 CALL 的固定节奏 =====
   15-20 年的系统化策略里，日历本身就是纪律的一部分（和月度 DCA、年度再平衡同源）。
   只支持两种能精确算出来的规则：
     VGT 每月第三个周五（它只有月度期权，没得选）
     SMH 每 3 周的周五（有周期权；回测显示 21 天是区间最优）
   卖出时点固定为**到期日当天**（旧档到期 = 新档开仓同一天，没有空档期）。
   注意锚点：历史回测里换锚点能差 ±1.5pt，但那是路径运气、事前无法优化，所以只提供"可改"。*/
var CC_KEY='ccSchedule';
var CC_ANCHOR_DEFAULT='2026-10-30';   /* 让 SMH 的 11-20 正好与 VGT 的月度到期日重合 */
var ccSchedule={VGT:{rule:'monthly3'},SMH:{rule:'every3w',anchor:CC_ANCHOR_DEFAULT}};
(function loadCcSchedule(){
  try{
    var raw=JSON.parse(readRaw(CC_KEY)||'null');
    if(raw&&typeof raw==='object'){
      ['VGT','SMH'].forEach(function(s){
        var c=raw[s];if(!c||typeof c!=='object')return;
        if(CC_RULES.indexOf(c.rule)>=0)ccSchedule[s].rule=c.rule;
        if(c.anchor&&weekdayOf(c.anchor)===5)ccSchedule[s].anchor=c.anchor;
      });
    }
  }catch(e){logSwallowed("loadCcSchedule",e)}
})();
/** 只写本地：属于本机偏好，没进 SYNC_FIELDS（所以刻意不调 markDirty，免得留下永远推不走的脏标记）。 */
function saveCcSchedule(){LS.setItem(CC_KEY,JSON.stringify(ccSchedule))}
var ccDividends={};
function ccRows(){return ['VGT','SMH'].map(function(s){return scheduleRow(s,ccSchedule,marketDate())}).filter(Boolean)}
function ccStreaks(){var m={};['VGT','SMH'].forEach(function(s){m[s]=complianceStreak(optionTrades,s,ccSchedule,marketDate())});return m}
function ccExDivItems(){
  var out=[];
  ['VGT','SMH'].forEach(function(s){
    var list=ccDividends[s];if(!list||!list.length)return;
    var next=null;try{next=estimateNextExDiv(list,marketDate())}catch(e){logSwallowed("estimateNextExDiv",e)}
    if(next)out.push({sym:s,next:next});
  });
  return out;
}
async function fetchDividends(sym){
  try{
    var r=await fetchWithTimeout('/api/dividends?sym='+encodeURIComponent(sym));
    if(!r.ok)return null;
    var j=await r.json();
    return (j&&j.ok&&Array.isArray(j.dividends))?j.dividends:null;
  }catch(e){return null}
}
/** 节奏卡片 + CC 相关的提醒一起刷新（提醒要读 ccRows，所以绑在一起）。 */
function renderCcSchedule(){
  try{
    var rows=ccRows();
    renderSchedule(document,rows,{
      rows:rows,
      rules:{VGT:ccSchedule.VGT.rule,SMH:ccSchedule.SMH.rule},
      streaks:ccStreaks(),
      dividends:ccExDivItems(),
    });
  }catch(e){logSwallowed("renderCcSchedule",e)}
  refreshCcAlerts();
}
function refreshCcAlerts(){
  try{
    var nowInstant=new Date();
    renderAlerts(document,buildAlerts({now:nowInstant,options:loadOpt(),prices:livePrices,trades:trades,state:state,pingMap:loadOptPing(),
      ccRows:ccRows(),ccStreaks:ccStreaks()}));
  }catch(e){logSwallowed("refreshCcAlerts",e)}
}
async function refreshDividends(force){
  if(!force&&ccDividends.VGT&&ccDividends.SMH){renderCcSchedule();return}
  var res=await Promise.all(['VGT','SMH'].map(fetchDividends));
  ['VGT','SMH'].forEach(function(s,i){if(res[i])ccDividends[s]=res[i]});
  renderCcSchedule();
}
function bindCcControls(){
  var pickers=document.getElementById('ccRulePickers');
  if(pickers)pickers.addEventListener('click',function(e){
    var b=e.target.closest('[data-ccrule]');if(!b)return;
    var parts=String(b.dataset.ccrule).split('|'),sym=parts[0],rule=parts[1];
    if(CC_RULES.indexOf(rule)<0||!ccSchedule[sym])return;
    ccSchedule[sym].rule=rule;
    if(rule==='every3w'&&!ccSchedule[sym].anchor)ccSchedule[sym].anchor=CC_ANCHOR_DEFAULT;
    saveCcSchedule();renderCcSchedule();haptic('light');
  });
}

/* OTM 默认值的两次调整都来自 22 年回测（2004-2026，含买卖价差）：
   v326 先把 VGT 7% / SMH 5% 统一成 6%；
   v328 按**固定节奏**（VGT 月度第三个周五、SMH 每 3 周）重跑后又调开 ——
   月度日历里有 35 天的月份，DTE 被拉到 32 天左右、行权风险上升，所以 VGT 要卖得更远（7%），
   SMH 是 21 天短周期、行权风险低，留在 6%。
   老设备的存量设置用一次性标记搬过来 —— 只跑一次，之后用户自己调过的值不会再被覆盖。 */
var OTM_MIGRATE_KEY='otm76_migrated_v1';
var otmSettings={vgt:7,smh:6};
try{
  var s2=JSON.parse(readRaw("otmSettings"));if(s2)otmSettings=s2;
  if(!LS.getItem(OTM_MIGRATE_KEY)){
    otmSettings.vgt=7;otmSettings.smh=6;
    LS.setItem("otmSettings",JSON.stringify(otmSettings));
    LS.setItem(OTM_MIGRATE_KEY,'1');
    markDirty('otmSettings');
  }
}catch(e){logSwallowed("otmSettingsInit",e)}
function updateOtm(){otmSettings.vgt=otmPercent(otmSettings.vgt,7);otmSettings.smh=otmPercent(otmSettings.smh,6);var vp=livePrices?livePrices.VGT||0:0;var sp=livePrices?livePrices.SMH||0:0;var v=document.getElementById("otmVgtVal");if(v)v.textContent=otmSettings.vgt+"%";var s=document.getElementById("otmSmhVal");if(s)s.textContent=otmSettings.smh+"%";var ve=document.getElementById("otmVgtStrike");if(ve&&vp>0)ve.textContent="$"+vp.toFixed(0)+" → $"+suggestedStrike(vp,otmSettings.vgt).toFixed(0);var se=document.getElementById("otmSmhStrike");if(se&&sp>0)se.textContent="$"+sp.toFixed(0)+" → $"+suggestedStrike(sp,otmSettings.smh).toFixed(0);try{renderOtmProbLines()}catch(e){logSwallowed("renderOtmProbLines",e)}}
function adjOtm(sym,dir){var key=sym==="VGT"?"vgt":"smh";otmSettings[key]=stepOtmPercent(otmSettings[key],dir,key==='vgt'?7:6);LS.setItem("otmSettings",JSON.stringify(otmSettings));markDirty('otmSettings');updateOtm();autoPushDebounce();}
try{var ep=document.getElementById("otmVgtPlus");if(ep)ep.onclick=function(){adjOtm("VGT",1)};var em=document.getElementById("otmVgtMinus");if(em)em.onclick=function(){adjOtm("VGT",-1)};var sp2=document.getElementById("otmSmhPlus");if(sp2)sp2.onclick=function(){adjOtm("SMH",1)};var sm2=document.getElementById("otmSmhMinus");if(sm2)sm2.onclick=function(){adjOtm("SMH",-1)}}catch(e){logSwallowed("adjOtm",e)}setTimeout(updateOtm,800);

function refreshTradeAffordability(){var sh=document.getElementById('tfShares'),pr=document.getElementById('tfPrice');if(!sh||!pr)return;var s=parseFloat(sh.value),p=parseFloat(pr.value);if(!s||!p||s<=0||p<=0){sh.style.borderColor='';sh.title='';return}var cost=s*p,avail=getNetCash();if(cost>avail){sh.style.borderColor='var(--red)';sh.title='需要 '+fmtFull(cost)+' ，可用 '+fmtFull(avail)}else{sh.style.borderColor='';sh.title=''}}
(function(){var sh=document.getElementById('tfShares'),pr=document.getElementById('tfPrice');if(sh)sh.addEventListener('input',refreshTradeAffordability);if(pr)pr.addEventListener('input',refreshTradeAffordability)})();
function qaToggle(){var s=document.getElementById('qaSheet');if(s.classList.contains('open'))qaClose();else{s.classList.add('open');markAlertsSeen(alertSignature(getCurrentAlerts()||[]));updateBellBadge(getCurrentAlerts()||[]);}}
function qaClose(){var s=document.getElementById('qaSheet');if(!s)return;var p=s.querySelector('.qa-panel');if(p)p.style.transform='';s.classList.remove('open')}
/* 记录期权：从底部弹层录入（原来是一张常显的大表单，占掉期权页三分之一） */
function optSheetEl(){return document.getElementById('optSheet')}
function openOptSheet(){var s=optSheetEl();if(!s)return;var p=s.querySelector('.qa-panel');if(p)p.style.transform='';s.classList.add('open');haptic('light')}
function closeOptSheet(){var s=optSheetEl();if(!s)return;var p=s.querySelector('.qa-panel');if(p)p.style.transform='';s.classList.remove('open')}
/* v308 方案B：买卖录入 / 现金管理各自进底部弹层（表单内容原地搬，未改任何字段与逻辑） */function sheetOpen(id){var s=document.getElementById(id);if(!s)return;var p=s.querySelector(".qa-panel");if(p)p.style.transform="";s.classList.add("open")}function sheetClose(id){var s=document.getElementById(id);if(!s)return;var p=s.querySelector(".qa-panel");if(p)p.style.transform="";s.classList.remove("open")}function openTradeSheet(){sheetOpen("tradeSheet");try{haptic("light")}catch(e){logSwallowed("openTradeSheet",e)}}function closeTradeSheet(){sheetClose("tradeSheet")}function openCashSheet(){sheetOpen("cashSheet");try{haptic("light")}catch(e){logSwallowed("openCashSheet",e)}}function closeCashSheet(){sheetClose("cashSheet")}(function initConsoleSheets(){[["btnTradeSheet","tradeSheet",closeTradeSheet],["btnCashSheet","cashSheet",closeCashSheet]].forEach(function(pair){var btn=document.getElementById(pair[0]);if(btn)btn.addEventListener("click",function(){sheetOpen(pair[1])});var s=document.getElementById(pair[1]);if(!s)return;var p=s.querySelector(".qa-panel");if(p)enableSheetDrag(p,pair[2]);});})();function initOptSheet(){
  var btn=document.getElementById('btnOptSheet');if(btn)btn.addEventListener('click',openOptSheet);
  var s=optSheetEl();if(!s)return;
  var p=s.querySelector('.qa-panel');if(p)enableSheetDrag(p,closeOptSheet);
}
initOptSheet();
function initQaDrag(){var s=document.getElementById('qaSheet');if(!s)return;var p=s.querySelector('.qa-panel');if(p)enableSheetDrag(p,qaClose)}
initQaDrag();
function qaDeposit(){qaClose();switchTab('console');setTimeout(function(){openCashSheet();var e=document.getElementById('hmCashAmt');if(e)e.focus()},260)}
function qaBuy(){qaClose();switchTab('console');var t=document.getElementById('tfType');if(t)t.value='buy';syncTradeControls();setTimeout(function(){openTradeSheet();var e=document.getElementById('tfShares');if(e)e.focus()},260)}
function qaSell(){qaClose();switchTab('console');var t=document.getElementById('tfType');if(t)t.value='sell';syncTradeControls();setTimeout(function(){openTradeSheet();var e=document.getElementById('tfShares');if(e)e.focus()},260)}
function qaCall(){qaClose();switchTab('option');setTimeout(function(){var e=document.getElementById('ostrike');if(e){e.scrollIntoView({behavior:'smooth',block:'center'});e.focus()}},300)}


function updateAlerts(){
  var nowInstant=new Date();
  renderAlerts(document,buildAlerts({now:nowInstant,options:loadOpt(),prices:livePrices,trades:trades,state:state,pingMap:loadOptPing(),ccRows:ccRows(),ccStreaks:ccStreaks()}));
}
document.addEventListener('click',function(event){var target=event.target;if(!target||!target.closest)return;var dismiss=target.closest('[data-alert-dismiss]');if(dismiss){event.preventDefault();event.stopPropagation();saveOptPing(String(dismiss.getAttribute('data-alert-dismiss')||'').replace(/^opt-expiry-/,''));updateAlerts();return}var action=target.closest('[data-alert-action]');if(action){qaClose();switchTab(action.getAttribute('data-alert-action'))}});

function updatePresentationMeta(){var dateEl=document.getElementById('desktopDate'),now=new Date(),cn=zonedDateParts(now,HOME_TIME_ZONE),ny=zonedDateParts(now,MARKET_TIME_ZONE),cnWeek={Sun:'星期日',Mon:'星期一',Tue:'星期二',Wed:'星期三',Thu:'星期四',Fri:'星期五',Sat:'星期六'};if(dateEl)dateEl.textContent='北京时间 '+Number(cn.month)+'月'+Number(cn.day)+'日 · '+cnWeek[cn.weekday]+' · '+cn.hour+':'+cn.minute;var mins=(Number(ny.hour)||0)*60+(Number(ny.minute)||0),weekday=['Mon','Tue','Wed','Thu','Fri'].indexOf(ny.weekday)>=0,isSession=weekday&&mins>=570&&mins<960,stateEl=document.getElementById('desktopMarketState'),stateWrap=stateEl&&stateEl.closest('.market-open');if(stateEl)stateEl.textContent='美东 '+ny.month+'/'+ny.day+' '+ny.hour+':'+ny.minute+' · '+(isSession?MARKET_SESSION_LABELS.open:MARKET_SESSION_LABELS.closed);if(stateWrap)stateWrap.classList.toggle('is-closed',!isSession)}
(function initPresentationMeta(){updatePresentationMeta();setInterval(updatePresentationMeta,60000);var labels={otype:'期权类型',osym:'期权标的',oexpiry:'期权到期日',ocontracts:'期权合约数量',divSym:'股息标的',tradeFilterSym:'交易标的筛选',cashFilter:'资金流水筛选',attrYear:'年度归因年份'};Object.keys(labels).forEach(function(id){var el=document.getElementById(id);if(el&&!el.getAttribute('aria-label'))el.setAttribute('aria-label',labels[id])})})();

function updateSyncBanner(){applySyncBanner(document,syncBannerView(loadSyncState(),Date.now()))}
function initSyncBanner(){bindSyncBanner({doc:document,onRetry:function(){if(typeof autoPull==='function')try{autoPull()}catch(e){logSwallowed("initSyncBanner",e)}},onExport:function(){var b=document.getElementById('btnExportData');if(b)b.click()},onDismiss:function(){var s=loadSyncState();s.bannerDismissedAt=Date.now();saveSyncState(s)}})}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initSyncBanner)}else{initSyncBanner()}


/* v248：设置面板搬移 / 整屏抽屉 / 手机端手风琴（含各自的启动时机与 resize 监听） */
bindSettingsPanel();


/* v248：触感委托（haptic 定义已搬到 settings-view.js） */
bindHaptics();
var sbBuildEl=document.getElementById('sbBuild');if(sbBuildEl)sbBuildEl.textContent=APP_BUILD;
/* ===== 观察列表 + ETF 前十大构成股（数据来自 Worker，只读，不进同步） ===== */var WATCH_KEY='wealth_watchlist_v1';var watchList=normalizeWatchlist((function(){try{return JSON.parse(readRaw(WATCH_KEY)||'[]')}catch(e){return[]}})());var watchQuotes={},holdingsData={},watchCaps={},watchFetchedAt=0,watchRefreshing=false,watchInvalid=[],watchMissing=[],watchSort='default';
/* 市值一天一变就够了：本地存一份，开 App 先用它，别再打接口（只在本机，不进同步） */
var CAPS_KEY='wealth_marketcap_v1',CAPS_TTL=24*60*60*1000,capsFetchedAt=0;
(function(){try{var v=readJSON(CAPS_KEY,null);if(v&&v.caps&&v.at){for(var k in v.caps){watchCaps[k]=v.caps[k]}capsFetchedAt=Number(v.at)||0}}catch(e){logSwallowed("loadCapsCache",e)}})();function saveWatch(next){watchList=normalizeWatchlist(next);try{LS.setItem(WATCH_KEY,JSON.stringify(watchList))}catch(e){logSwallowed("saveWatch",e)}renderWatch();renderWatchManage();try{markDirty('watchlist');autoPushDebounce()}catch(e){logSwallowed("saveWatch",e)}}
/* v249：观察列表的状态与写操作注入给视图层（getter 保证读的是最新值） */
configureWatchUI({get watchList(){return watchList},get watchQuotes(){return watchQuotes},get holdingsData(){return holdingsData},get watchCaps(){return watchCaps},ensureCap:ensureCap,get watchFetchedAt(){return watchFetchedAt},get watchInvalid(){return watchInvalid},get watchMissing(){return watchMissing},get trades(){return trades},get livePrices(){return livePrices},get liveQuoteData(){return liveQuoteData},get ETF_SYMS(){return ETF_SYMS},saveWatch:saveWatch,refreshMarket:refreshMarket,showToast:showToast});
/* v311：行情抓取并发去重 —— 启动时 BTCETF 迁移和观察列表初始化会各调一次，以前会整份重复请求（holdings ×2 + quotes ×2） */var marketInFlight=null;function fetchMarketData(){if(marketInFlight)return marketInFlight;var p=fetchMarketDataImpl();marketInFlight=p.then(function(r){marketInFlight=null;return r},function(e){marketInFlight=null;throw e});return marketInFlight}
function fetchMarketDataImpl(){var base=(syncCfg&&syncCfg.url?syncCfg.url:location.origin).replace(/\/$/,'');/* v311：榜单是季度数据，30 分钟内不重复请求 */var needHold=!(holdingsData.VGT&&holdingsData.SMH&&(Date.now()-(holdingsFetchedAt||0))<30*60*1000);var holdReqs=needHold?['VGT','SMH'].map(function(sym){return fetchWithTimeout(base+'/api/holdings?symbol='+sym).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}):[];return Promise.all(holdReqs).then(function(list){var holdHit=false;list.forEach(function(item){if(item&&item.ok&&item.list){holdingsData[item.symbol]=item;holdHit=true}});if(holdHit)holdingsFetchedAt=Date.now();var symbols=collectQuoteSymbols(watchList,holdingsData);/* v307：买卖录入胶囊/侧边栏/持仓市值也要同一份行情，把它们一并请求（加密代码除外） */['VGT','SMH','SGOV'].forEach(function(s){if(!CRYPTO_CODES[s]&&symbols.indexOf(s)<0)symbols.push(s)});if(!symbols.length){watchFetchedAt=Date.now();renderWatch();renderHoldings();return}return fetchWithTimeout(base+'/api/quotes?symbols='+encodeURIComponent(symbols.join(','))).then(function(r){return r.ok?r.json():null}).then(function(data){if(data&&data.ok&&data.quotes){for(var k in data.quotes){watchQuotes[k]=data.quotes[k];mirrorQuoteIntoLive(k,data.quotes[k])}watchInvalid=data.invalid||[];watchMissing=data.missing||[];watchFetchedAt=Date.now()}scheduleCaps()}).catch(function(){})}).then(function(){renderWatch();renderHoldings();try{refreshPrices();updateSidebarPrices();updateMobStatusBar();updatePortfolio()}catch(e){logSwallowed("fetchMarketData",e)}})}function refreshMarket(force){if(watchRefreshing)return;/* v311：刚拉过就别再强拉（启动时会被连调两次） */if(force&&Date.now()-watchFetchedAt<3000)return;if(!force&&Date.now()-watchFetchedAt<60000)return;watchRefreshing=true;fetchMarketData().then(function(){watchRefreshing=false},function(){watchRefreshing=false})}
/* ===== 市值：不占首屏 =====
   ① 首屏渲染完之后再拉（省得和价格/行情抢那 6 条并发连接）；
   ② 一次最多 12 只（服务端上限），分块串行，服务端返回 deferred 就继续下一轮；
   ③ 点开某一行时如果这只还没市值，ensureCap 会立刻单独拉这一只。 */
var CAP_CHUNK=12,capPending={},capTimer=0;
function capBase(){return (syncCfg&&syncCfg.url?syncCfg.url:location.origin).replace(/\/$/,'')}
function capSymsList(){var out=[],seen={};function add(s){s=String(s||'').toUpperCase();if(!s||seen[s])return;seen[s]=1;out.push(s)}normalizeWatchlist(watchList).forEach(function(i){if(i.enabled)add(i.sym)});['VGT','SMH'].forEach(function(k){var d=holdingsData[k];if(d&&d.list)d.list.forEach(function(it){add(it.sym)})});return out}
function applyCapPayload(mc,requested){if(!mc||!mc.ok)return;var ck;for(ck in (mc.caps||{})){watchCaps[ck]=Number(mc.caps[ck])||0}(requested||[]).forEach(function(s){if(!Object.prototype.hasOwnProperty.call(watchCaps,s))watchCaps[s]=null});(mc.missing||[]).forEach(function(s){watchCaps[s]=null});(mc.deferred||[]).forEach(function(s){delete watchCaps[s]})}
function resolveCapWaiters(sym){var list=capPending[sym];if(!list)return;delete capPending[sym];list.forEach(function(fn){try{fn(watchCaps[sym])}catch(e){logSwallowed("resolveCapWaiters",e)}})}
function ensureCap(sym,cb){var s=String(sym||'').toUpperCase();if(!s)return;if(Object.prototype.hasOwnProperty.call(watchCaps,s)){if(cb)try{cb(watchCaps[s])}catch(e){logSwallowed("ensureCap",e)}return}var list=capPending[s];if(list){if(cb)list.push(cb);return}capPending[s]=cb?[cb]:[];fetchWithTimeout(capBase()+'/api/marketcap?symbols='+encodeURIComponent(s)).then(function(r){return r.ok?r.json():null}).then(function(mc){applyCapPayload(mc,[s]);resolveCapWaiters(s);saveCapsCache()}).catch(function(){resolveCapWaiters(s)})}
function fetchMarketCaps(){var round=0;var pass=function(){if(round>=3)return Promise.resolve();round+=1;var unknown=capSymsList().filter(function(s){return !Object.prototype.hasOwnProperty.call(watchCaps,s)});if(!unknown.length)return Promise.resolve();var chunks=[],i;for(i=0;i<unknown.length;i+=CAP_CHUNK)chunks.push(unknown.slice(i,i+CAP_CHUNK));var run=function(k){if(k>=chunks.length)return Promise.resolve();var chunk=chunks[k];return fetchWithTimeout(capBase()+'/api/marketcap?symbols='+encodeURIComponent(chunk.join(','))).then(function(r){return r.ok?r.json():null}).then(function(mc){applyCapPayload(mc,chunk);chunk.forEach(resolveCapWaiters)}).catch(function(){}).then(function(){return run(k+1)})};return run(0).then(pass)};return pass().then(saveCapsCache)}
function scheduleCaps(){try{clearTimeout(capTimer)}catch(e){logSwallowed("scheduleCaps",e)}if(Date.now()-capsFetchedAt<CAPS_TTL)return;capTimer=setTimeout(function(){fetchMarketCaps()},1500)}
function saveCapsCache(){try{if(capSymsList().some(function(x){return !Object.prototype.hasOwnProperty.call(watchCaps,x)}))return;writeJSON(CAPS_KEY,{at:Date.now(),caps:watchCaps});capsFetchedAt=Date.now()}catch(e){logSwallowed("saveCapsCache",e)}}
initWatchUI();
(function initDateFillState(){var mark=function(el){if(el&&el.tagName==='INPUT'&&el.type==='date')el.classList.toggle('has-val',!!el.value)};var markAll=function(){document.querySelectorAll('input[type=date]').forEach(mark)};['input','change'].forEach(function(ev){document.addEventListener(ev,function(e){mark(e.target)},true)});markAll();setTimeout(markAll,900)})();

function forceUploadLocal(){showApproval({title:'强制上传本地数据',message:'将用本机数据覆盖云端（包含你刚刚的删除操作）。如果其他设备有更新的改动，会被这次上传覆盖。',confirmText:'强制上传',onConfirm:function(){var base=(syncCfg&&syncCfg.url?syncCfg.url:location.origin).replace(/\/$/,'');if(!syncCfg||!syncCfg.url){showToast('未配置云同步','err');return}var payload={};try{SYNC_KEYS.forEach(function(k){payload[k]=localValOf(k)})}catch(e){showToast('读取本地数据失败','err');return}showBusyToast('正在上传本机数据');syncFetchWithoutHealth('POST',payload).then(function(){SYNC_KEYS.forEach(function(k){try{clearDirty(k)}catch(e){logSwallowed("forceUploadLocal",e)}});try{var s=loadSyncState();s.pendingConflicts=[];s.lastSyncErrorAt=0;s.lastSyncError='';s.failStreak=0;saveSyncState(s)}catch(e){logSwallowed("forceUploadLocal",e)}showToast('已用本机数据覆盖云端','ok');renderSyncHealth()}).catch(function(e){showToast('上传失败：'+(e&&e.message?e.message:'未知错误'),'err')})}})}function initForceUpload(){var b=document.getElementById('syncForceUpload');if(b)b.addEventListener('click',forceUploadLocal)}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initForceUpload)}else{initForceUpload()}

/* 打包成 IIFE 后，把内联事件用到的入口显式暴露到 window */
if(typeof window!=='undefined'){
  var __globals={clearAllData:clearAllData,logoutNow:logoutNow,openAdvancedSettings:openAdvancedSettings,openMobileSettings:openMobileSettings,qaBuy:qaBuy,openOptSheet:openOptSheet,closeOptSheet:closeOptSheet,openTradeSheet:openTradeSheet,closeTradeSheet:closeTradeSheet,openCashSheet:openCashSheet,closeCashSheet:closeCashSheet,qaCall:qaCall,qaClose:qaClose,qaDeposit:qaDeposit,qaSell:qaSell,qaToggle:qaToggle,switchTab:switchTab,togglePrivacy:togglePrivacy,toggleTheme:toggleTheme,adjOtm:adjOtm,assignOpt:assignOpt,copyDiagnostics:copyDiagnostics,delOpt:delOpt,settleOpt:settleOpt,renderOpt:renderOpt,showBusyToast:showBusyToast,toggleArchivedOpt:toggleArchivedOpt,localValOf:localValOf,buildPushData:buildPushData,loadSyncState:loadSyncState,createBackupData:createBackupData,refreshMarket:refreshMarket,saveWatch:saveWatch};
  for(var __k in __globals){try{if(typeof __globals[__k]==='function')window[__k]=__globals[__k]}catch(e){logSwallowed("initForceUpload",e)}}
}


/* ===== v301：可点行可达性（渲染后属性注入 + 事件委托，同样不改任何模板字符串） =====
   现状：持仓/观察/敞口这些行只认鼠标点击（事件委托），没有 role、不可聚焦，键盘和读屏用户够不到。
   这里统一补 role="button" + tabindex="0"，把 Enter/Space 映射成点击。 */
(function(){
  var SEL='.watch-row,.hold-row,.asset-row';
  function markRows(){
    try{
      var list=document.querySelectorAll(SEL);
      for(var i=0;i<list.length;i+=1){
        var el=list[i];
        if(el.getAttribute('role')==='button')continue;
        el.setAttribute('role','button');
        el.setAttribute('tabindex','0');
      }
    }catch(e){logSwallowed("markRows",e)}
  }
  markRows();
  try{new MutationObserver(markRows).observe(document.body,{childList:true,subtree:true})}catch(e){logSwallowed("markRows",e)}
  document.body.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' '&&e.key!=='Spacebar')return;
    var el=e.target;
    if(!el||!el.getAttribute||el.getAttribute('role')!=='button')return;
    var tag=el.tagName;
    if(tag==='BUTTON'||tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA'||tag==='A')return;
    e.preventDefault();
    el.click();
  });
})();
/* ===== v185：持仓行就地展开内联明细（渲染后属性注入 + 事件委托，不改任何模板字符串） ===== */
/* 行上的 onclick="switchTab('data')" 写在模板里，我们不改模板：每次渲染后用属性注入把它摘掉，改由自己接管点击。
   行情刷新会重渲染 #pnlSummary，所以这里记住"当前展开的标的"，重渲染后自动恢复。 */
(function(){
  var host=document.getElementById('pnlSummary');
  if(!host)return;
  var openSym=null;

  var findRow=function(sym){
    var rows=host.querySelectorAll('.asset-row');
    for(var i=0;i<rows.length;i+=1){
      var s=rows[i].querySelector('.asset-identity strong');
      if(s&&String(s.textContent).trim()===sym)return rows[i];
    }
    return null;
  };

  var closeAll=function(){
    var panels=host.querySelectorAll('.hold-detail');
    for(var i=0;i<panels.length;i+=1)panels[i].parentNode.removeChild(panels[i]);
    var rows=host.querySelectorAll('.asset-row.is-open');
    for(var j=0;j<rows.length;j+=1){rows[j].classList.remove('is-open');rows[j].setAttribute('aria-expanded','false')}
  };

  var detailHtml=function(sym,row){
    var pack=computeHoldings(trades);
    var h=(pack&&pack.holdings&&pack.holdings[sym])||{shares:0,cost:0,realized:0};
    var shares=Number(h.shares)||0,cost=Number(h.cost)||0,realized=Number(h.realized)||0;
    var avg=shares>0?cost/shares:0;
    var price=Number(livePrices[sym])||0;
    var value=price>0?shares*price:0;
    var pnl=(price>0&&cost>0)?value-cost:null;
    var pct=pnl===null?null:pnl/cost*100;
    var target=sym==='VGT'?state.vgt:sym==='SMH'?state.smh:sym==='BTC'?state.btc:null;
    var sh=Number(row.getAttribute('data-share'));
    var meta='占比 '+(isFinite(sh)?sh.toFixed(1):'—')+'%';
    if(target!=null&&isFinite(sh)){
      var tv=Number(target)*100;
      meta+=' · 目标 '+tv.toFixed(0)+'% · 偏离 '+(sh-tv>=0?'+':'')+(sh-tv).toFixed(1)+'%';
    }
    var pnlTxt=pnl===null?'—':fmtPnLFull(pnl)+'（'+(pct>=0?'+':'')+pct.toFixed(2)+'%）';
    var pnlCls=pnl===null?'':(pnl>=0?'positive':'negative');
    return ''
      +'<div class="row-detail-grid">'
      +'<span>均价</span><strong>'+(avg>0?'$'+avg.toFixed(2):'—')+'</strong>'
      +'<span>现价</span><strong>'+(price>0?'$'+price.toFixed(2):'—')+'</strong>'
      +'<span>浮动盈亏</span><strong class="'+pnlCls+'">'+pnlTxt+'</strong>'
      +'<span>已实现盈亏</span><strong class="'+(realized>=0?'positive':'negative')+'">'+fmtPnLFull(realized)+'</strong>'
      +'</div>'
      +'<div class="rd-meta">'+meta+'</div>';
  };

  var openPanel=function(row,sym){
    var panel=document.createElement('div');
    panel.className='row-detail hold-detail';
    panel.id='holdDetail-'+sym;
    panel.innerHTML=detailHtml(sym,row);
    row.parentNode.insertBefore(panel,row.nextSibling);
    row.classList.add('is-open');
    row.setAttribute('aria-expanded','true');
    row.setAttribute('aria-controls',panel.id);
  };

  var afterRender=function(){
    var rows=host.querySelectorAll('.asset-row[onclick]');
    for(var i=0;i<rows.length;i+=1){
      rows[i].removeAttribute('onclick');
      if(!rows[i].hasAttribute('aria-expanded'))rows[i].setAttribute('aria-expanded','false');
    }
    if(!openSym)return;
    var row=findRow(openSym);
    if(!row)return;
    var nxt=row.nextElementSibling;
    if(nxt&&nxt.classList&&nxt.classList.contains('hold-detail'))return;
    openPanel(row,openSym);
  };

  afterRender();
  try{new MutationObserver(afterRender).observe(host,{childList:true})}catch(err){logSwallowed("initForceUpload",err)}

  host.addEventListener('click',function(e){
    var row=e.target&&e.target.closest?e.target.closest('.asset-row'):null;
    if(!row||!host.contains(row))return;
    var nxt=row.nextElementSibling;
    var wasOpen=!!(nxt&&nxt.classList&&nxt.classList.contains('hold-detail'));
    closeAll();
    if(wasOpen){openSym=null;return}
    var symEl=row.querySelector('.asset-identity strong');
    var sym=String(symEl?symEl.textContent:'').trim();
    if(!sym)return;
    openSym=sym;
    openPanel(row,sym);
  });
})();

/* ===== v190：策略工具（渲染 + 就地编辑，存进 state 走现有云同步） ===== */
(function(){
  var listIncome=document.getElementById('planIncomeList');
  var listExit=document.getElementById('planExitList');
  if(!listIncome&&!listExit)return;
  var DEFAULTS=PLAN_DEFAULTS;
  var WD=WD_FIELDS;
  var esc=escapeHtml;   // 和 render.js 的转义统一，去掉重复实现

  var readPlan=function(){return readPlanOf(state)};
  var writePlan=function(d){state.plan={income:d.income,exit:d.exit,wd:d.wd};saveState()};

  var applyWd=function(wd){
    WD.forEach(function(f){
      var el=document.getElementById(f[0]);
      if(!el)return;
      var v=wd[f[1]];
      if(!isFinite(v))return;
      el.value=v;
      var lab=document.getElementById('v'+f[0].slice(1));
      if(lab)lab.textContent=f[0].indexOf('Portfolio')>=0?fmt$(parseInt(el.value,10)):(parseFloat(el.value).toFixed(1)+'%');
    });
    try{updateWithdrawal()}catch(e){logSwallowed("initForceUpload",e)}
  };

  var renderAll=function(){
    var d=readPlan();
    if(listIncome){
      listIncome.innerHTML=d.income.map(function(r,i){
        return '<div class="plan-row">'
          +'<span class="plan-age" id="planAge'+(i+1)+'"></span>'
          +'<span class="plan-edit" contenteditable="true" role="textbox" aria-label="档位名称" data-plan="income" data-i="'+i+'" data-k="0">'+esc(r[0])+'</span>'
          +'<span class="plan-amt">'
          +'<span class="plan-edit is-num" contenteditable="true" role="textbox" aria-label="金额下限" data-plan="income" data-i="'+i+'" data-k="1">'+esc(r[1])+'</span>'
          +'<i>–</i>'
          +'<span class="plan-edit is-num" contenteditable="true" role="textbox" aria-label="金额上限" data-plan="income" data-i="'+i+'" data-k="2">'+esc(r[2])+'</span>'
          +'</span></div>';
      }).join('');
    }
    if(listExit){
      listExit.innerHTML=d.exit.map(function(v,i){
        return '<div class="plan-row is-exit">'
          +'<span class="plan-age" id="planExit'+(i+1)+'"></span>'
          +'<span class="plan-edit" contenteditable="true" role="textbox" aria-label="阶段动作" data-plan="exit" data-i="'+i+'" data-k="0">'+esc(v)+'</span>'
          +'</div>';
      }).join('');
    }
    try{updatePlanAges()}catch(e){logSwallowed("initForceUpload",e)}
    applyWd(d.wd);
  };

  // 就地编辑：失焦即存（回车结束编辑）
  document.addEventListener('focusout',function(e){
    var el=e.target;
    if(!el||!el.classList||!el.classList.contains('plan-edit'))return;
    var txt=String(el.textContent||'').replace(/\s+/g,' ').trim();
    var d=readPlan(),kind=el.getAttribute('data-plan'),i=Number(el.getAttribute('data-i')),k=Number(el.getAttribute('data-k'));
    var next=setPlanText(d,kind,i,k,txt);
    if(!next)return;
    el.textContent=txt;
    writePlan(next);
  });
  document.addEventListener('keydown',function(e){
    var el=e.target;
    if(!el||!el.classList||!el.classList.contains('plan-edit'))return;
    if(e.key==='Enter'){e.preventDefault();el.blur()}
  });
  // 提款模拟：滑杆松手即存
  WD.forEach(function(f){
    var el=document.getElementById(f[0]);
    if(!el)return;
    el.addEventListener('change',function(){
      var d=readPlan();
      d.wd[f[1]]=f[0].indexOf('Portfolio')>=0?parseInt(el.value,10):parseFloat(el.value);
      writePlan(d);
    });
  });
  // 恢复默认
  var rst=document.getElementById('planReset');
  if(rst)rst.addEventListener('click',function(e){
    e.stopPropagation();
    try{delete state.plan}catch(err){state.plan=null}
    saveState();
    renderAll();
    try{showToast('已恢复出厂默认')}catch(err){logSwallowed("initForceUpload",err)}
  });
  // 每次展开都按最新 state 重渲染（云端同步过来的值也能刷新）
  var gh=document.querySelector('#strategyTools>.collapsible-header');
  if(gh)gh.addEventListener('click',function(){setTimeout(renderAll,0)});

  renderAll();
  // state 由应用自己的启动流程装载，可能晚于我这段执行：就绪后再同步一次（幂等）
  var lateSync=function(){try{renderAll()}catch(e){logSwallowed("initForceUpload",e)}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',lateSync);
  window.addEventListener('load',lateSync);
  setTimeout(lateSync,700);
})();

/* ===== v195：观察列表补一行「BTC ETF」（BTCETF → Yahoo 的 BTC，即 Grayscale Bitcoin Mini Trust） ===== */
(function(){
  try{
    if(!Array.isArray(watchList))return;
    var hasSpot=false,hasEtf=false,i;
    for(i=0;i<watchList.length;i+=1){
      if(watchList[i]&&watchList[i].sym==='BTC')hasSpot=true;
      if(watchList[i]&&watchList[i].sym==='BTCETF')hasEtf=true;
    }
    if(!hasSpot||hasEtf)return;
    var next=watchList.slice(),idx=-1;
    for(i=0;i<next.length;i+=1){if(next[i]&&next[i].sym==='BTC'){idx=i;break}}
    if(idx<0)return;
    next.splice(idx+1,0,{sym:'BTCETF',kind:'stock',enabled:true});
    saveWatch(next);
    if(typeof refreshMarket==='function')refreshMarket(true);
  }catch(e){logSwallowed("initForceUpload",e)}
})();

/* ===== v196：成分股行没有行情时也能点开（v225：管理入口改到卡头「⋯」菜单） ===== */
(function(){
  // 成分股行：没有行情数据也能展开（名称 / 榜单权重 / 穿透金额 / 加入观察）
  document.addEventListener('click',function(e){
    var row=e.target&&e.target.closest?e.target.closest('#holdingsCard .hold-row'):null;
    if(!row)return;
    var symEl=row.querySelector('.hold-sym');
    var sym=String(symEl&&symEl.childNodes[0]?symEl.childNodes[0].textContent:'').trim();
    if(!sym)return;
    if(watchQuotes[sym])return;            // 有行情时沿用原有详情
    e.preventDefault();
    e.stopPropagation();
    var nxt=row.nextElementSibling;
    if(nxt&&nxt.classList&&nxt.classList.contains('row-detail')){nxt.remove();return}
    var olds=document.querySelectorAll('#holdingsCard .row-detail');
    for(var i=0;i<olds.length;i+=1)olds[i].remove();
    var weight=(symEl.querySelector('small')||{}).textContent||'—';
    var name=row.getAttribute('data-name')||'';
    var amt=(row.querySelector('.hold-price')||{}).textContent||'';
    var inList=false;
    for(var k=0;k<watchList.length;k+=1){if(watchList[k]&&watchList[k].sym===sym){inList=true;break}}
    var d=document.createElement('div');
    d.className='row-detail';
    d.innerHTML='<div class="rd-top"><span class="rd-sym">'+escapeHtml(sym)+'</span><span class="rd-price">'+escapeHtml(amt)+'</span></div>'
      +(name?'<div class="rd-sub">'+escapeHtml(name)+'</div>':'')
      +'<div class="row-detail-grid"><span>榜单权重</span><strong>'+escapeHtml(weight)+'</strong></div>'
      +'<div class="rd-meta">'+(inList?'已在观察列表':'<button type="button" class="btn btn-out btn-sm" data-watch-add="'+escapeHtml(sym)+'">加入观察</button>')+'</div>';
    row.after(d);
  },true);
  // 「加入观察」
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('[data-watch-add]'):null;
    if(!b)return;
    e.preventDefault();
    e.stopPropagation();
    var sym=b.getAttribute('data-watch-add');
    try{
      var next=addWatch(watchList,sym);
      if(next&&next.length!==watchList.length){saveWatch(next);refreshMarket(true);showToast(sym+' 已加入观察列表')}
      else showToast(sym+' 已在观察列表中');
    }catch(err){logSwallowed("initForceUpload",err)}
  },true);
})();

/* ===== v199：观察列表升级（持仓/关注分组 · 英文全名 · 迷你走势 · 决策向详情） ===== */
(function(){
  var host=document.getElementById('watchRows');
  if(!host)return;
  var KEY='wealth_watch_group_open';
  var FALLBACK=FALLBACK_NAMES;
  var busy=false,mo=null;
  var heldShares=function(sym){var n=0;for(var i=0;i<trades.length;i+=1){if(trades[i]&&trades[i].symbol===sym)n+=Number(trades[i].shares)||0}return n};
  /* 持仓归属：观察列表里的 BTC 是加密现货（不属于你的持仓）；你的比特币持仓是 BTC ETF（交易代码 BTC） */
  var HELD_OF=WATCH_HELD_OF;
  var heldSharesFor=function(sym){var src=resolveHeldSymbol(sym);return src?heldShares(src):0};
  var priceOf=function(sym){return quotePrice(watchQuotes[sym],livePrices[sym],readPriceCache()[sym])};
  /* 本地行情缓存按"归属代码"取：BTCETF 的行情在缓存里记在 BTC 名下；现货 BTC 没有本地缓存 */
  var dataSym=function(sym){return resolveHeldSymbol(sym)};
  var histOf=function(sym){return historyOf(readPriceCache(),dataSym(sym))};
  var hiOf=function(sym){return hi52Of(readPriceCache(),dataSym(sym),watchQuotes[sym])};
  /* 加密标的：接口只给"现货"这种中文标签，这里补英文全名并标注现货（与 BTC ETF 行区分） */
  /* 加密全名（后端给 crypto:true 的行情会自动补" · 现货"；这里只把品牌名写准） */
  var CRYPTO_NAME=CRYPTO_NAMES;
  var cleanName=function(sym,q){return cleanNameOf(sym,q)};

  var weightIn=function(sym){
    var out=[];
    Object.keys(holdingsData||{}).forEach(function(etf){
      var list=(holdingsData[etf]&&holdingsData[etf].list)||[];
      for(var i=0;i<list.length;i+=1){if(list[i]&&list[i].sym===sym){out.push(etf+' '+Number(list[i].weight).toFixed(2)+'%');break}}
    });
    return out.join(' + ');
  };
  var buildGroup=function(title,rows,collapsible){
    var g=document.createElement('div');g.className='watch-group';
    var head=document.createElement('button');head.type='button';head.className='watch-group-head';
    head.innerHTML='<span class="wg-name">'+title+'</span><span class="wg-count">'+rows.length+'</span>'+(collapsible?'<span class="watch-group-toggle">展开<b class="watch-group-arrow" aria-hidden="true">▾</b></span>':'');
    var body=document.createElement('div');body.className='watch-group-body';
    for(var i=0;i<rows.length;i+=1)body.appendChild(rows[i]);
    g.appendChild(head);g.appendChild(body);
    if(collapsible){
      var open=false;try{open=readRaw(KEY)==='1'}catch(e){logSwallowed("initForceUpload",e)}
      body.classList.toggle('is-collapsed',!open);
      head.classList.toggle('is-open',open);
      head.setAttribute('aria-expanded',open?'true':'false');
      head.addEventListener('click',function(){
        var collapsed=!body.classList.contains('is-collapsed');
        body.classList.toggle('is-collapsed',collapsed);
        head.classList.toggle('is-open',!collapsed);
        head.setAttribute('aria-expanded',collapsed?'false':'true');
        var tg=head.querySelector('.watch-group-toggle');
        if(tg)tg.innerHTML=(collapsed?'展开':'收起')+'<b class="watch-group-arrow" aria-hidden="true">▾</b>';
        try{LS.setItem(KEY,collapsed?'0':'1')}catch(e){logSwallowed("initForceUpload",e)}
      });
    }
    return g;
  };
  var enhance=function(){
    if(busy)return;
    busy=true;
    if(mo)try{mo.disconnect()}catch(e){logSwallowed("initForceUpload",e)}
    try{
      var rows=[].slice.call(host.querySelectorAll('.watch-row'));
      if(!rows.length)return;
      rows.forEach(function(r){   // 补 data-sym
        var s=r.querySelector('.watch-sym');
        var sym=r.getAttribute('data-sym')||(s&&s.firstChild?String(s.firstChild.textContent).trim():'');
        if(sym)r.setAttribute('data-sym',sym);
      });
      var groups=splitByHolding(rows,function(r){var sym=r.getAttribute('data-sym');return sym?heldSharesFor(sym)*priceOf(sym):0},function(r){var sym=r.getAttribute('data-sym');return !!sym&&heldSharesFor(sym)>0});
      var held=groups.held,watch=groups.watch,total=groups.total;
      rows.forEach(function(r){
        var sym=r.getAttribute('data-sym');
        if(!sym)return;
        var priceEl=r.querySelector('.watch-price'),chgEl=r.querySelector('.watch-chg');
        var priceHTML=priceEl?priceEl.outerHTML:'<span class="watch-price">—</span>';
        var chgHTML=chgEl?chgEl.outerHTML:'<span class="watch-chg is-flat">—</span>';
        var sh=heldSharesFor(sym),p=priceOf(sym),spark=sparklinePath(histOf(sym));
        var nm=cleanName(sym,watchQuotes[sym]);
        var hasName=nm&&nm!==sym;
        var sub=hasName?nm:'';   // 持有/占比在点开的详情里，行内不重复
        r.className='watch-row'+(sh>0?' is-held':'');
        r.setAttribute('data-hold-value',String(Math.round(sh*p)));
        r.setAttribute('data-share',total>0?(sh*p/total*100).toFixed(1):'0.0');
        r.innerHTML='<span class="watch-sym">'+brandBadgeHTML(sym,{accent:symColor(sym)})
          +'<span class="watch-name">'+escapeHtml(sym)+'</span>'
          +(sub?'<small>'+escapeHtml(sub)+'</small>':'')+'</span>'
          +'<span class="watch-spark">'+(spark?'<svg viewBox="0 0 58 20" preserveAspectRatio="none" aria-hidden="true"><path d="'+spark+'"/></svg>':'<i class="watch-spark-none"></i>')+'</span>'
          +priceHTML+chgHTML;
        
      });
      var frag=document.createDocumentFragment();
      if(held.length)frag.appendChild(buildGroup('持仓',held,false));
      if(watch.length)frag.appendChild(buildGroup('关注',watch,true));
      host.textContent='';
      host.appendChild(frag);
    }catch(e){logSwallowed("initForceUpload",e)}finally{busy=false;if(mo)try{mo.observe(host,{childList:true})}catch(e){logSwallowed("initForceUpload",e)}}
  };
  try{mo=new MutationObserver(function(){setTimeout(enhance,0)});mo.observe(host,{childList:true})}catch(e){logSwallowed("initForceUpload",e)}
  enhance();

  // ④ 决策向详情：持有 → 成本/浮动；未持有 → 穿透敞口；都带 52 周位置条（无动作按钮）
  host.addEventListener('click',function(e){
    var row=e.target&&e.target.closest?e.target.closest('.watch-row'):null;
    if(!row)return;
    e.preventDefault();
    e.stopPropagation();
    var nxt=row.nextElementSibling;
    if(nxt&&nxt.classList&&nxt.classList.contains('row-detail')){nxt.remove();return}
    var olds=host.querySelectorAll('.row-detail');
    for(var oi=0;oi<olds.length;oi+=1)olds[oi].remove();
    var sym=row.getAttribute('data-sym')||'';
    var q=watchQuotes[sym]||{};
    var sh=heldSharesFor(sym),p=priceOf(sym),hi=hiOf(sym);
    var prev=Number((q&&q.prevClose)||0)||0;
    var priceTxt=(row.querySelector('.watch-price')||{}).textContent||'—';
    /* 实时重算（不读行上的快照：行情未加载完时打开会看到 $0.00） */
    var total=0;
    ['VGT','SMH'].forEach(function(s){var n=heldShares(s);if(n>0)total+=n*priceOf(s)});
    if(heldShares('BTC')>0)total+=heldShares('BTC')*priceOf('BTCETF');
    var holdVal=sh*p;
    var share=total>0?(holdVal/total*100).toFixed(1):'';
    var costSym=Object.prototype.hasOwnProperty.call(HELD_OF,sym)?HELD_OF[sym]:sym;
    var pack=costSym?computeHoldings(trades):null;
    var h=(pack&&pack.holdings&&pack.holdings[costSym])||null;
    var avg=(h&&h.shares>0)?h.cost/h.shares:0;
    var pnl=(h&&avg>0&&p>0)?(p-avg)*h.shares:null;
    var pnlPct=(pnl!==null&&h.cost>0)?pnl/h.cost*100:null;
    var direct=sh>0;
    var indirect=0,srcs=[];
    ['VGT','SMH'].forEach(function(etf){
      var esh=heldShares(etf),ep=priceOf(etf);
      if(!(esh>0&&ep>0))return;
      var list=(holdingsData[etf]&&holdingsData[etf].list)||[];
      for(var i=0;i<list.length;i+=1){
        if(list[i]&&list[i].sym===sym){
          var w=Number(list[i].weight)||0;
          indirect+=esh*ep*w/100;
          srcs.push(etf+' '+w.toFixed(2)+'%');
          break;
        }
      }
    });
    var grid='';   // 先攒「与我有关」的行，空了就整区不显示
    if(direct){
      grid+='<span>持有</span><strong>'+fmtShares(sh)+' 股 · '+fmtFull(holdVal)+(share?' · 占比 '+share+'%':'')+'</strong>';
      if(avg>0)grid+='<span>均价</span><strong>'+fmtFull(avg)+'</strong>';
      if(pnl!==null)grid+='<span>浮动盈亏</span><strong class="'+(pnl>=0?'positive':'negative')+'">'+fmtPnLFull(pnl)+'（'+(pnlPct>=0?'+':'')+pnlPct.toFixed(2)+'%）</strong>';
    }else{
      if(indirect>0)grid+='<span>间接持有</span><strong>≈ '+fmtFull(Math.round(indirect))+'（通过 '+escapeHtml(srcs.join(' + '))+'）</strong>';
    }
    var gap=(hi>0&&p>0)?((p-hi)/hi*100):null;
    if(grid)grid='<div class="rd-sec">与我有关</div><div class="row-detail-grid watch-detail-grid">'+grid+'</div>';
    grid+='<div class="rd-sec">市场位置</div><div class="row-detail-grid watch-detail-grid">';grid+='<span>总市值</span>'+capCellHTML(sym);
    if(prev>0&&p>0)grid+='<span>昨日收盘</span><strong>'+fmtFull(prev)+'</strong>';
    if(prev>0&&p>0)grid+='<span>今日涨跌</span><strong class="'+(p>=prev?'positive':'negative')+'">'+(p>=prev?'+':'-')+fmtFull(Math.abs(p-prev)).replace('$','$')+'（'+((p-prev)/prev*100>=0?'+':'')+((p-prev)/prev*100).toFixed(2)+'%）</strong>';
    if(gap!==null)grid+='<span>距 52 周高点</span><strong>'+(gap>=0?'+':'')+gap.toFixed(1)+'%（高点 '+fmtFull(hi)+'）</strong>';
    else grid+='<span>52 周高点</span><strong>暂无数据</strong>';
    grid+='</div>';
    var bar='';
    if(gap!==null){
      var fill=Math.max(2,Math.min(100,p/hi*100));
      bar='<div class="watch-range"><i style="width:'+fill.toFixed(1)+'%"></i><b style="left:'+fill.toFixed(1)+'%"></b></div>';
    }
    var d=document.createElement('div');
    d.className='row-detail watch-detail';
    var chgEl=row.querySelector('.watch-chg');
    var chgHTML=chgEl?chgEl.outerHTML:'';
    d.innerHTML='<div class="rd-top"><span class="rd-sym">'+escapeHtml(sym)+'</span><span class="rd-price">'+escapeHtml(priceTxt)+(chgHTML?' '+chgHTML:'')+'</span></div>'
      +'<div class="rd-sub">'+escapeHtml(cleanName(sym,q))+'</div>'+grid+bar;
    row.after(d);ensureCap(sym,function(){updateCapCells(sym)});
  },true);
})();

/* ===== v215：观察列表搜索（代码 / 英文名 / 中文别名；搜不到用行情接口按代码兜底） ===== */
(function(){
  var card=document.getElementById('watchCard'),host=document.getElementById('watchRows');
  if(!card||!host)return;
  var btn=document.getElementById('btnWatchAddOpen');
  var panel=document.createElement('div');
  panel.className='watch-search';panel.id='watchSearchPanel';panel.hidden=true;
  var head=document.createElement('div');head.className='watch-search-head';
  var input=document.createElement('input');
  input.id='watchSearchInput';input.className='settings-input';input.type='search';
  input.placeholder='代码或名称，如 NVDA / 英伟达';input.setAttribute('aria-label','搜索标的');
  var close=document.createElement('button');
  close.type='button';close.className='btn btn-out btn-sm';close.id='watchSearchClose';close.textContent='关闭';
  head.appendChild(input);head.appendChild(close);
  var list=document.createElement('div');list.className='watch-search-list';list.id='watchSearchList';
  panel.appendChild(head);panel.appendChild(list);
  var manage=document.getElementById('watchManage');
  card.insertBefore(panel,manage||host);
  var extra={};
  /* 内置名单：S&P 100 ∪ 纳斯达克100 共 167 条（解析自维基百科成分表的「代码列 + 公司列」） */
  /* 名单内按代码/名称都能搜到；名单外用「按代码查询」兜底（加密纯代码即可，自动按 CODE-USD 解析） */
  function inList(sym){for(var i=0;i<watchList.length;i+=1){if(watchList[i]&&watchList[i].sym===sym)return true}return false}
  function priceOf2(sym){return searchRowPrice(watchQuotes[sym]||extra[sym])}
  function mkRow(sym,name){
    var t=priceOf2(sym),has=inList(sym),row=document.createElement('div');
    row.className='watch-search-row';row.insertAdjacentHTML('afterbegin',brandBadgeHTML(sym,{accent:symColor(sym)}));
    var a=document.createElement('span');a.className='wsr-sym';a.textContent=sym;
    var b=document.createElement('span');b.className='wsr-name';b.textContent=name||'';
    var c=document.createElement('span');c.className='wsr-price';c.textContent=t.p;
    var d=document.createElement('span');d.className='wsr-chg is-'+t.cls;d.textContent=t.c;
    var e2=document.createElement('button');
    e2.type='button';e2.className='btn btn-out btn-sm';e2.setAttribute('data-sym',sym);
    e2.textContent=has?'已在 ✓':'+ 加入';
    e2.addEventListener('click',function(){toggle(sym)});
    row.setAttribute('data-sym',sym);
    row.appendChild(a);row.appendChild(b);row.appendChild(c);row.appendChild(d);row.appendChild(e2);
    return row;
  }
  function baseUrl(){return (syncCfg&&syncCfg.url?syncCfg.url:location.origin).replace(/\/$/,'')}
  var hydratedKey='';
  /* 结果行只要有没行情的，就批量拉一次（最多 8 条，远低于接口 40 上限），拿到后重绘 */
  function hydrate(){
    var rows=list.querySelectorAll('.watch-search-row[data-sym]'),need=[];
    for(var i=0;i<rows.length;i+=1){var s=rows[i].getAttribute('data-sym');if(!(watchQuotes[s]||extra[s])&&need.indexOf(s)<0)need.push(s)}
    if(!need.length)return;
    var key=need.join(',');
    if(hydratedKey===key)return;
    hydratedKey=key;
    fetchWithTimeout(baseUrl()+'/api/quotes?symbols='+encodeURIComponent(key)).then(function(r){return r.ok?r.json():null}).then(function(j){
      if(j&&j.quotes){for(var k in j.quotes)extra[k]=j.quotes[k]}
      render(input.value);
    }).catch(function(){});
  }
  function render(q){
    q=String(q||'').trim().toLowerCase();
    list.textContent='';
    if(!q){var em=document.createElement('div');em.className='table-empty';em.textContent='输入代码或名称开始搜索';list.appendChild(em);return}
    var hits=searchSymbols(q);
    
    if(hits.length){hits.forEach(function(it){list.appendChild(mkRow(it[0],it[1]))});hydrate();return}
    var code=q.toUpperCase();
    if(inList(code)){list.appendChild(mkRow(code,'已在观察列表'));hydrate();return}
    var qr=document.createElement('div');qr.className='watch-search-row';qr.insertAdjacentHTML('afterbegin',brandBadgeHTML(code,{accent:symColor(code)}));
    var s1=document.createElement('span');s1.className='wsr-sym';s1.textContent=code;
    var s2=document.createElement('span');s2.className='wsr-name';s2.textContent='未收录，点右侧按代码查询行情';
    var qb=document.createElement('button');qb.type='button';qb.className='btn btn-out btn-sm';qb.textContent='查询';
    qb.addEventListener('click',function(){query(code)});
    qr.appendChild(s1);qr.appendChild(s2);qr.appendChild(qb);list.appendChild(qr);
  }
  function toggle(sym){
    try{
      if(inList(sym)){saveWatch(removeWatch(watchList,sym));showToast(sym+' 已移出观察列表')}
      else{var next=addWatch(watchList,sym);if(next&&next.length!==watchList.length){saveWatch(next);refreshMarket(true);showToast(sym+' 已加入观察列表')}else showToast(sym+' 已在观察列表中')}
      render(input.value);
    }catch(e){logSwallowed("toggle",e)}
  }
  function query(code){
    var base=baseUrl();
    list.textContent='';
    var em=document.createElement('div');em.className='table-empty';em.textContent='查询中';list.appendChild(em);
    fetchWithTimeout(base+'/api/quotes?symbols='+encodeURIComponent(code)).then(function(r){return r.ok?r.json():null}).then(function(j){
      var q=j&&j.quotes?j.quotes[code]:null;
      list.textContent='';
      if(!q){var e3=document.createElement('div');e3.className='table-empty';e3.textContent='没有找到 '+code+' 的行情（代码可能不存在）';list.appendChild(e3);return}
      extra[code]=q;list.appendChild(mkRow(code,q.name||code));
    }).catch(function(){list.textContent='';var e4=document.createElement('div');e4.className='table-empty';e4.textContent='查询失败，请稍后再试';list.appendChild(e4)});
  }
  btn.addEventListener('click',function(){
    panel.hidden=!panel.hidden;btn.setAttribute('aria-expanded',String(!panel.hidden));btn.classList.toggle('is-open',!panel.hidden);
    if(!panel.hidden){var mm=document.getElementById('watchMenu');if(mm)mm.hidden=true;var mb2=document.getElementById('btnWatchMore');if(mb2)mb2.setAttribute('aria-expanded','false');render(input.value);input.focus()}
  });
  close.addEventListener('click',function(){panel.hidden=true;btn.classList.remove('is-open')});
  var timer=null;
  input.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){render(input.value)},150)});
  input.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
    e.preventDefault();
    var t=String(input.value||'').trim().toUpperCase();
    if(t&&!inList(t))query(t);
  });
  render('');
})();


/* ===== 账号：改密码 / 管理用户（仅主账号）/ 退出登录 ===== */
function accountRequest(method, body, path) {
  return fetchWithTimeout(path || '/api/accounts', { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
}
function fmtAccTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; }
}
function accEsc(text) { return escapeHtml(String(text == null ? '' : text)); }
function renderAccountPanel(info) {
  var cur = document.getElementById('accountCurrent');
  var list = document.getElementById('accountListBox');
  var me = info && info.me;
  if (cur) cur.textContent = me ? ('当前账号：' + me.username + (me.role === 'owner' ? '（主账号）' : '')) : '未取到账号信息';
  var isOwner = !!(me && me.role === 'owner');
  // 非主账号：把「管理用户」这一行入口藏掉（服务端同样会拒，这里只是不让他点了白跑）
  var usersRow = document.getElementById('menuUsersRow');
  if (usersRow) usersRow.hidden = !isOwner;
  if (!list || !isOwner) return;
  list.innerHTML = (info.accounts || []).map(function (a) {
    var self = Number(a.id) === Number(me.id);
    return '<div class="acc-row' + (a.disabled ? ' is-off' : '') + '" data-acc-id="' + a.id + '">'
      + '<span class="acc-name">' + accEsc(a.username) + (self ? '<em>我</em>' : '') + (a.disabled ? '<em>已禁用</em>' : '') + '</span>'
      + '<span class="acc-meta">' + a.keys + ' 行 · 最近登录 ' + fmtAccTime(a.lastSeenAt) + '</span>'
      + '<span class="acc-actions" data-acc-actions="' + a.id + '">'
      + '<button type="button" data-acc-act="reset">重置密码</button>'
      + (self ? '' : '<button type="button" data-acc-act="toggle">' + (a.disabled ? '启用' : '禁用') + '</button><button type="button" class="danger" data-acc-act="delete">删除</button>')
      + '</span></div>';
  }).join('');
}
function loadAccounts() {
  accountRequest('GET').then(function (res) {
    if (res.status === 200 && res.body && res.body.ok) renderAccountPanel(res.body);
    else if (res.status === 401) location.replace('/login');
  }).catch(function () {});
}
function downloadJson(name, obj) {
  try {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  } catch (e) { logSwallowed('downloadJson', e); }
}
function setAccStatus(text, id) {
  var el = document.getElementById(id || 'accountStatus');
  if (el) el.textContent = text || '';
}
/* 活动记录：主账号看到所有人的，成员只看到自己的（服务端已经按权限过滤） */
function activityText(ev) {
  var kind = ev.kind === 'login' ? '登录' : (ev.kind === 'sync' ? '同步' : '管理');
  var detail = ev.detail || '';
  return '<div class="acc-ev"><span class="acc-ev-time">' + fmtAccTime(ev.ts) + '</span>'
    + '<span class="acc-ev-kind">' + kind + '</span>'
    + '<span class="acc-ev-text">' + accEsc(detail) + '</span></div>';
}
function loadActivity() {
  var box = document.getElementById('accountActivity');
  if (!box) return;
  fetchWithTimeout('/api/activity?limit=30').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.ok) { box.textContent = '暂时读不到活动记录'; return; }
    if (!j.events.length) { box.textContent = '还没有记录'; return; }
    var scope = j.scope === 'all' ? '（全部账号）' : '（仅自己）';
    box.innerHTML = j.events.map(function (ev) {
      var who = j.scope === 'all' ? '<span class="acc-ev-who">' + accEsc(ev.username) + '</span>' : '';
      return activityText(ev).replace('<span class="acc-ev-time">', who + '<span class="acc-ev-time">');
    }).join('') + '<div class="acc-ev-note">显示最近 30 条' + scope + '</div>';
  }).catch(function () { box.textContent = '暂时读不到活动记录'; });
}
/* 本机残留：同一台设备登过别的账号时会留下 u<id>: 前缀的数据 */
function otherLocalNamespaces() {
  var mine = storageNamespace();
  var found = {};
  try {
    for (var i = 0; i < localStorage.length; i += 1) {
      var key = localStorage.key(i);
      var m = key && key.match(/^(u\d+):/);
      if (!m || m[1] + ':' === mine) continue;
      var ns = m[1];
      found[ns] = (found[ns] || 0) + 1;
    }
  } catch (e) { logSwallowed('otherLocalNamespaces', e); }
  return found;
}
function scanLocalLeftovers() {
  var info = document.getElementById('localInfo');
  var btn = document.getElementById('accountCleanLocal');
  var found = otherLocalNamespaces();
  var names = Object.keys(found);
  var total = 0;
  names.forEach(function (ns) { total += found[ns]; });
  if (info) info.textContent = names.length ? ('本机还留着 ' + names.length + ' 个其它账号的数据（共 ' + total + ' 项）') : '本机没有其它账号的残留';
  if (btn) btn.disabled = !names.length;
}
function cleanOtherLocalData() {
  var found = otherLocalNamespaces();
  var names = Object.keys(found);
  if (!names.length) { setAccStatus('没有需要清理的数据', 'localStatus'); return; }
  var total = 0;
  names.forEach(function (ns) { total += found[ns]; });
  showApproval({
    title: '清理本机其它账号的数据',
    message: '会删掉本机上 ' + names.length + ' 个其它账号的本地缓存（共 ' + total + ' 项）。云端数据不受影响，那些账号下次在自己设备上登录会自动重新拉取。',
    confirmText: '清理',
    onConfirm: function () {
      var removed = 0;
      try {
        for (var i = localStorage.length - 1; i >= 0; i -= 1) {
          var key = localStorage.key(i);
          var m = key && key.match(/^(u\d+):/);
          if (m && m[1] + ':' !== storageNamespace()) { localStorage.removeItem(key); removed += 1; }
        }
      } catch (e) { logSwallowed('cleanOtherLocalData', e); }
      setAccStatus('已清理 ' + removed + ' 项', 'localStatus');
      scanLocalLeftovers();
    },
  });
}
function initAccountPanel() {
  var createBtn = document.getElementById('accountCreateBtn');
  if (createBtn) createBtn.addEventListener('click', function () {
    var u = String((document.getElementById('accountNewUser') || {}).value || '').trim().toLowerCase();
    var p = String((document.getElementById('accountNewPass') || {}).value || '');
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(u)) { setAccStatus('用户名要英文小写字母开头，3-32 位，可含数字 . _ -'); return; }
    if (p.length < 6) { setAccStatus('密码至少 6 位'); return; }
    createBtn.disabled = true; setAccStatus('正在创建…');
    accountRequest('POST', { username: u, password: p }).then(function (res) {
      createBtn.disabled = false;
      if (res.status === 200 && res.body && res.body.ok) {
        setAccStatus('已创建 ' + u + ' —— 用它登录即可，数据完全独立');
        var pw = document.getElementById('accountNewPass'); if (pw) pw.value = '';
        var nu = document.getElementById('accountNewUser'); if (nu) nu.value = '';
        loadAccounts();
      } else {
        var map = { 'username taken': '这个用户名已被占用', 'invalid username': '用户名格式不对', 'password too short': '密码至少 6 位', forbidden: '只有主账号能加人' };
        var code = (res.body && res.body.error) || res.status;
        setAccStatus(map[code] || ('创建失败：' + code));
      }
    }, function () { createBtn.disabled = false; setAccStatus('网络错误，请重试'); });
  });
  var passBtn = document.getElementById('accountPassBtn');
  if (passBtn) passBtn.addEventListener('click', function () {
    var cur = String((document.getElementById('accountCurPass') || {}).value || '');
    var next = String((document.getElementById('accountNewPassSelf') || {}).value || '');
    if (!cur) { setAccStatus('请输入当前密码', 'accountPassStatus'); return; }
    if (next.length < 6) { setAccStatus('新密码至少 6 位', 'accountPassStatus'); return; }
    passBtn.disabled = true; setAccStatus('正在保存…', 'accountPassStatus');
    accountRequest('POST', { current: cur, next: next }, '/api/me/password').then(function (res) {
      passBtn.disabled = false;
      if (res.status === 200 && res.body && res.body.ok) {
        setAccStatus('密码已更新（其它设备上的旧登录已失效）', 'accountPassStatus');
        var a = document.getElementById('accountCurPass'); if (a) a.value = '';
        var b = document.getElementById('accountNewPassSelf'); if (b) b.value = '';
      } else {
        setAccStatus((res.body && res.body.error) === 'wrong password' ? '当前密码不对' : '改密码失败：' + ((res.body && res.body.error) || res.status), 'accountPassStatus');
      }
    }, function () { passBtn.disabled = false; setAccStatus('网络错误，请重试', 'accountPassStatus'); });
  });
  var listBox = document.getElementById('accountListBox');
  if (listBox) listBox.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-acc-act]') : null;
    if (!btn) return;
    var row = btn.closest('[data-acc-id]');
    if (!row) return;
    var id = row.getAttribute('data-acc-id');
    var act = btn.getAttribute('data-acc-act');
    var actions = row.querySelector('[data-acc-actions]');
    if (act === 'reset') {
      actions.innerHTML = '<input type="password" class="acc-inline" placeholder="新密码（≥6 位）"><button type="button" data-acc-act="reset-ok">确定</button><button type="button" data-acc-act="cancel">取消</button>';
      return;
    }
    if (act === 'cancel') { loadAccounts(); return; }
    if (act === 'reset-ok') {
      var val = String((row.querySelector('.acc-inline') || {}).value || '');
      if (val.length < 6) { setAccStatus('密码至少 6 位'); return; }
      setAccStatus('正在重置…');
      accountRequest('PATCH', { password: val }, '/api/accounts/' + id).then(function (res) {
        if (res.status === 200 && res.body && res.body.ok) { setAccStatus('已重置该账号的密码，旧设备上的登录已失效'); loadAccounts(); }
        else setAccStatus('重置失败：' + ((res.body && res.body.error) || res.status));
      }, function () { setAccStatus('网络错误'); });
      return;
    }
    if (act === 'toggle') {
      var turnOff = btn.textContent === '禁用';
      accountRequest('PATCH', { disabled: turnOff }, '/api/accounts/' + id).then(function (res) {
        if (res.status === 200 && res.body && res.body.ok) { setAccStatus(turnOff ? '已禁用（数据保留）' : '已启用'); loadAccounts(); }
        else setAccStatus('操作失败：' + ((res.body && res.body.error) || res.status));
      }, function () { setAccStatus('网络错误'); });
      return;
    }
    if (act === 'delete') {
      var name = (row.querySelector('.acc-name') || {}).textContent || '';
      showApproval({
        title: '删除账号 ' + name.trim(),
        message: '该账号的全部云端数据会被删除（删除前会自动导出一份 JSON 文件给你）。此操作不可撤销。',
        confirmText: '导出并删除',
        onConfirm: function () {
          setAccStatus('正在删除…');
          accountRequest('DELETE', null, '/api/accounts/' + id).then(function (res) {
            if (res.status === 200 && res.body && res.body.ok) {
              if (res.body.exported) downloadJson('account-' + res.body.exported.username + '-' + Date.now() + '.json', res.body.exported);
              setAccStatus('已删除，数据已导出到下载目录');
              loadAccounts();
            } else setAccStatus('删除失败：' + ((res.body && res.body.error) || res.status));
          }, function () { setAccStatus('网络错误'); });
        },
      });
      return;
    }
  });
  var out = document.getElementById('accountLogoutBtn');
  if (out) out.addEventListener('click', logoutNow);
  var cleanBtn = document.getElementById('accountCleanLocal');
  if (cleanBtn) cleanBtn.addEventListener('click', cleanOtherLocalData);
  var entry = document.getElementById('sbSettingsEntry');
  if (entry) entry.addEventListener('click', function () { setTimeout(function () { loadAccounts(); loadActivity(); scanLocalLeftovers(); }, 80); });
  loadAccounts();
  loadActivity();
  scanLocalLeftovers();
}
initAccountPanel();

/* 开屏动画收尾：App 已经把内容渲染出来了，再让开屏淡出 */
(function bootSplashOut(){var el=document.getElementById('bootSplash');if(!el)return;var t0=window.__bootAt||Date.now();var wait=Math.max(0,1500-(Date.now()-t0));setTimeout(function(){el.classList.add('is-gone');setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},380)},wait)})();
