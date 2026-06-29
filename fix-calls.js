var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// refreshPrices: Date.now()-d.time → just extLabel
c=c.replace("pricePill(sym,d.price,d.change,d.source,Date.now()-d.time,d.extLabel||'')","pricePill(sym,d.price,d.change,d.source,d.extLabel||'')");

// cache fallback: remove cAge calculation
c=c.replace("if(livePrices[sym]){var cp=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}'),cAge=cp[sym]&&cp[sym].time?Date.now()-cp[sym].time:3600000;return pricePill(sym,livePrices[sym],liveChanges[sym],'cache',cAge,'')}","if(livePrices[sym]){return pricePill(sym,livePrices[sym],liveChanges[sym],'cache','')}");

// updatePortfolio: remove cpAge IIFE + age
c=c.replace("document.getElementById('hmPricesCompact').innerHTML=((function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');return ETF_SYMS.map(function(sym){var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',age,''):","document.getElementById('hmPricesCompact').innerHTML=ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',''):");
c=c.replace("}).join('')})();","}).join('');");

console.log('All call sites updated');
f.writeFileSync('public/index.html',c,'utf8');
