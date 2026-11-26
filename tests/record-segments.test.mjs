import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_SEGMENTS,
  normalizeRecordSegment,
  bindRecordSegments,
} from '../src/app/record-segments.js';

function makeButton(segment) {
  const classes = new Set(segment === 'data' ? ['record-seg', 'active'] : ['record-seg']);
  const attrs = {
    'data-seg': segment,
    'aria-selected': segment === 'data' ? 'true' : 'false',
    tabindex: segment === 'data' ? '0' : '-1',
  };
  return {
    hidden: false,
    focused: false,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { attrs[name] = String(value); },
    closest(selector) { return selector.includes('[data-seg]') ? this : null; },
    focus() { this.focused = true; },
  };
}

function makeGroup(segment) {
  const classes = new Set(segment === 'data' ? ['record-group', 'active'] : ['record-group']);
  const attrs = {
    'data-group': segment,
    'aria-hidden': segment === 'data' ? 'false' : 'true',
  };
  return {
    hidden: segment !== 'data',
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { attrs[name] = String(value); },
  };
}

function makeDoc() {
  const buttons = [makeButton('data'), makeButton('log')];
  const groups = [makeGroup('data'), makeGroup('log')];
  const listeners = {};
  return {
    buttons,
    groups,
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelectorAll(selector) {
      if (selector === '#recordSeg [data-seg]') return buttons;
      if (selector === '#tab-data .record-group[data-group]') return groups;
      return [];
    },
    querySelector(selector) {
      const match = selector.match(/data-seg="([^"]+)"/);
      return match ? buttons.find((button) => button.getAttribute('data-seg') === match[1]) : null;
    },
    emit(type, event) { listeners[type](event); },
  };
}

test('normalizeRecordSegment：只允许明细与日志', () => {
  assert.deepEqual(RECORD_SEGMENTS, ['data', 'log']);
  assert.equal(normalizeRecordSegment('log'), 'log');
  assert.equal(normalizeRecordSegment('data'), 'data');
  assert.equal(normalizeRecordSegment('unknown'), 'data');
  assert.equal(normalizeRecordSegment(null), 'data');
});

test('bindRecordSegments：点击、键盘与 ARIA 状态同步', () => {
  const doc = makeDoc();
  const changes = [];
  const control = bindRecordSegments(doc, {
    initial: 'data',
    onChange: (segment) => changes.push(segment),
  });

  assert.equal(control.current(), 'data');
  assert.equal(doc.groups[0].hidden, false);
  assert.equal(doc.groups[1].hidden, true);

  doc.emit('click', { target: doc.buttons[1] });
  assert.equal(control.current(), 'log');
  assert.equal(doc.buttons[1].focused, true);
  assert.equal(doc.buttons[1].getAttribute('aria-selected'), 'true');
  assert.equal(doc.buttons[0].getAttribute('tabindex'), '-1');
  assert.equal(doc.groups[1].hidden, false);
  assert.equal(doc.groups[1].getAttribute('aria-hidden'), 'false');
  assert.equal(doc.groups[0].hidden, true);
  assert.deepEqual(changes, ['log']);

  doc.emit('keydown', { key: 'ArrowLeft', target: doc.buttons[1], preventDefault() {} });
  assert.equal(control.current(), 'data');
  assert.equal(doc.buttons[0].focused, true);
  assert.deepEqual(changes, ['log', 'data']);
});
