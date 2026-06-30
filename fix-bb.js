var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
var old='.bb-btn:active{background:rgba(255,255,255,.25);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08)}';
var neo='.bb-btn:active{background:rgba(22,153,74,.18);transform:scale(.92)}';
if(c.includes(old)) {
  c=c.replace(old, neo);
} else {
  // Mobile .bb-btn active might have old scale rule
  var old2='.bb-btn:active{transform:scale(.78);background:rgba(22,153,74,.12)}.bb-btn:active .bb-icon{transform:scale(.82)}';
  if(c.includes(old2)) c=c.replace(old2, neo);
  else {
    // Just add it after the mobile .bb-btn block
    var s='font-size:.52rem;font-weight:500;padding:6px 2px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-height:50px;cursor:pointer;transition:background .15s;-webkit-backdrop-filter:none}';
    if(c.includes(s)) {
      c=c.replace(s, s + neo);
    }
  }
}
fs.writeFileSync('public/index.html', c);
console.log('done');
