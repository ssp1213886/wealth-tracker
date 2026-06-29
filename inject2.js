var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
var newFn=f.readFileSync('new-pricepill.txt','utf8').trim();

// Find pricePill function by its unique start
var i=c.indexOf('function pricePill(sym,price,change,source,dataAge,extLabel)');
if(i<0){console.log('ERROR: pricePill not found'); process.exit(1);}
var j=c.indexOf('\r\n',i+100);
if(j<0){console.log('ERROR: no newline after pricePill'); process.exit(1);}
var oldLine=c.substring(i,j);
console.log('Old length:',oldLine.length);
c=c.substring(0,i)+newFn+c.substring(j);

// Verify
f.writeFileSync('public/index.html',c,'utf8');
var c2=f.readFileSync('public/index.html','utf8');
var i2=c2.indexOf('function pricePill(');
var j2=c2.indexOf('\r\n',i2+100);
var newLine=c2.substring(i2,j2);
console.log('New length:',newLine.length);
console.log('Has return:',newLine.indexOf('return')>=0);
console.log('Has strong:',newLine.indexOf('</strong>')>=0);
