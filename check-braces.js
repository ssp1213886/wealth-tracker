var fs=require('fs');
var h=fs.readFileSync('public/index.html','utf8');
var s=h.indexOf('<script>');
var e=h.lastIndexOf('</script>');
var js=h.slice(s+8,e);
var stack=[];
for(var i=0;i<js.length;i++){
  var ch=js[i];
  if(ch==='{'){
    stack.push({type:'{',pos:i,line:js.slice(0,i).split('\n').length});
  }
  if(ch==='}'){
    if(stack.length===0){console.log('Extra } at offset '+i);return}
    stack.pop();
  }
}
if(stack.length>0){
  console.log('Unclosed braces: '+stack.length);
  stack.forEach(function(s){console.log('  { at offset '+s.pos+' line '+s.line+' near: '+js.slice(Math.max(0,s.pos-40),s.pos+30))})
}
