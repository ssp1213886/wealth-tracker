var c=require('fs').readFileSync('public/index.html','utf8');
var pos=0,re=/sidebar['"\)]\.|classList.*sidebar|sidebar.*classList/g;
var m;
while(m=re.exec(c)) {
  console.log('--- match at', m.index, '---');
  console.log(c.substring(Math.max(0,m.index-80), Math.min(m.index+120, c.length)).replace(/\n/g,' '));
}
