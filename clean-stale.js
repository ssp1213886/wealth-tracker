var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// 1. Remove PRICE_AGE_WARN_MS from constants
var old1='tradeIdCounter=0,PRICE_AGE_WARN_MS=5*60*1000;';
var rep1='tradeIdCounter=0;';
c=c.replace(old1,rep1);
var old1b='tradeIdCounter=0,PRICE_AGE_WARN_MS=5*60*1000';
if(c.indexOf(rep1)<0){c=c.replace(old1b,rep1)}

// 2. Simplify pricePill — remove stale, dataAge, extLabel params
var old2='function pricePill(sym,price,change,source,dataAge,extLabel){var stale=dataAge>PRICE_AGE_WARN_MS?\'<span title="数据延迟" style="font-size:.65rem;">⚠️</span> \':\'\';var dotCls=\'live-dot\';if(extLabel===\'盘后\')dotCls=\'live-dot post\';if(extLabel===\'盘前\')dotCls=\'live-dot pre\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'&&dataAge<=PRICE_AGE_WARN_MS?\'<span class="\'+dotCls+\'"\'+(extLabel?\' title="\'+extLabel+\'价格"\':\'\')+\'></span>\':\'\';';
// The actual code in file might have 'function pricePill(sym,price,change,source,dataAge,extLabel){...'
// But all on one line. Let me find it and replace in place.
var idx2=c.indexOf('function pricePill(');
var end2=c.indexOf('async function refreshPrices()',idx2);
var fn2=c.substring(idx2,end2);
console.log('pricePill length:',fn2.length);

var newPill='function pricePill(sym,price,change,source,extLabel){var dotCls=\'live-dot\';if(extLabel===\'盘后\')dotCls=\'live-dot post\';if(extLabel===\'盘前\')dotCls=\'live-dot pre\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'?\'<span class="\'+dotCls+\'"\'+(extLabel?\' title="\'+extLabel+\'价格"\':\'\')+\'></span>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ch+sl+\'</span>\'}';

c=c.replace(fn2.trim(),newPill);

// 3. Fix refreshPrices calls — remove dataAge from pricePill(...,Date.now()-d.time,...)
// Find: pricePill(sym,d.price,d.change,d.source,Date.now()-d.time,d.extLabel||'')
var old3='pricePill(sym,d.price,d.change,d.source,Date.now()-d.time,d.extLabel||\'\')';
var rep3='pricePill(sym,d.price,d.change,d.source,d.extLabel||\'\')';
c=c.replace(old3,rep3);

// 4. Fix cache fallback: pricePill(sym,livePrices[sym],liveChanges[sym],'cache',cAge,'')
// This is more complex. Let me find and replace the whole line
var old4='if(livePrices[sym]){var cp=JSON.parse(localStorage.getItem(PRICE_KEY)||\'{}\'),cAge=cp[sym]&&cp[sym].time?Date.now()-cp[sym].time:3600000;return pricePill(sym,livePrices[sym],liveChanges[sym],\'cache\',cAge,\'\')}';
var rep4='if(livePrices[sym]){return pricePill(sym,livePrices[sym],liveChanges[sym],\'cache\',\'\')}';
c=c.replace(old4,rep4);

// 5. Fix updatePortfolio display — remove age calculation
var old5='document.getElementById(\'hmPricesCompact\').innerHTML=((function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||\'{}\');return ETF_SYMS.map(function(sym){var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||\'\',age,\'\'):';
var rep5='document.getElementById(\'hmPricesCompact\').innerHTML=ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||\'\',\'\'):';
c=c.replace(old5,rep5);

// 6. Close the map function (was })(), need to change to })
c=c.replace('}).join(\'\')})();','}).join(\'\');');

// 7. Remove stale check from updateSidebarPrices — revert age line
var old6='if(t){var m=Math.round((Date.now()-t)/60000);age=m>5?\'⚠️ \'+(m<1?\'刚刚\':m<60?m+\'分钟前\':m<1440?Math.floor(m/60)+\'小时前\':Math.floor(m/1440)+\'天前\'):(m<1?\'刚刚\':m<60?m+\'分钟前\':m<1440?Math.floor(m/60)+\'小时前\':Math.floor(m/1440)+\'天前\');ts=';
var rep6='if(t){var m=Math.round((Date.now()-t)/60000);age=m<1?\'刚刚\':m<60?m+\'分钟前\':m<1440?Math.floor(m/60)+\'小时前\':Math.floor(m/1440)+\'天前\';ts=';
c=c.replace(old6,rep6);

f.writeFileSync('public/index.html',c,'utf8');
console.log('All replacements done');
