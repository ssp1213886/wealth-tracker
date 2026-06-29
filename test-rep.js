// Test: verify that the replacement string in redo.js is valid
var rep='function pricePill(sym,price,change,source,extLabel){var dotCls=\'live-dot\';if(extLabel===\'盘后\')dotCls=\'live-dot post\';if(extLabel===\'盘前\')dotCls=\'live-dot pre\';var dot=source&&source!==\'缓存\'&&source!==\'manual\'?\'<span class="\'+dotCls+\'"\'+(extLabel?\' title="\'+extLabel+\'价格"\':\'\')+\'></span>\':\'\';var ch=\'\';if(change!=null){var s2=change>=0?\'+\':\'\';ch=\'<span class="pp-chg" style="color:\'+(change>=0?\'var(--accent)\':\'var(--red)\')+\';">\'+s2+change.toFixed(2)+\'</span>\'}var sl=source?\'<small style="color:var(--muted);font-size:.5rem;margin-left:3px;">\'+source+\'</small>\':\'\';return\'<span class="price-pill" data-sym="\'+sym+\'" data-price="\'+price.toFixed(2)+\'" style="cursor:pointer">\'+dot+\'<span class="pp-sym">\'+sym+\'</span><strong>$\'+price.toFixed(2)+\'</strong>\'+ch+sl+\'</span>\'}';
console.log('rep length:',rep.length);
console.log('Ends correctly:',rep.endsWith("</span>'}"));
console.log('Has strong close tag:',rep.indexOf('</strong>')>=0);
var vm=require('vm');try{new vm.Script(rep);console.log('VALID')}catch(e){console.log('INVALID:',e.message)}
