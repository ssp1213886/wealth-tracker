var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Remove ALL old bb-btn:active rules (scale .78 + icon scale)
c=c.replace(/\.bb-btn:active\{transform:scale\(\.78\);background:rgba\(22,153,74,\.12\)\}/g,'');
c=c.replace(/\.bb-btn:active \.bb-icon\{transform:scale\(\.82\)\}/g,'');
c=c.replace(/\.bb-btn:active\{background:rgba\(22,153,74,\.18\);transform:scale\(\.92\)\}/g,'');
// Add ONE clean rule after the mobile .bb-btn block
var mobileBB='.bb-btn{border:none;background:transparent;color:var(--muted);font-family:var(--font);font-size:.52rem;font-weight:500;padding:6px 2px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-height:50px;cursor:pointer;transition:background .15s;-webkit-backdrop-filter:none}';
if(!c.includes(mobileBB+' .bb-btn:active{background:rgba(22,153,74,.3);transform:scale(.85)}')) {
  c=c.replace(mobileBB, mobileBB + '.bb-btn:active{background:rgba(22,153,74,.3);transform:scale(.85);transition:transform .15s,background .15s}');
}
// Also fix desktop version  
c=c.replace('.bb-btn:active{background:rgba(22,153,74,.18);transform:scale(.92)}','.bb-btn:active{background:rgba(22,153,74,.3);transform:scale(.85);transition:transform .15s,background .15s}');
fs.writeFileSync('public/index.html', c);
console.log('done');
