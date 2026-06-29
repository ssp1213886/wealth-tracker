var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
var before='(function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||\'{}\');return ';
c=c.replace(before,'');
f.writeFileSync('public/index.html',c,'utf8');
console.log('cpAge:',c.indexOf('cpAge')>=0?'STILL':'CLEAN');
