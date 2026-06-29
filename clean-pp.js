var fs = require('fs');
var c = fs.readFileSync('public/index.html', 'utf8');

// 1. pricePill: remove extLabel from signature and logic
c = c.replace(
  "function pricePill(sym,price,change,source,extLabel){var dotCls='live-dot';if(extLabel==='盘后')dotCls='live-dot post';if(extLabel==='盘前')dotCls='live-dot pre';var dot=source&&source!=='缓存'&&source!=='manual'?'<span class=\"'+dotCls+'\"'+(extLabel?' title=\"'+extLabel+'\"':'')+'></span>':'';",
  "function pricePill(sym,price,change,source){var dot=source&&source!=='缓存'&&source!=='manual'?'<span class=\"live-dot\"></span>':'';"
);

// 2. refreshPrices: remove extLabel handling
c = c.replace(
  "cachePrice(sym,d);if(d.extLabel)liveExtLabels[sym]=d.extLabel;return pricePill(sym,d.price,d.change,d.source,d.extLabel||'')",
  "cachePrice(sym,d);return pricePill(sym,d.price,d.change,d.source)"
);

// 3. Sidebar pricePill: remove extLabel
c = c.replace(
  "pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',liveExtLabels[sym]||'')",
  "pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'')"
);

// 4. Remove updateMktStatus call
c = c.replace(');updateMktStatus();updatePortfolio()', ');updatePortfolio()');

// 5. Remove liveExtLabels global
c = c.replace('liveExtLabels={},', '');

// 6. fetchPrice: revert to simple (use meta directly)
c = c.replace(
  "if(j.price>0)return{price:j.price,prevClose:j.prevClose||j.price,change:j.price-(j.prevClose||j.price),hi52:j.hi52||0,source:'yahoo',time:Date.now(),extLabel:j.marketState==='post'?'盘后':j.marketState==='pre'?'盘前':''}",
  "if(m&&m.regularMarketPrice>0)return{price:m.regularMarketPrice,prevClose:m.chartPreviousClose||m.previousClose||m.regularMarketPrice,change:m.regularMarketPrice-(m.chartPreviousClose||m.previousClose||m.regularMarketPrice),hi52:m.fiftyTwoWeekHigh||0,source:'yahoo',time:Date.now()}"
);

fs.writeFileSync('public/index.html', c);
console.log('Part 1 done');
