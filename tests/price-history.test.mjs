import test from 'node:test';
import assert from 'node:assert/strict';
import { firstCloseInYear, lastCloseInYear } from '../src/app/price-history.js';

function ts(date) {
  return Date.parse(date + 'T14:30:00Z') / 1000;
}

const timestamps = [ts('2025-01-02'), ts('2025-06-02'), ts('2025-12-31'), ts('2026-01-02')];
const closes = [100, 110, null, 130];

test('price-history：年初取该日期之后第一条有效收盘', () => {
  assert.equal(firstCloseInYear(timestamps, closes, 2025), 100);
  assert.equal(firstCloseInYear(timestamps, closes, 2026), 130);
});

test('price-history：年末取该日期之前最后一条有效收盘', () => {
  assert.equal(lastCloseInYear(timestamps, closes, 2025), 110);
  assert.equal(lastCloseInYear(timestamps, closes, 2026), 130);
});

test('price-history：目标年份完全没有数据时返回 null，绝不拿近代替远古', () => {
  assert.equal(firstCloseInYear(timestamps, closes, 2020), null);
  assert.equal(lastCloseInYear(timestamps, closes, 2020), null);
  assert.equal(firstCloseInYear(timestamps, closes, 2027), null);
  assert.equal(lastCloseInYear(timestamps, closes, 2027), null);
});
