// 持仓与盈亏计算：纯函数，不依赖 DOM，可直接单测。
// 由 scripts/_split-calc.mjs 从 index.js 搬出，计算逻辑一字未改。

export function computeHoldings(list){
var holdings={},totalBuys=0,totalInvested=0,totalRealized=0;



  var sorted=[].concat(list).sort(function(a,b){return a.date.localeCompare(b.date)});



  for(var i=0;i<sorted.length;i++){



    var t=sorted[i],sym=t.symbol,sh=Number(t.shares),pr=Number(t.price);



    if(!holdings[sym])holdings[sym]={shares:0,cost:0,realized:0};



    if(sh>0){holdings[sym].shares+=sh;holdings[sym].cost+=sh*pr;totalBuys+=sh*pr;totalInvested+=sh*pr}



    else{var preAvg=holdings[sym].shares>0?holdings[sym].cost/holdings[sym].shares:pr;var soldCost=Math.abs(sh)*preAvg;var soldProceeds=Math.abs(sh)*pr;holdings[sym].shares+=sh;holdings[sym].cost-=soldCost;holdings[sym].realized+=soldProceeds-soldCost;totalRealized+=soldProceeds-soldCost}



  }
  return {holdings:holdings,totalBuys:totalBuys,totalInvested:totalInvested,totalRealized:totalRealized};
}

export function buildPositionRows(holdings,prices){
var totalCost=0,totalValue=0,hasPriced=false,unpriced=[];



  var rows=[];



  for(var sym in holdings){var h=holdings[sym];if(h.shares<=0)continue;var avgCost=h.shares>0?h.cost/h.shares:0,priced=prices[sym]&&prices[sym]>0;var curPrice=priced?prices[sym]:null,value=priced?h.shares*curPrice:null;var unrealPnL=priced?value-h.cost:null,pnlPct=(priced&&h.cost>0)?unrealPnL/h.cost:null;totalCost+=h.cost;if(priced){totalValue+=value;hasPriced=true}else unpriced.push(sym);rows.push({sym:sym,shares:h.shares,avgCost:avgCost,priced:priced,curPrice:curPrice,value:value,unrealPnL:unrealPnL,pnlPct:pnlPct,realized:h.realized||0})}
  return {rows:rows,totalCost:totalCost,totalValue:totalValue,hasPriced:hasPriced,unpriced:unpriced};
}

/**
 * 现金修正的执行计划（纯函数，可直接单测）。
 *
 * 背景（v318）：现金修正以前只挡 `v === 0`，填负数就直接记账 —— 而"负现金"会让总资产一起变负，
 * 且没有任何提示。负数修正是"往回改"的非常规操作，必须二次确认；如果修完会变成负数，
 * 还要在确认框里明确警告一次。正数修正（补记一笔）保持原来的直接执行，不打扰用户。
 *
 * 返回：{ delta, next, needsConfirm, willGoNegative }；文案由调用方拼（金额格式化属于视图层）。
 */
export function cashCorrectionPlan(currentCash, delta) {
  var cur = Number(currentCash) || 0;
  var d = Number(delta) || 0;
  var next = cur + d;
  return { delta: d, next: next, needsConfirm: d < 0, willGoNegative: next < 0 };
}
