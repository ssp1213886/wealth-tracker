var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Mobile .bb-btn: find by font-size:.52rem
var s='.bb-btn{border:none;background:transparent;color:var(--muted);font-family:var(--font);font-size:.52rem';
var i=c.indexOf(s);
if(i>0) {
  var old=c.substring(i, c.indexOf('}', i)+1);
  // Remove transition, add glass
  var neo=old.replace(/transition:[^;]+;?/,'').replace('cursor:pointer;','cursor:pointer;transition:background .15s;-webkit-backdrop-filter:none}') + '.bb-btn:active{background:rgba(22,153,74,.15);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}';
  c=c.replace(old, neo);
  fs.writeFileSync('public/index.html', c);
  console.log('done');
} else console.log('not found');
