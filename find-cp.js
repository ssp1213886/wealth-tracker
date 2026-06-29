var f=require('fs'),c=f.readFileSync('public/index.html','utf8'),i=c.indexOf('cpAge');
if(i>=0)console.log('FOUND at',i,'\n',c.substring(i-50,i+300));
