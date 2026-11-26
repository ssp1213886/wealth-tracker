import { escapeHtml } from './render.js';

function fmtPrice(value) {
  const n = Number(value);
  return n > 0 ? '$' + n.toFixed(2) : '—';
}

function fmtWhen(value) {
  const ms = Number(value);
  if (!(ms > 0)) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
  }
}

export function maCrossItemHtml(event) {
  const e = event || {};
  const symbol = String(e.symbol || '').toUpperCase();
  const period = Number(e.period) || 0;
  const up = e.toSide === 'ABOVE';
  const direction = up ? '上穿' : '下穿';
  const title = symbol + ' ' + direction + ' ' + period + ' 日均线';
  const detail = '价格 ' + fmtPrice(e.price) + ' · ' + period + ' 日均线 ' + fmtPrice(e.average) +
    (fmtWhen(e.triggeredAt) ? ' · 触发 ' + fmtWhen(e.triggeredAt) : '');
  return '<div class="ma-cross-item ' + (up ? 'is-above' : 'is-below') + '">' +
    '<div class="ma-cross-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(detail) + '</small></div>' +
    '<button type="button" class="ma-cross-ack" data-ma-cross-ack="' + escapeHtml(String(e.id || '')) + '">知道了</button>' +
    '</div>';
}

export function maCrossHtml(events, opts) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const c = opts || {};
  if (!list.length) {
    const text = c.loading ? '读取均线穿越提醒…' : (c.error ? '均线提醒暂不可用' : '暂无待确认的均线穿越');
    return '<div class="ma-cross-empty">' + escapeHtml(text) + '</div>';
  }
  return '<div class="ma-cross-list">' + list.map(maCrossItemHtml).join('') + '</div>';
}

export function renderMaCross(doc, events, opts) {
  const list = doc.getElementById('maCrossList');
  const count = doc.getElementById('maCrossCount');
  const n = Array.isArray(events) ? events.length : 0;
  if (count) count.textContent = String(n);
  if (list) list.innerHTML = maCrossHtml(events, opts);
}
