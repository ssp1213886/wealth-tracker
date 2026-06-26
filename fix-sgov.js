const fs = require('fs');
const path = 'public/index.html';
let c = fs.readFileSync(path, 'utf8');
c = c.replace(/\r\n/g, '\n');

const oldBlock1 = "var dca=state.monthlyDCA||2000;[1,2,3].forEach(function(x){var el=document.getElementById('sgovPart'+x);if(el)el.textContent=fmt$(dca*x)})\n}";
const newBlock1 = "var sgovNet2=0;trades.forEach(function(t){if(t.symbol==='SGOV')sgovNet2+=t.shares*t.price});[1,2,3].forEach(function(x){var el=document.getElementById('sgovPart'+x);if(el)el.textContent=fmtX(sgovNet2*0.25*x)+' ('+(25*x)+'% SGOV)'})\n}\nfunction fmtX(n){if(n>=1e6)return'$'+(n/1e6).toFixed(2)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(0)}\nfunction execSgovBuy";

const oldBlock2 = "function execSgovBuy(portion){var dca=state.monthlyDCA||2000,total=dca*portion,date=new Date().toISOString().slice(0,10),a={VGT:state.vgt,SMH:state.smh,BTC:state.btc};var ts=0,tb=0;trades.forEach(function(t){var a2=Math.abs(t.shares)*t.price;if(t.shares<0)ts+=a2;else tb+=a2});var avail=cashBalance+ts-tb;if(total>avail){showToast('💵 现金不足','err');return}\n  if(!confirm('确认执行第'+portion+'份买入？总额 '+fmt$(total)+'\\nVGT '+fmt$(total*state.vgt)+' · SMH '+fmt$(total*state.smh)+' · BTC '+fmt$(total*state.btc)))return;\n  ETF_SYMS.forEach(function(s){var amt=total*a[s];if(amt<=0)return;var p=livePrices[s];if(!p||p<=0){showToast('⚠️ 缺少 '+s+' 实时价格','err');return}trades.push({id:tradeIdCounter++,symbol:s,date:date,shares:Math.floor(amt/p*1e6)/1e6,price:p,type:'buy'})});trades.sort(function(a,b){return a.date.localeCompare(b.date)});saveTrades();initTradeIds();updatePortfolio();showToast('✅ 已执行第'+portion+'份买入')}";

const newBlock2 = "function execSgovBuy(portion){var sgovNet=0;trades.forEach(function(t){if(t.symbol==='SGOV')sgovNet+=t.shares*t.price});var total=Math.max(0,sgovNet*0.25*portion),date=new Date().toISOString().slice(0,10),a={VGT:state.vgt,SMH:state.smh,BTC:state.btc};if(total<=0){showToast('⚠️ SGOV 余额不足','err');return}\n  if(!confirm('确认卖出 SGOV 转投组合？\\n\\n卖出 SGOV：'+fmt$(total)+' ('+(25*portion)+'% SGOV池)\\n买入 VGT '+fmt$(total*state.vgt)+' · SMH '+fmt$(total*state.smh)+' · BTC '+fmt$(total*state.btc)+'\\n\\n按 50/30/20 比例分配'))return;\n  var sgovP=livePrices.SGOV||1;trades.push({id:tradeIdCounter++,symbol:'SGOV',date:date,shares:-(Math.floor(total/sgovP*1e4)/1e4),price:sgovP,type:'sell'});\n  ETF_SYMS.forEach(function(s){var amt=total*a[s];if(amt<=0)return;var p=livePrices[s];if(!p||p<=0)return;trades.push({id:tradeIdCounter++,symbol:s,date:date,shares:Math.floor(amt/p*1e4)/1e4,price:p,type:'buy'})});trades.sort(function(a,b){return a.date.localeCompare(b.date)});saveTrades();initTradeIds();updatePortfolio();showToast('✅ SGOV → 组合 · '+fmt$(total))}";

if (c.includes(oldBlock1)) {
  c = c.replace(oldBlock1, newBlock1);
  console.log('OK block 1');
} else {
  console.log('FAIL block 1');
  const idx = c.indexOf('sgovPart');
  if (idx >= 0) console.log('Near sgovPart: ' + c.substring(idx-20, idx+150));
}

if (c.includes(oldBlock2)) {
  c = c.replace(oldBlock2, newBlock2);
  console.log('OK block 2');
} else {
  console.log('FAIL block 2 (already replaced)');
}

c = c.replace(/\n/g, '\r\n');
fs.writeFileSync(path, c, 'utf8');
console.log('Done');
