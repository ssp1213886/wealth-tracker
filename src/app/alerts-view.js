// 待办提醒（首页快捷面板 + 手机端铃铛角标）的视图层。
// v253 从 index.js 抽出：这里既有"算提醒"（buildAlerts，纯函数可离线测），也有渲染与角标。
// 快捷面板开关（qaToggle）与页面级事件委托仍留在 index.js。

import { readRaw, removeKey , LS } from './store.js';
import { marketDate } from './time.js';
import { isActiveOption, optionExpiryState, optionActionItems, freeCallContracts } from './options.js';
import { fmtFull, logSwallowed } from './util.js';
import { emptyStateHTML, renderAlertItem, alertSignature } from './render.js';

/** 严重度权重：决定"同一 id 留哪条"和列表排序。 */
var ALERT_SEVERITY_SCORE={critical:4,high:3,medium:2,low:1};

/** 同一 id 只留最严重的一条，再按严重度排序（同分按标题）。 */
function normalizeAlerts(alerts){var byId={};(alerts||[]).forEach(function(a){if(!a||!a.id)return;var current=byId[a.id],score=ALERT_SEVERITY_SCORE[a.severity]||0;if(!current||score>(ALERT_SEVERITY_SCORE[current.severity]||0))byId[a.id]=a});return Object.keys(byId).map(function(id){return byId[id]}).sort(function(a,b){return (ALERT_SEVERITY_SCORE[b.severity]||0)-(ALERT_SEVERITY_SCORE[a.severity]||0)||String(a.title).localeCompare(String(b.title),'zh-CN')})}

var currentAlerts=[];

var alertSeenSig='';function loadAlertSeen(){return alertSeenSig}

function markAlertsSeen(sig){alertSeenSig=String(sig||'');try{removeKey('wealth_alert_seen_v1')}catch(e){logSwallowed("markAlertsSeen",e)}}

/** 手机端铃铛角标：有未读提醒才显示数字，critical 会额外加红。 */
function updateBellBadge(list){
var bell=document.querySelector('.ms-bell');if(!bell)return;
/* count 与主屏角标**共用同一个定义**（badgeCountOf）—— 这两个数字永远不许不一样 */
var items=list||[],count=badgeCountOf(items),sig=alertSignature(items),unseen=count>0&&sig!==loadAlertSeen();
var critical=items.some(function(a){return a&&a.severity==='critical'});
bell.classList.toggle('has-alerts',unseen);
bell.classList.toggle('has-critical',unseen&&critical);
var badge=bell.querySelector('.ms-bell-badge');
if(unseen){if(!badge){badge=document.createElement('span');badge.className='ms-bell-badge';badge.setAttribute('aria-hidden','true');bell.appendChild(badge);bell.classList.add('bell-ping');setTimeout(function(){bell.classList.remove('bell-ping')},1300)}badge.textContent=count>9?'9+':String(count)}
else if(badge)badge.remove();
bell.setAttribute('aria-label',count>0?('查看提醒，'+count+' 条待办'):'查看提醒');
}

