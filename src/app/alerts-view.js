// 待办提醒（首页快捷面板 + 手机端铃铛角标）的视图层。
// v253 从 index.js 抽出：这里既有"算提醒"（buildAlerts，纯函数可离线测），也有渲染与角标。
// 快捷面板开关（qaToggle）与页面级事件委托仍留在 index.js。

import { readRaw, removeKey , LS } from './store.js';
import { marketDate } from './time.js';
import { isActiveOption, optionExpiryState } from './options.js';
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
var items=list||[],count=items.length,sig=alertSignature(items),unseen=count>0&&sig!==loadAlertSeen();
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
activeOpts.filter(function(o){return o.type==='CALL'}).forEach(function(o){if(!callGroups[o.sym])callGroups[o.sym]=[];callGroups[o.sym].push(o)});
Object.keys(callGroups).sort(function(a,b){var order=['VGT','SMH','BTC'],ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b)}).forEach(function(sym){
var calls=callGroups[sym].slice().sort(function(a,b){return String(a.expiry).localeCompare(String(b.expiry))}),contracts=calls.reduce(function(sum,o){return sum+(Number(o.contracts)||1)},0),nearest=calls[0],days=optionExpiryState(nearest.expiry,ctx.now).days,cp=ctx.prices[sym]||0,closest=calls.slice().sort(function(a,b){return Math.abs(cp-a.strike)-Math.abs(cp-b.strike)})[0],type='blue',severity='medium',detail='覆盖 '+contracts*100+' 股 · 最近 '+nearest.expiry.slice(5)+' 到期';
if(cp>0&&closest&&cp>=closest.strike*0.98){type='red';severity='critical';detail='当前 $'+cp.toFixed(2)+' · 行权价 $'+closest.strike.toFixed(0)+' · 最近 '+closest.expiry.slice(5)}
alerts.push({id:'call:'+sym,type:type,severity:severity,title:sym+' 已卖 '+contracts+' 张 Call',detail:detail,action:'option'})
});
var pingMap=ctx.pingMap,todayKey=marketDate(ctx.now);
opts.forEach(function(o){if(o.settled||o.archived||!o.expiry)return;var st=optionExpiryState(o.expiry,ctx.now);if(st.days>7)return;if(pingMap[o.id]===todayKey)return;var expired=st.expired,leftDays=Math.max(0,st.days),cnt=Number(o.contracts)||1;alerts.push({id:'expiry:'+o.id,type:expired?'red':'orange',severity:expired?'critical':'high',title:o.sym+' '+o.type+' $'+o.strike.toFixed(0)+(expired?' 已过期未结算':' 还剩 '+leftDays+' 天到期'),detail:'到期日 '+o.expiry+' · '+cnt+' 张'+(expired?' · 请确认行权或结算':''),action:'option',dismiss:'opt-expiry-'+o.id})});
var monthBuys=ctx.trades.filter(function(t){return t.date.slice(0,7)===now&&t.shares>0}),buyTotal=monthBuys.reduce(function(s,t){return s+(t.price*Math.abs(t.shares))},0),dcaTarget=ctx.state.dcaOverride&&ctx.state.dcaOverride.month===now?ctx.state.dcaOverride.amount:ctx.state.monthlyDCA;
if(dcaTarget&&buyTotal<dcaTarget*0.9){var gap=dcaTarget-buyTotal;alerts.push({id:'dca:'+now,type:'accent',severity:'low',title:'本月定投还差 '+fmtFull(gap),detail:'完成后保持目标资产配比',action:'console'})}
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
