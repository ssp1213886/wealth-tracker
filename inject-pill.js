var f=require('fs'),c=f.readFileSync('public/index.html','utf8');
var newFn=f.readFileSync('new-pricepill.txt','utf8').trim();

// Find and replace the pricePill function
var i=c.indexOf('function pricePill(');
var j=c.indexOf('\r\n',i+100); // end of line
var oldLine=c.substring(i,j);
console.log('old line length:',oldLine.length,', new fn length:',newFn.length);

c=c.substring(0,i)+newFn+c.substring(j);
f.writeFileSync('public/index.html',c,'utf8');

// Verify
c=f.readFileSync('public/index.html','utf8');
i=c.indexOf('function pricePill(');
var n=c.indexOf('\r\n',i+100);
var line=c.substring(i,n);
console.log('result length:',line.length);
console.log('has return:',line.indexOf("return'")>=0);
console.log('has strong close:',line.indexOf("</strong>'+")>=0);
