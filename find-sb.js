var c=require('fs').readFileSync('public/index.html','utf8');
var i=c.indexOf('setTimeout(function ptr');
// find matching closing
var depth=1, j=c.indexOf('{',i)+1;
while(depth>0&&j<c.length){if(c[j]==='{')depth++;if(c[j]==='}')depth--;j++}
console.log('function body ends at', j);
// now find the setTimeout closing paren
console.log('chars after closing:', c.substring(j, j+5));
