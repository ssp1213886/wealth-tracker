import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDcaBatch } from '../src/app/dca-batch.js';

test('parseDcaBatch：按实际成交记录，空行跳过并计算合计', () => {
  const batch = parseDcaBatch({
    date: '2026-11-27',
    rows: [
      { symbol: 'QQQM', shares: '2.5', price: '260' },
      { symbol: 'VGT', shares: '', price: '' },
      { symbol: 'SMH', shares: '1', price: '420.25' },
    ],
  });
  assert.equal(batch.ok, true);
  assert.equal(batch.rows.length, 2);
  assert.equal(batch.rows[0].amount, 650);
  assert.equal(batch.rows[1].amount, 420.25);
  assert.equal(batch.total, 1070.25);
});

test('parseDcaBatch：股数和价格只填一项时指出具体标的和字段', () => {
  const batch = parseDcaBatch({
    date: '2026-11-27',
    rows: [{ symbol: 'VGT', shares: '1.2', price: '' }],
  });
  assert.equal(batch.ok, false);
  assert.deepEqual(batch.errors[0], {
    symbol: 'VGT',
    field: 'price',
    message: 'VGT 请同时填写股数和成交价',
  });
});

test('parseDcaBatch：至少需要一笔有效成交，日期必须有效', () => {
  const empty = parseDcaBatch({ date: '2026-11-27', rows: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.empty, true);
  assert.match(empty.errors[0].message, /至少填写一笔/);

  const badDate = parseDcaBatch({
    date: 'not-a-date',
    rows: [{ symbol: 'QQQM', shares: '1', price: '250' }],
  });
  assert.equal(badDate.ok, false);
  assert.ok(badDate.errors.some((error) => error.field === 'date'));
});

test('parseDcaBatch：非正股数、非正价格和非法标的不能写入', () => {
  const batch = parseDcaBatch({
    date: '2026-11-27',
    rows: [
      { symbol: 'QQQM', shares: '0', price: '250' },
      { symbol: 'VGT', shares: '1', price: '-1' },
      { symbol: 'IBIT', shares: '1', price: '30' },
    ],
  });
  assert.equal(batch.ok, false);
  assert.equal(batch.rows.length, 0);
  assert.ok(batch.errors.some((error) => error.symbol === 'QQQM' && error.field === 'shares'));
  assert.ok(batch.errors.some((error) => error.symbol === 'VGT' && error.field === 'price'));
  assert.equal(batch.total, 0);
});
