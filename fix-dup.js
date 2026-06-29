var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Replace ALL cpAge IIFEs
var old1='(function(){var cpAge=JSON.parse(localStorage.getItem(PRICE_KEY)||\'{}\');return ';
while(c.indexOf(old1)>=0){
  c=c.replace(old1,'');
}

// Remove ALL remaining age variable with cpAge
var old2='var age=cpAge[sym]&&cpAge[sym].time?Date.now()-cpAge[sym].time:0;return ';
while(c.indexOf(old2)>=0){
  c=c.replace(old2,'return ');
}

// Fix ALL .join('')})(); → .join('');
var old3="}).join('')})();";
while(c.indexOf(old3)>=0){
  c=c.replace(old3,"}).join('');");
}

// Fix hmPricesCompact 后面的 IIFE 开括号
c=c.replace(/\)\(\(function\(\)\{/g,'(');
c=c.replace(/document\.getElementById\('hmPricesCompact'\)\.innerHTML=\(\(/g,"document.getElementById('hmPricesCompact').innerHTML=(");

f.writeFileSync('public/index.html',c,'utf8');
console.log('cpAge:',c.indexOf('cpAge')>=0?'STILL':'CLEAN');
console.log('cAge:',c.indexOf('cAge')>=0?'STILL':'CLEAN');
