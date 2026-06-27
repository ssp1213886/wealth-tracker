// [测试工具] JS语法校验脚本，不影响线上运行
var fs=require('fs');
var h=fs.readFileSync('public/index.html','utf8');
var s=h.indexOf('<script>');
var e=h.lastIndexOf('</script>');
var js=h.slice(s+8,e);
var vm=require('vm');
try{
  new vm.Script(js);
  console.log('PARSE OK');
}catch(err){
  console.log('PARSE ERROR at '+err.stack);
}
