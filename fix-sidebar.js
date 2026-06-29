var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Fix updateSidebarPrices: remove m>5 conditional
c=c.replace("age=m>5?'⚠️ '+(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前')","age=");
// Fix the second updateSidebarPrices if duplicated
c=c.replace("age=m>5?'⚠️ '+(m<1?'刚刚':m<60?m+'分钟前':m<1440?Math.floor(m/60)+'小时前':Math.floor(m/1440)+'天前')","age=");

console.log(c.indexOf("age=m>5")>=0?'STILL HAS STALE':'CLEAN');
f.writeFileSync('public/index.html',c,'utf8');
