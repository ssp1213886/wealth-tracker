var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
var old=".join('')})());";
var rep=".join('');";
while(c.indexOf(old)>=0){
  c=c.replace(old,rep);
}
f.writeFileSync('public/index.html',c,'utf8');
console.log('Remaining:',c.indexOf(old)>=0?'STILL':'CLEAN');
