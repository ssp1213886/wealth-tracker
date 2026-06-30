var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
var i=c.indexOf('<aside class="sidebar"');
var j=c.indexOf('</aside>',i);
var sidebar=c.substring(i,j+8);
console.log(sidebar.substring(2000));
