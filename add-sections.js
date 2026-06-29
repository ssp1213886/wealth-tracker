var f=require('fs'),c=f.readFileSync('public/index.html','utf8');

// Define section comments to inject at function boundaries
// Format: [targetLineNumber, commentText]
var sections=[
  [446,'\r\n/* ===== 格式化工具 ===== */'],
  [453,'\r\n/* ===== 投资组合计算 ===== */'],
  [469,'\r\n/* ===== 价格获取 & 缓存 ===== */'],
  [473,''], // refreshPrices is part of prices
  [487,'\r\n/* ===== 持仓渲染 ===== */'],
  [538,''], // updateDonutChart part of rendering
  [551,'\r\n/* ===== 数据持久化 ===== */'],
  [554,'\r\n/* ===== DCA 定投 ===== */'],
  [559,'\r\n/* ===== 活动日志 ===== */'],
  [580,'\r\n/* ===== 数据页 ===== */'],
  [623,'\r\n/* ===== 提款规划 ===== */'],
  [638,'\r\n/* ===== SGOV 池 ===== */'],
  [666,'\r\n/* ===== 主题 & UI ===== */'],
  [709,''], // updateWithdrawal part of plan
  [715,''], // switchTab part of UI
  [750,'\r\n/* ===== 交易操作 ===== */'],
  [758,''], // initAll part of init
  [782,'\r\n/* ===== Toast 通知 ===== */'],
  [786,''], // doRebalance part of trade
  [799,'\r\n/* ===== 云端同步 ===== */'],
  [805,'\r\n/* ===== CSV 导入 ===== */'],
  [860,'\r\n/* ===== 初始化 & 事件绑定 ===== */'],
];

// Inject comments before the specified lines (lines are 1-based)
var lines=c.split('\r\n');
var offset=0; // track how many lines we've inserted
for(var s=0;s<sections.length;s++){
  var lineNum=sections[s][0];
  var comment=sections[s][1];
  if(!comment) continue;
  // The line in the array is 0-based = lineNum-1, adjusted for previous insertions
  var idx=lineNum-1+offset;
  if(idx>=0 && idx<lines.length){
    lines.splice(idx,0,comment.replace('\r\n',''));
    offset++;
  }
}

c=lines.join('\r\n');
f.writeFileSync('public/index.html',c,'utf8');
console.log('Added',offset,'section comments');
