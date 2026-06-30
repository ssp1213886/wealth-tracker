var c=require('fs').readFileSync('public/index.html','utf8');
var i=c.indexOf('tb.click();');
console.log(c.substring(i,i+40));
