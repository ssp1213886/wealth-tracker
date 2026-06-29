var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Fix refreshPrices
c=c.replace("pricePill(sym,d.price,d.change,d.source,Date.now()-d.time,d.extLabel||'')","pricePill(sym,d.price,d.change,d.source,d.extLabel||'')");

// Fix cache fallback
c=c.replace("if(livePrices[sym]){var cp=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}'),cAge=cp[sym]&&cp[sym].time?Date.now()-cp[sym].time:3600000;return pricePill(sym,livePrices[sym],liveChanges[sym],'cache',cAge,'')}","if(livePrices[sym]){return pricePill(sym,livePrices[sym],liveChanges[sym],'cache','')}");

// Fix updatePortfolio — replace cpAge IIFE pattern  
// Pattern: document.getElementById('hmPricesCompact').innerHTML=((function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');return ETF_SYMS.map(function(sym){var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',age,''):
// To:       document.getElementById('hmPricesCompact').innerHTML=ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',''):
var oldIIFE="(function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');return ";
while(c.indexOf(oldIIFE)>=0) c=c.replace(oldIIFE,'');
var oldAge="var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return ";
while(c.indexOf(oldAge)>=0) c=c.replace(oldAge,'return ');
// Fix ))((...) wrapping
while(c.indexOf(")((function(){")>=0) c=c.replace(")((function(){",'(');
// Fix pricePill calls still using ,age,''
while(c.indexOf(",age,'')")>=0) c=c.replace(",age,'')",",'','')");
// Fix closing
while(c.indexOf("}).join('')})();")>=0) c=c.replace("}).join('')})();","}).join('');");

// Fix updateSidebarPrices — remove m>5 stale warning
c=c.replace("age=m>5?'⚠️ '+(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前'):(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前')","age=m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前'");

// Add CSS for colored dots  
c=c.replace("pulse 2s ease-in-out infinite}","pulse 2s ease-in-out infinite}.live-dot.pre{background:#ff9800;animation-name:none}.live-dot.post{background:#2196f3;animation-name:none}");

f.writeFileSync('public/index.html',c,'utf8');
console.log('Done.');
console.log('PRICE_AGE:',c.indexOf('PRICE_AGE_WARN')>=0?'STILL':'OK');
console.log('dataAge:',c.indexOf('dataAge')>=0?'STILL':'OK');
console.log('cpAge:',c.indexOf('cpAge')>=0?'STILL':'OK');
console.log('cAge:',c.indexOf('cAge')>=0?'STILL':'OK');
