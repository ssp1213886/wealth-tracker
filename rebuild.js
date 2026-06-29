var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// ======================
// 1. Remove PRICE_AGE_WARN_MS constant
// ======================
c=c.replace('PRICE_AGE_WARN_MS=5*60*1000,','');
c=c.replace(',PRICE_AGE_WARN_MS=5*60*1000','');
console.log('1. PRICE_AGE_WARN_MS removed');

// ======================
// 2. Replace pricePill - remove stale/dataAge, [盘后] text → colored dot
// ======================
var oldFn='function pricePill(sym,price,change,source,dataAge,extLabel){var stale=dataAge>PRICE_AGE_WARN_MS?\'<span title="数据延迟" style="font-size:.65rem;">⚠️</span> \':\'\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'&&dataAge<=PRICE_AGE_WARN_MS?\'<span class="live-dot"></span>\':\'\';var ext=extLabel?\' <small style="color:var(--accent);font-size:.5rem;">[\'+extLabel+\']</small>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ext+ch+sl+\'</span>\'}';
var newFn='function pricePill(sym,price,change,source,extLabel){var dotCls=\'live-dot\';if(extLabel===\'盘后\')dotCls=\'live-dot post\';if(extLabel===\'盘前\')dotCls=\'live-dot pre\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'?\'<span class="\'+dotCls+\'"\'+(extLabel?\' title="\'+extLabel+\'价格"\':\'\')+\'></span>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ch+sl+\'</span>\'}';
if(c.indexOf(oldFn)>=0){c=c.replace(oldFn,newFn);console.log('2. pricePill replaced')}else{console.log('2. FAIL: oldFn not found')}

// ======================
// 3. Fix refreshPrices call
// ======================
c=c.replace("pricePill(sym,d.price,d.change,d.source,Date.now()-d.time,d.extLabel||'')","pricePill(sym,d.price,d.change,d.source,d.extLabel||'')");
console.log('3. refreshPrices call fixed');

// ======================
// 4. Fix cache fallback
// ======================
c=c.replace("if(livePrices[sym]){var cp=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}'),cAge=cp[sym]&&cp[sym].time?Date.now()-cp[sym].time:3600000;return pricePill(sym,livePrices[sym],liveChanges[sym],'cache',cAge,'')}","if(livePrices[sym]){return pricePill(sym,livePrices[sym],liveChanges[sym],'cache','')}");
console.log('4. cache fallback fixed');

// ======================
// 5. Fix updatePortfolio (remove cpAge IIFE)
// ======================
c=c.replace("document.getElementById('hmPricesCompact').innerHTML=((function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||'{}');return ETF_SYMS.map(function(sym){var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',age,''):","document.getElementById('hmPricesCompact').innerHTML=ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'',''):");
c=c.replace("}).join('')})();","}).join('');");
console.log('5. updatePortfolio fixed');

// ======================
// 6. Fix updateSidebarPrices m>5 stale warning
// ======================
c=c.replace("age=m>5?'⚠️ '+(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前'):(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前')","age=m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前'");
console.log('6. updateSidebarPrices fixed');

// ======================
// 7. Add CSS for colored dots
// ======================
c=c.replace("pulse 2s ease-in-out infinite}","pulse 2s ease-in-out infinite}.live-dot.pre{background:#ff9800;animation-name:none}.live-dot.post{background:#2196f3;animation-name:none}");
console.log('7. CSS added');

// ======================
// Write and verify
// ======================
f.writeFileSync('public/index.html',c,'utf8');
console.log('\nFile written. Verification:');
console.log('PRICE_AGE:',c.indexOf('PRICE_AGE_WARN')>=0?'STILL':'CLEAN');
console.log('dataAge:',c.indexOf('dataAge')>=0?'STILL':'CLEAN');
console.log('cpAge:',c.indexOf('cpAge')>=0?'STILL':'CLEAN');
console.log('cAge:',c.indexOf('cAge')>=0?'STILL':'CLEAN');
