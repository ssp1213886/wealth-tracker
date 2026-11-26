// 记录页顶部“明细 / 日志”分段控制。
// 只负责 DOM 状态、键盘导航和持久化回调，具体存哪个 key 由 index.js 注入。

export const RECORD_SEGMENTS = Object.freeze(['data', 'log']);

export function normalizeRecordSegment(value) {
  return value === 'log' ? 'log' : 'data';
}

export function paintRecordSegment(doc, value) {
  const current = normalizeRecordSegment(value);
  const buttons = Array.from(doc.querySelectorAll('#recordSeg [data-seg]'));
  buttons.forEach(function (button) {
    const on = button.getAttribute('data-seg') === current;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.setAttribute('tabindex', on ? '0' : '-1');
  });
  const groups = Array.from(doc.querySelectorAll('#tab-data .record-group[data-group]'));
  groups.forEach(function (group) {
    const on = group.getAttribute('data-group') === current;
    group.classList.toggle('active', on);
    group.hidden = !on;
    group.setAttribute('aria-hidden', on ? 'false' : 'true');
  });
  return current;
}

export function bindRecordSegments(doc, options) {
  const o = options || {};
  let current = normalizeRecordSegment(typeof o.read === 'function' ? o.read() : o.initial);

  function select(value, opts) {
    const next = normalizeRecordSegment(value);
    const changed = next !== current;
    current = paintRecordSegment(doc, next);
    if (changed && typeof o.onChange === 'function') o.onChange(current);
    if (opts && opts.focus) {
      const target = doc.querySelector('#recordSeg [data-seg="' + current + '"]');
      if (target && typeof target.focus === 'function') target.focus();
    }
    return current;
  }

  function tabFromEvent(event, selector) {
    const target = event && event.target;
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  doc.addEventListener('click', function (event) {
    const button = tabFromEvent(event, '#recordSeg [data-seg]');
    if (!button) return;
    select(button.getAttribute('data-seg'), { focus: true });
  });

  doc.addEventListener('keydown', function (event) {
    const button = tabFromEvent(event, '#recordSeg [data-seg]');
    if (!button) return;
    const index = RECORD_SEGMENTS.indexOf(normalizeRecordSegment(button.getAttribute('data-seg')));
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = RECORD_SEGMENTS[(index + 1) % RECORD_SEGMENTS.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = RECORD_SEGMENTS[(index - 1 + RECORD_SEGMENTS.length) % RECORD_SEGMENTS.length];
    else if (event.key === 'Home') next = RECORD_SEGMENTS[0];
    else if (event.key === 'End') next = RECORD_SEGMENTS[RECORD_SEGMENTS.length - 1];
    if (!next) return;
    event.preventDefault();
    select(next, { focus: true });
  });

  select(current);
  return {
    select: select,
    current: function () { return current; },
  };
}
