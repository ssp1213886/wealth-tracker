var f=require("fs"),c=f.readFileSync("public/index.html","utf8");
var s=c.indexOf("}document.getElementById('hmDeposit')");
var end=c.indexOf("\n",s+5);
console.log(c.substring(s,end));
