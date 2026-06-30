var c=require('fs').readFileSync('public/index.html','utf8');
var i=c.indexOf('function renderLogHeatmap');
var depth=1,j=c.indexOf('{',i)+1;
while(depth>0&&j<c.length){if(c[j]==='{')depth++;if(c[j]==='}')depth--;j++}
console.log(c.substring(i,j));