/** 期权提醒的"今天不再提醒"标记（按 id 记日期）。 */
function optPingKey(){return 'wealth_opt_ping_v1'}
function loadOptPing(){try{var v=JSON.parse(readRaw(optPingKey())||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}catch(e){return{}}}
function saveOptPing(id){try{var m=loadOptPing();m[String(id)]=marketDate();LS.setItem(optPingKey(),JSON.stringify(m))}catch(e){logSwallowed("saveOptPing",e)}}

/* ===== v370：主屏图标角标（App Badge）=====
   背景：所有提醒以前只在"你打开 App"那一刻可见（sw.js 没有 push，前端也没用任何通知能力）。
   角标能解决"打开了、忘了看铃铛"，但解决不了"一整天没打开"——那要靠服务端定时推送（另案）。
   iOS 上角标只对「已添加到主屏幕」的 Web App 生效，且需要通知权限（设置页的开关在用户手势里申请）。 */

/**
 * 角标数字 = **列表里的条目数**（v371 修正）。
 *
 * 为什么改：v370 是"只数 critical/high"，结果是"期权页列表 2 条、主屏角标 1 个"这种自相矛盾，
 * 而且 severity 这套分级本来是给**列表排序/配色**用的，拿去当"要不要催办"的判据直接错位 ——
 * 纯预告 `expiry:`（还剩 N 天，那天才动手）是 high 会进角标，
 * 真要动手的 `optdue:`（今天到期）/ `optdecide:`（会作废，要去点结算）/ `ccsoon:`（明天该卖）
 * 却都是 medium，一个都不进（实测场景：列表 2 条 / 角标 0）。
 *
 * 现在的口径：**列表几条，铃铛与主屏角标就是几**（两处共用这一个函数，永远一致）；
 * "哪条更急"交给列表的风险优先排序与铃铛的 has-critical 红点，不再用它去过滤数字。
 */
export function badgeCountOf(alerts){return (alerts||[]).filter(Boolean).length}

/** 这台设备（这个浏览器）有没有角标能力。 */
export function badgeSupported(nav){try{return !!(nav&&typeof nav.setAppBadge==='function')}catch(e){return false}}

/** 写角标。n>0 设数字，n=0 清除；不支持就当没这回事。
    ⚠️ setAppBadge 返回 Promise，**必须收掉 rejection** —— 页面上挂着 unhandledrejection 上报，
    不然"没装到主屏"这种正常情况会被记成前端错误。 */
export function applyAppBadge(nav,count){
  try{
    if(!badgeSupported(nav))return false;
    var n=Number(count)||0,p;
    if(n>0)p=nav.setAppBadge(n);
    else if(typeof nav.clearAppBadge==='function')p=nav.clearAppBadge();
    else p=nav.setAppBadge(0);
    if(p&&typeof p.catch==='function')p.catch(function(e){logSwallowed("applyAppBadge",e)});
    return true;
  }catch(e){logSwallowed("applyAppBadge",e);return false}
}

/** 当前这批提醒（面板打开时用它算"已读签名"）。 */
export function getCurrentAlerts() {
  return currentAlerts;
}

/** 提醒图标（四种类型）。 */
var alertIcons={orange:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>',red:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v5M12 17.5v.5"/></svg>',accent:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M22 12h-3"/><path d="m14 10 6-6"/></svg>',blue:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 9 12l4 3 7-8"/><path d="M15 7h5v5"/></svg>'};

/**
 * 算出这一轮该显示哪些待办（纯函数：时间、期权、行情、交易、参数、提醒标记都由调用方传入）。
 * ctx：{ now, options, prices, trades, state, pingMap }
 */
export function buildAlerts(ctx) {
var alerts=[],now=marketDate(ctx.now).slice(0,7),opts=ctx.options,activeOpts=opts.filter(function(o){return isActiveOption(o,ctx.now)}),callGroups={};
/* v371 去冗余：每个标的的"已卖 N 张 Call"汇总条先存在这里，最后只在**该标的没有任何其它提醒**时才补进去。
   以前它无条件出现，于是"VGT 已卖 1 张 Call"会和"VGT CALL $130 还剩 4 天到期"并排两条说同一件事。 */
var callSummaries={},symBusy={};
var markSym=function(sym){if(sym)symBusy[String(sym)]=1};
activeOpts.filter(function(o){return o.type==='CALL'}).forEach(function(o){if(!callGroups[o.sym])callGroups[o.sym]=[];callGroups[o.sym].push(o)});
Object.keys(callGroups).sort(function(a,b){var order=['VGT','SMH','BTC'],ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b)}).forEach(function(sym){
var calls=callGroups[sym].slice().sort(function(a,b){return String(a.expiry).localeCompare(String(b.expiry))}),contracts=calls.reduce(function(sum,o){return sum+(Number(o.contracts)||1)},0),nearest=calls[0],cp=Number(ctx.prices[sym])||0,closest=calls.slice().sort(function(a,b){return Math.abs(cp-a.strike)-Math.abs(cp-b.strike)})[0],type='blue',severity='medium',title=sym+' 已卖 '+contracts+' 张 Call',detail='覆盖 '+contracts*100+' 股 · 最近 '+nearest.expiry.slice(5)+' 到期';
/* 到期前实值**不需要任何动作**（美式期权提前行权等于白扔时间价值，理性持有人不会干），
   所以这里只做说明、不做告警。唯一真实风险是"除息日前的提前行权" ——
   只有除息日落在本轮周期内时才升级。v335 之前是只要到行权价 98% 就报红 critical。 */
if(cp>0&&closest){
  var _k=Number(closest.strike)||0,_head=strikeText(_k),_covers=contracts*100,_ex=(ctx.exDiv||{})[sym]||'';
  if(cp>_k){
    if(_ex&&_ex<=nearest.expiry){
      type='orange';severity='high';
      title=sym+' CALL '+_head+' 已实值 · 本轮含除息';
      detail='现价 $'+cp.toFixed(2)+' · 除息约 '+_ex+' —— 除息日前有提前行权可能；若发生，T+1 市价买回 '+_covers+' 股';
    }else{
      type='accent';severity='medium';
      title=sym+' CALL '+_head+' 已实值（现价 $'+cp.toFixed(2)+'）';
      detail='按策略不主动平仓，等自然到期 —— 到期收盘仍实值会被行权，次日买回 '+_covers+' 股';
    }
  }else if(cp>=_k*0.98){
    type='blue';severity='medium';
    detail='现价 $'+cp.toFixed(2)+' 逼近行权价 '+_head+'（差 '+((_k-cp)/cp*100).toFixed(1)+'%）· 到期前不需要动作';
  }
}
callSummaries[sym]={id:'call:'+sym,type:type,severity:severity,title:title,detail:detail,action:'option'}
});
var pingMap=ctx.pingMap,todayKey=marketDate(ctx.now);
/* 到期预告只覆盖"还剩 1~7 天"（st.days===0 跳过）：当天及之后交给下面的 optionActions
   （到期判定 + 买回待办），否则同一天会同时冒出来"还剩 0 天到期"和"会被行权"两条。 */
opts.forEach(function(o){if(o.settled||o.archived||!o.expiry)return;var st=optionExpiryState(o.expiry,ctx.now);if(st.days>7||st.days===0)return;if(pingMap[o.id]===todayKey)return;var cnt=Number(o.contracts)||1;markSym(o.sym);alerts.push({id:'expiry:'+o.id,type:'orange',severity:'high',title:o.sym+' '+o.type+' '+strikeText(o.strike)+' 还剩 '+st.days+' 天到期',detail:'到期日 '+o.expiry+' · '+cnt+' 张',action:'option',dismiss:'opt-expiry-'+o.id})});

/* ===== 到期判定 + 买回待办（v334）=====
   策略里有明确动作要求、但以前 app 完全不管的两个环节：
     ① 到期日收盘后判断"会被行权 / 会作废"（判定规则是死的，不需要等券商通知）
     ② 被行权后 T+1 必须市价买回 —— 忘了就会漏掉 100 股，下一轮还没正股可覆盖
   点击条目会跳到对应页面自己动手；这里只负责把状态翻成人话。
   数据由本模块自己从 options/trades/prices 推导（不再让调用方传），避免"忘了传就静默没有提醒"。 */
function strikeText(k){var n=Number(k)||0;return '$'+(n===Math.floor(n)?n.toFixed(0):n.toFixed(2))}
function money(spot){return '$'+Number(spot).toFixed(2)}
var optionActions=[];try{optionActions=optionActionItems(opts,ctx.trades,ctx.prices,ctx.now)||[]}catch(e){logSwallowed("optionActionItems",e)}
optionActions.forEach(function(a){
  markSym(a.sym);
  if(a.kind==='buyback'){
    alerts.push({id:'buyback:'+a.id,type:'red',severity:'critical',
      title:'待买回 '+a.shares+' 股 '+a.sym,
      detail:a.assignDate+' 被行权（'+a.contracts+' 张 CALL）· 按铁律 T+1 市价买回，否则下轮没有正股可覆盖',
      action:'console'});
    return;
  }
  if(a.kind==='due-today'){
    alerts.push({id:'optdue:'+a.id,type:'accent',severity:'medium',
      title:a.sym+' CALL '+strikeText(a.strike)+' 今天到期',
      detail:'收盘后（美东 16:00）看现价是否高于行权价 —— 高于就会被行权，明天要买回 '+(a.contracts*100)+' 股',
      action:'option'});
    return;
  }
  if(a.kind==='decide'){
    alerts.push(a.itm
      ? {id:'optdecide:'+a.id,type:'red',severity:'critical',
         title:a.sym+' CALL '+strikeText(a.strike)+' 会被行权',
         detail:'收盘 '+money(a.spot)+' > 行权价 '+strikeText(a.strike)+' · 在期权页点「行权」，明天买回 '+(a.contracts*100)+' 股',
         action:'option'}
      : {id:'optdecide:'+a.id,type:'blue',severity:'medium',
         title:a.sym+' CALL '+strikeText(a.strike)+' 会作废',
         detail:'收盘 '+money(a.spot)+' ≤ 行权价 '+strikeText(a.strike)+' · 在期权页点「结算」归档',
         action:'option'});
    return;
  }
  if(a.kind==='unmarked'){
    alerts.push({id:'optunmarked:'+a.id,type:'orange',severity:'high',
      title:a.sym+' CALL '+strikeText(a.strike)+' 已到期 '+a.daysPast+' 天未标记',
      detail:'去券商确认是否被行权；若被行权，记得买回 '+(a.contracts*100)+' 股 '+a.sym,
      action:'option'});
  }
});
var monthBuys=ctx.trades.filter(function(t){return t.date.slice(0,7)===now&&t.shares>0}),buyTotal=monthBuys.reduce(function(s,t){return s+(t.price*Math.abs(t.shares))},0),dcaTarget=ctx.state.dcaOverride&&ctx.state.dcaOverride.month===now?ctx.state.dcaOverride.amount:ctx.state.monthlyDCA;
if(dcaTarget&&buyTotal<dcaTarget*0.9){var gap=dcaTarget-buyTotal;alerts.push({id:'dca:'+now,type:'accent',severity:'low',title:'本月定投还差 '+fmtFull(gap),detail:'完成后保持目标资产配比',action:'console'})}
/* 固定节奏提醒（v328）：到期日当天就卖下一档。节奏日历由 index.js 传进来（ccRows），
   这里只负责把"该操作了 / 漏了"翻成人话。没有 ccRows 时（老调用方）整段跳过，行为不变。 */
var ccRows=ctx.ccRows||[],ccStreaks=ctx.ccStreaks||{},todayMs=Date.parse(marketDate(ctx.now)+'T00:00:00Z');
/**
 * v357：卖 CALL 的前提是"有 100 股（1 张）可被行权"。手里不足 1 张、或已被现有 CALL 占满时，
 * 不该催你去卖 —— 你根本卖不出来。口径与「期权状态」卡的"可卖 N 张"一致：
 * floor(持股 / 100) − 活跃 CALL 张数。
 */
function freeContracts(sym){
  var sh=(ctx.trades||[]).reduce(function(s,t){return s+(t&&t.symbol===sym?(Number(t.shares)||0):0)},0);
  var used=activeOpts.reduce(function(s,o){return s+(o&&o.sym===sym&&o.type==='CALL'?(Number(o.contracts)||1):0)},0);
  return freeCallContracts(sh,used);   /* 口径只有一处（options.js），跟「期权状态」卡的"可卖 N 张"共用 */
}
ccRows.forEach(function(r){
  if(!r||!r.nextExpiry)return;
  if(freeContracts(r.sym)<1)return;   /* 不够 100 股就不催：没股票可被行权，卖 CALL 没有意义 */
  markSym(r.sym);
  var left=(Date.parse(r.nextExpiry+'T00:00:00Z')-todayMs)/86400000;
  if(left===0){
    alerts.push({id:'ccdue:'+r.sym,type:'accent',severity:'high',title:'今天该卖 '+r.sym+' 的下一档 CALL',
      detail:r.label+' · '+(r.target?('今天卖出 → '+r.target+' 到期'):'到期日当天卖下一档（旧档到期即新档开仓）'),action:'option'});
  }else if(left===1){
    alerts.push({id:'ccsoon:'+r.sym,type:'blue',severity:'medium',title:'明天该卖 '+r.sym+' 的下一档 CALL',
      detail:r.label+' · '+(r.target?('明天（'+r.nextExpiry+'）卖出 → '+r.target+' 到期'):'到期日 '+r.nextExpiry),action:'option'});
  }
  var s=ccStreaks[r.sym];
  if(s&&s.missed&&s.streak===0&&s.total>0){
    var late=(todayMs-Date.parse(s.missed+'T00:00:00Z'))/86400000;
    if(late>=5){alerts.push({id:'ccmiss:'+r.sym,type:'orange',severity:'medium',title:r.sym+' 本轮 CALL 还没记录',detail:'按节奏 '+s.missed+' 就该卖下一档了 · 已过去 '+Math.round(late)+' 天',action:'option'});}
  }
});
/* 汇总条最后补：只补"这个标的一条其它提醒都没有"的那些（VGT/SMH/BTC 稳定顺序） */
Object.keys(callSummaries).forEach(function(sym){if(symBusy[sym])return;alerts.push(callSummaries[sym])});
return alerts;
}

/** 把提醒渲染到快捷面板与手机端列表，并同时刷新铃铛角标。 */
export function renderAlerts(doc, alerts) {
var container=doc.getElementById('qaAlerts'),mobile=doc.getElementById('mobileAlerts'),meta=doc.getElementById('mobileAlertMeta');
var normalized=normalizeAlerts(alerts);currentAlerts=normalized;updateBellBadge(normalized);var buttons=normalized.map(function(a){return renderAlertItem(a,alertIcons)}).join('');
if(container)container.innerHTML=normalized.length?'<div class="qa-alert-title"><span>待办事项 · 风险优先</span></div>'+buttons:'';
if(mobile)mobile.innerHTML=normalized.length?buttons:emptyStateHTML({title:'暂无待办',hint:'纪律执行正常，继续保持',compact:true});
if(meta)meta.textContent=normalized.length?normalized.length+'项 · 风险优先':'风险优先';
}

export { ALERT_SEVERITY_SCORE, normalizeAlerts, markAlertsSeen, loadAlertSeen, updateBellBadge, loadOptPing, saveOptPing };
