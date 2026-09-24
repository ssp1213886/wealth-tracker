// 时区与交易日：把"北京显示时间 / 美东交易日"的换算集中到一处，便于单测边界。

export const HOME_TIME_ZONE = 'Asia/Shanghai';
export const MARKET_TIME_ZONE = 'America/New_York';
export const MARKET_SESSION_LABELS = { open: '美股交易时段', closed: '美股非交易时段' };

export function zonedDateParts(d,timeZone){d=d||new Date();var parts={};try{new Intl.DateTimeFormat('en-CA',{timeZone:timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(function(p){if(p.type!=='literal')parts[p.type]=p.value})}catch(e){parts.year=String(d.getFullYear());parts.month=('0'+(d.getMonth()+1)).slice(-2);parts.day=('0'+d.getDate()).slice(-2);parts.weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];parts.hour=('0'+d.getHours()).slice(-2);parts.minute=('0'+d.getMinutes()).slice(-2)}return parts}

export function zonedDate(d,timeZone){var p=zonedDateParts(d,timeZone);return p.year+'-'+p.month+'-'+p.day}

export function marketDate(d){return zonedDate(d,MARKET_TIME_ZONE)}

export function marketClock(d){var p=zonedDateParts(d||new Date(),MARKET_TIME_ZONE);return p.hour+':'+p.minute}

export function localDate(d){d=d||new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
