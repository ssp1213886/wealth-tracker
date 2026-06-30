var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// 1. Update desktop .bb-icon to include svg sizing
var old='.bb-icon{font-size:1.5rem;line-height:1;opacity:.45;transition:transform .2s,opacity .2s}';
var neo='.bb-icon{line-height:1;opacity:.45;transition:transform .2s,opacity .2s}.bb-icon svg{width:24px;height:24px}';
c=c.replace(old, neo);
// 2. Update mobile .bb-btn to have wider padding  
var old2='font-size:.52rem;font-weight:500;padding:6px 2px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;min-height:50px';
var neo2='font-size:.52rem;font-weight:500;padding:10px 4px 6px;display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-height:56px';
c=c.replace(old2, neo2);
fs.writeFileSync('public/index.html', c);
console.log('done');
