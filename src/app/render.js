// 独立渲染工具：不依赖全局状态，输入什么渲染什么，可直接单测。
import { cleanText } from './util.js';

export function escapeHtml(v){return cleanText(v,500).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

export function emptyStateHTML(opts){
  var o=opts||{};
  var icon=o.icon||'<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><path d="m4 7 8 6 8-6"/></svg>';
  var cls='ds-empty'+(o.compact?' ds-empty-compact':'');
  var esc=function(s){return String(s).replace(/[<>&]/g,function(c){return c==='<'?'&lt;':c==='>'?'&gt;':'&amp;'})};
  var html='<div class="'+cls+'" role="status"><span class="ds-empty-icon" aria-hidden="true">'+icon+'</span>';
  html+='<span class="ds-empty-title">'+esc(o.title||'暂无数据')+'</span>';
  if(o.hint)html+='<span class="ds-empty-hint">'+esc(o.hint)+'</span>';
  return html+'</div>';
}

export function renderAlertItem(a,icons){var icon=icons[a.type]||icons.blue;return '<div class="qa-alert-item qa-alert-'+a.type+'" data-alert-id="'+escapeHtml(a.id)+'" data-alert-severity="'+escapeHtml(a.severity)+'"><button type="button" class="qa-alert-main" data-alert-action="'+escapeHtml(a.action)+'"><span class="alert-leading"><i class="alert-icon">'+icon+'</i><span class="alert-copy"><strong>'+escapeHtml(a.title||'待办事项')+'</strong><small>'+escapeHtml(a.detail||'点击查看详情')+'</small></span></span><b aria-hidden="true">›</b></button>'+(a.dismiss?'<button type="button" class="qa-alert-dismiss" data-alert-dismiss="'+escapeHtml(a.dismiss)+'" aria-label="今天不再提醒">×</button>':'')+'</div>'}

export function alertSignature(list){try{return (list||[]).map(function(a){return String(a&&a.id)+':'+String(a&&a.severity)}).sort().join('|')}catch(e){return ''}}
