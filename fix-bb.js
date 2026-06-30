var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Find mobile .bb-btn:active with green glass
var old='.bb-btn:active{background:rgba(22,153,74,.15);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}';
var neo='.bb-btn:active{background:rgba(255,255,255,.25);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08)}';
if(c.includes(old)) {
  c=c.replace(old, neo);
  fs.writeFileSync('public/index.html', c);
  console.log('done');
} else console.log('not found');
