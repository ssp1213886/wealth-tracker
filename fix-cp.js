var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Find the cpAge block and replace it
var start=c.indexOf('((function(){var cpAge=');
var endBlock=c.indexOf('})());',start)+6;
var old=c.substring(start,endBlock);
console.log('Replacing:',old.substring(0,100)+'...');
console.log('Length:',old.length);

// Replace: remove the IIFE wrapper, remove age param
// Change from: ((function(){var cpAge=...;return ETF_SYMS.map(function(sym){var age=...;return livePrices[sym]?pricePill(sym,...,age,''):...})})());
// Change to:   ETF_SYMS.map(function(sym){return livePrices[sym]?pricePill(sym,...,'', ''):...}).join('');
c=c.replace('((function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||\'{}\');return ','');
c=c.replace('}).join(\'\')})();','}).join(\'\');');
// Remove the age var declaration and pass '' instead of age
c=c.replace('var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||\'\',age,\'\')','return livePrices[sym]?pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||\'\',\'\',\'\')');

f.writeFileSync('public/index.html',c,'utf8');
console.log('Done');
