var fs=require('fs');
var c=fs.readFileSync('public/index.html','utf8');
// Replace the showToast type check
var old='if(type){t.className=';
var idx=c.indexOf(old);
if(idx<0){console.log('NOT FOUND');process.exit(1)}
// find the closing of this block
var from=idx;
// Replace inline
c=c.replace(
  "if(type){t.className='sync-toast undo show';t.innerHTML='<span>'+msg+'</span> <span class=\"toast-undo-btn\" data-undo=\"'+type+'\">\u64a4\u9500</span>'}else{t.className='sync-toast show';t.textContent=msg}",
  "if(type==='single'||type==='all'||type==='cash'){t.className='sync-toast undo show';t.innerHTML='<span>'+msg+'</span> <span class=\"toast-undo-btn\" data-undo=\"'+type+'\">\u64a4\u9500</span>'}else{t.className='sync-toast '+(type||'')+' show';t.textContent=msg}"
);
fs.writeFileSync('public/index.html',c);
console.log('OK');
