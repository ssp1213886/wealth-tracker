var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Find the mobile .bb-btn at position ~28032
var i=c.indexOf('.bb-btn{border:none;background:transparent;color:var(--muted);font-family:var(--font);font-size:.52rem');
if(i>0) {
  var old=c.substring(i, c.indexOf('}', i)+1);
  var neo=old.replace('cursor:pointer;','cursor:pointer;transition:transform .12s,background .12s;');
  c=c.replace(old, neo);
  fs.writeFileSync('public/index.html', c);
  console.log('done');
} else {
  console.log('not found');
}
