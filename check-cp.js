var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
var idx=0,count=0;
while((idx=c.indexOf('cpAge',idx))>=0){
  count++;
  console.log('#'+count,'at',idx,':',c.substring(idx-30,idx+60).replace(/\r\n/g,' ').substring(0,100));
  idx++;
}
console.log('Total:',count);
