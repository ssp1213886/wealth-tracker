var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Find mobile .bb-btn (position ~28032)
var i=c.indexOf('.bb-btn{border:none;background:transparent;color:var(--muted);font-family:var(--font);font-size:.52rem');
if(i>0) {
  var old=c.substring(i, c.indexOf('}', i)+1);
  // Add position:relative and ::after
  var neo=old.replace('gap:2px;cursor:pointer;transition:transform .12s,background .12s;',
    'gap:2px;cursor:pointer;position:relative;overflow:hidden;transition:transform .12s,background .12s}' +
    '.bb-btn::after{content:"";position:absolute;inset:0;margin:auto;width:0;height:0;border-radius:50%;background:rgba(22,153,74,.2);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:width .25s,height .25s;pointer-events:none}' +
    '.bb-btn:active::after{width:130%;height:130%' + '}');
  c=c.replace(old, neo);
  fs.writeFileSync('public/index.html', c);
  console.log('mobile done');
} else {
  console.log('not found');
}
