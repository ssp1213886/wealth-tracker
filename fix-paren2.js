var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Fix extra quote-param in pricePill
c=c.replace(",'','','')",",'','')");

// Fix innerHTML=(ETF → innerHTML=ETF
c=c.replace("innerHTML=(ETF","innerHTML=ETF");

// Fix }).join('')})()); → }).join('');
c=c.replace("}).join('')})());","}).join('');");

f.writeFileSync('public/index.html',c,'utf8');
console.log('Fixed');
