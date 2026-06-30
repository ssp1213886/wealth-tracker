var c=require('fs').readFileSync('public/index.html','utf8');
var i=c.indexOf('bottomBar');
console.log('bottomBar at:', i);
console.log(c.substring(i,i+700));
