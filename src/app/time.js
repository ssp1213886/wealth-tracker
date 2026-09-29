import {cleanText} from './util.js';

// 时区与交易日：把"北京显示时间 / 美东交易日"的换算集中到一处，便于单测边界。

export const HOME_TIME_ZONE = 'Asia/Shanghai';
export const MARKET_TIME_ZONE = 'America/New_York';
export const MARKET_SESSION_LABELS = { open: '美股交易时段', closed: '美股非交易时段' };

export function zonedDateParts(d,timeZone){d=d||new Date();var parts={};try{new Intl.DateTimeFormat('en-CA',{timeZone:timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(function(p){if(p.type!=='literal')parts[p.type]=p.value})}catch(e){parts.year=String(d.getFullYear());parts.month=('0'+(d.getMonth()+1)).slice(-2);parts.day=('0'+d.getDate()).slice(-2);parts.weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];parts.hour=('0'+d.getHours()).slice(-2);parts.minute=('0'+d.getMinutes()).slice(-2)}return parts}

export function zonedDate(d,timeZone){var p=zonedDateParts(d,timeZone);return p.year+'-'+p.month+'-'+p.day}

export function marketDate(d){return zonedDate(d,MARKET_TIME_ZONE)}

export function marketClock(d){var p=zonedDateParts(d||new Date(),MARKET_TIME_ZONE);return p.hour+':'+p.minute}

export function localDate(d){d=d||new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}

/** 日期字符串归一化：接受 2026/9/1、9/1/2026 等写法，统一成 YYYY-MM-DD；非法返回空串。
 *  （v238 从 index.js 移到这里：期权到期日与交易日期都要用） */
export function normalizeDateValue(v){var s=cleanText(v,20);var m;if((m=s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)))s=m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');else if((m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)))s=m[3]+'-'+String(m[1]).padStart(2,'0')+'-'+String(m[2]).padStart(2,'0');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return'';var d=new Date(s+'T12:00:00');return isNaN(d.getTime())||localDate(d)!==s?'':s}
