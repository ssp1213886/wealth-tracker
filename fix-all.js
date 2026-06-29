var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// 1. Remove cpAge IIFE wrappers
c=c.replace(/\(\(function\(\)\{var cpAge=JSON\.parse\(localStorage\.getItem\(PRICE_KEY\)\|\|'{}'\)\);return /g,'');
c=c.replace(/\}\)\.join\(''\)\}\)\(\)/g,"}).join('')");

// 2. Remove age variable and pass '' instead
c=c.replace(/var age=cpAge\[sym\]&&cpAge\[sym\]\.time\?Date\.now\(\)-cpAge\[sym\]\.time:0;return /g,'return ');
// Now fix the pricePill call that still has age param
c=c.replace(/pricePill\(sym,livePrices\[sym\],liveChanges\[sym\],liveSources\[sym\]\|\|'',age,''\)/g,"pricePill(sym,livePrices[sym],liveChanges[sym],liveSources[sym]||'','','')");

// 3. Fix updateSidebarPrices - remove m>5 branch
// Match: age=m>5?'⚠️ '+(m<1?'刚刚':m<60?m+'分钟前':...):(m<1?'刚刚':...);
// Keep: age=m<1?'刚刚':m<60?m+'分钟前':...;
var idx=c.indexOf("age=m>5?'");
while(idx>=0){
  // Find the matching closing
  var depth=0, j;
  for(j=idx+4;j<c.length&&j<idx+400;j++){
    if(c[j]==='(') depth++;
    if(c[j]===')'){ if(depth===0&&c[j-1]!=='\\') break; depth--; }
  }
  j++; // include the )
  var newAge="m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前'";
  c=c.substring(0,idx+4)+newAge+c.substring(j);
  idx=c.indexOf("age=m>5?'");
}
console.log('cpAge remaining:',c.indexOf('cpAge')>=0?'YES':'NO');
console.log('age=m>5 remaining:',c.indexOf("age=m>5'")>=0?'YES':'NO');

f.writeFileSync('public/index.html',c,'utf8');
console.log('Done');
