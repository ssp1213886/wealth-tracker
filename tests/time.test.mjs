// 时区与交易日单测（src/app/time.js）
// 关键点：交易按"美东日期"记账，所以北京时间凌晨 4 点前仍属于美股的前一个交易日。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_TIME_ZONE, MARKET_TIME_ZONE, MARKET_SESSION_LABELS,
  zonedDateParts, zonedDate, marketDate, marketClock, localDate,
} from '../src/app/time.js';

test('时区常量与交易日文案', () => {
  assert.equal(HOME_TIME_ZONE, 'Asia/Shanghai');
  assert.equal(MARKET_TIME_ZONE, 'America/New_York');
  assert.equal(MARKET_SESSION_LABELS.open, '美股交易时段');
});

test('marketDate：夏令时期间，北京 04:00 仍算美股前一天', () => {
  // 北京 2026-09-25 04:00 = 美东 2026-09-24 16:00（EDT, UTC-4）
  assert.equal(marketDate(new Date('2026-09-25T04:00:00+08:00')), '2026-09-24');
});

test('marketDate：北京 05:00 仍是美股前一天，中午才进入新交易日', () => {
  // 北京 2026-09-25 05:00 = 美东 2026-09-24 17:00
  assert.equal(marketDate(new Date('2026-09-25T05:00:00+08:00')), '2026-09-24');
  // 北京 2026-09-25 12:00 = 美东 2026-09-25 00:00 → 进入新的一天
  assert.equal(marketDate(new Date('2026-09-25T12:00:00+08:00')), '2026-09-25');
});

test('marketDate：冬令时（EST, UTC-5）边界比夏令时晚一小时', () => {
  // 北京 2026-12-15 05:00 = 美东 2026-12-14 16:00
  assert.equal(marketDate(new Date('2026-12-15T05:00:00+08:00')), '2026-12-14');
  // 北京 2026-12-15 06:00 = 美东 2026-12-14 17:00
  assert.equal(marketDate(new Date('2026-12-15T06:00:00+08:00')), '2026-12-14');
  // 北京 2026-12-15 13:00 = 美东 2026-12-15 00:00
  assert.equal(marketDate(new Date('2026-12-15T13:00:00+08:00')), '2026-12-15');
});

test('marketClock：返回美东的 HH:mm', () => {
  // 北京 2026-09-25 04:00 → 美东 16:00
  assert.equal(marketClock(new Date('2026-09-25T04:00:00+08:00')), '16:00');
  // 北京 2026-09-25 21:30 → 美东 09:30（开盘）
  assert.equal(marketClock(new Date('2026-09-25T21:30:00+08:00')), '09:30');
});

test('zonedDateParts：拿到星期与时分，且不依赖运行时区', () => {
  const parts = zonedDateParts(new Date('2026-09-25T21:30:00+08:00'), MARKET_TIME_ZONE);
  assert.equal(parts.year, '2026');
  assert.equal(parts.month, '09');
  assert.equal(parts.day, '25');
  assert.equal(parts.weekday, 'Fri'); // 2026-09-25 是周五
  assert.equal(parts.hour, '09');
  assert.equal(parts.minute, '30');
});

test('zonedDate：任意时区都能格式化', () => {
  const d = new Date('2026-09-25T21:30:00+08:00');
  assert.equal(zonedDate(d, 'Asia/Shanghai'), '2026-09-25');
  assert.equal(zonedDate(d, 'America/New_York'), '2026-09-25');
  assert.equal(zonedDate(d, 'UTC'), '2026-09-25');
});

test('zonedDateParts：非法时区回退到本机时间而不是抛错', () => {
  const parts = zonedDateParts(new Date('2026-09-25T12:00:00+08:00'), 'Not/AZone');
  assert.match(parts.year, /^\d{4}$/);
  assert.match(parts.month, /^\d{2}$/);
  assert.match(parts.day, /^\d{2}$/);
});

test('localDate：按本机时区输出 YYYY-MM-DD', () => {
  assert.match(localDate(new Date('2026-09-25T12:00:00+08:00')), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});
