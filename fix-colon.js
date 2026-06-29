var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
c=c.replace(/age=:\(/g,'age=(');
f.writeFileSync('public/index.html',c,'utf8');
console.log('age=:( remaining:',c.indexOf('age=:(')>=0?'YES':'CLEAN');
