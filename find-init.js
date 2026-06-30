var c=require('fs').readFileSync('public/index.html','utf8');
var needle='dcaInput.value=state.monthlyDCA||2000;dcaInput.addEventListener';
var i=c.indexOf(needle);
console.log('found at:',i);
console.log(c.substring(i,i+250));
