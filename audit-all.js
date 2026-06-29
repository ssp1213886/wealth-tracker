var fs=require('fs');
var checks=[
['README 文件结构表',function(){return fs.readFileSync('readme.md','utf8').includes('文件结构')}],
['package.json deploy',function(){return require('./package.json').scripts.deploy==='wrangler deploy'}],
['maintenance 去Token',function(){return !fs.readFileSync('maintenance.md','utf8').includes('ssp540829')}],
['guide 日期更新',function(){return fs.readFileSync('public/guide.html','utf8').includes('2026-06-29')}],
['guide 删蒙特卡洛',function(){return !fs.readFileSync('public/guide.html','utf8').includes('蒙特卡洛')}],
['使用文档 删模拟',function(){return !fs.readFileSync('public/使用文档.md','utf8').includes('蒙特卡洛')}],
['死代码 YHOO_MAP',function(){return !fs.readFileSync('public/index.html','utf8').includes('YHOO_MAP')}],
['死代码 fetchWithTimeout',function(){return !fs.readFileSync('public/index.html','utf8').includes('fetchWithTimeout')}],
['死代码 PRICE_AGE',function(){return !fs.readFileSync('public/index.html','utf8').includes('PRICE_AGE_WARN_MS')}],
['代码分区注释(>=10)',function(){return (fs.readFileSync('public/index.html','utf8').match(/\/\* =====/g)||[]).length>=10}],
['仓库清理(无垃圾)',function(){return !fs.existsSync('fix-dot.js')&&!fs.existsSync('debug-pill.js')}],
];
var all=true;
checks.forEach(function(c){var ok=c[1]();console.log((ok?'✅':'❌')+' '+c[0]);if(!ok)all=false});
console.log(all?'\n✅ 全部通过':'');
