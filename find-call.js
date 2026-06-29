var c=require('fs').readFileSync('public/index.html','utf8');
var needle = "liveSources[sym]||''";
var i = c.indexOf(needle);
console.log('found at', i);
console.log(c.substring(i-80, i+80));
