var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

var old='function pricePill(sym,price,change,source,dataAge,extLabel){var stale=dataAge>PRICE_AGE_WARN_MS?\'<span title="数据延迟" style="font-size:.65rem;">⚠️</span> \':\'\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'&&dataAge<=PRICE_AGE_WARN_MS?\'<span class="live-dot"></span>\':\'\';var ext=extLabel?\' <small style="color:var(--accent);font-size:.5rem;">[\'+extLabel+\']</small>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ext+ch+sl+\'</span>\'}';

var rep='function pricePill(sym,price,change,source,extLabel){var dotCls=\'live-dot\';if(extLabel===\'盘后\')dotCls=\'live-dot post\';if(extLabel===\'盘前\')dotCls=\'live-dot pre\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'?\'<span class="\'+dotCls+\'"\'+(extLabel?\' title="\'+extLabel+\'价格"\':\'\')+\'></span>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ch+sl+\'</span>\'}';

if(c.indexOf(old)>=0){
  c=c.replace(old,rep);
  console.log('OK - pricePill replaced');
} else {
  console.log('NO MATCH - checking partial...');
  var part='function pricePill(sym,price,change,source,dataAge,extLabel){';
  if(c.indexOf(part)>=0) console.log('  signature found');
  else console.log('  signature NOT FOUND');
}

f.writeFileSync('public/index.html',c,'utf8');
