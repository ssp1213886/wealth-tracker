// 本机存储按账号隔离（src/app/store.js）：
// 同一台设备上两个账号必须各存一份，切换账号不能互相看见。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LS, KEYS, readRaw, writeRaw, removeKey, readJSON, writeJSON, setStorageNamespace, storageNamespace, namespacedKeys } from '../src/app/store.js';

function withFakeStorage(fn) {
  const map = new Map();
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      get length() { return map.size; },
      key: (i) => Array.from(map.keys())[i] ?? null,
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    },
  });
  try {
    return fn(map);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
}

test('命名空间：同一个键在两个账号下是两份数据，互不可见', () => {
  withFakeStorage((map) => {
    setStorageNamespace(1);
    writeRaw(KEYS.trades, '[{"id":1}]');
    assert.equal(map.get('u1:' + KEYS.trades), '[{"id":1}]', '实际落库的键要带 u1: 前缀');
    assert.equal(readRaw(KEYS.trades), '[{"id":1}]');

    setStorageNamespace(2);
    assert.equal(readRaw(KEYS.trades), null, '账号 2 不该看到账号 1 的数据');
    writeRaw(KEYS.trades, '[{"id":9}]');
    assert.equal(storageNamespace(), 'u2:');

    setStorageNamespace(1);
    assert.equal(readRaw(KEYS.trades), '[{"id":1}]', '切回来数据还在');
    setStorageNamespace(2);
    assert.equal(readRaw(KEYS.trades), '[{"id":9}]');
  });
});

test('LS 垫片与 readJSON/writeJSON/removeKey 都走前缀', () => {
  withFakeStorage((map) => {
    setStorageNamespace(7);
    LS.setItem('wealth_x', 'v1');
    assert.equal(map.get('u7:wealth_x'), 'v1');
    assert.equal(LS.getItem('wealth_x'), 'v1');
    LS.removeItem('wealth_x');
    assert.equal(LS.getItem('wealth_x'), null);

    writeJSON('wealth_json', { a: 1 });
    assert.deepEqual(readJSON('wealth_json', null), { a: 1 });
    assert.equal(map.get('u7:wealth_json'), '{"a":1}');
    removeKey('wealth_json');
    assert.equal(readJSON('wealth_json', 'fallback'), 'fallback');
  });
});

test('namespacedKeys 只列当前账号的键（清空数据/备份时不会误伤别人）', () => {
  withFakeStorage(() => {
    setStorageNamespace(1);
    writeRaw('wealth_a', '1');
    writeRaw('wealth_b', '2');
    setStorageNamespace(2);
    writeRaw('wealth_c', '3');
    assert.deepEqual(namespacedKeys().sort(), ['wealth_c']);
    setStorageNamespace(1);
    assert.deepEqual(namespacedKeys().sort(), ['wealth_a', 'wealth_b']);
  });
});

test('没有会话（无 wt_uid）时退回无前缀，老数据仍读得到', () => {
  withFakeStorage((map) => {
    map.set('wealth_trades_v2', '[{"id":0}]');
    setStorageNamespace('');
    assert.equal(readRaw(KEYS.trades), '[{"id":0}]');
  });
});
