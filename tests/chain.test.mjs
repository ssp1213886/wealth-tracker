// 期权链代理的纯逻辑单测（v325）：OSI 合约代码解析 + 链的裁剪/归一化。
// 这段决定了喂给概率计算的原始数据干不干净，所以脏数据必须被挡在外面。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsiSymbol, buildChain, dedupeMonthly } from '../src/lib/chain.js';

/** 2026-10-08 00:00 UTC 的秒级时间戳，作为所有用例的"现在"。 */
const NOW = Math.floor(Date.UTC(2026, 9, 8) / 1000);
const day = (n) => NOW + n * 86400;

test('parseOsiSymbol：解析 CBOE 的合约代码（标的+YYMMDD+C/P+行权价×1000）', () => {
  const p = parseOsiSymbol('SMH261007C00390000');
  assert.equal(p.cp, 'C');
  assert.equal(p.strike, 390);
  assert.equal(p.date, '2026-10-07');
  assert.equal(p.root, 'SMH');
  assert.equal(p.ts, Math.floor(Date.UTC(2026, 9, 7) / 1000));
  // 小数行权价：660.5 → 00660500
  assert.equal(parseOsiSymbol('SMH261120C00660500').strike, 660.5);
  // 小写的也认
  assert.equal(parseOsiSymbol('vgt261120c00140000').strike, 140);
});

test('parseOsiSymbol：脏值一律返回 null（不存在的月份/日期、缺字段、长度不对）', () => {
  assert.equal(parseOsiSymbol('SMH261332C00390000'), null, '13 月 32 日不存在');
  assert.equal(parseOsiSymbol('SMH261007X00390000'), null, 'C/P 位非法');
  assert.equal(parseOsiSymbol('SMH261007C0039000'), null, '行权价不足 8 位');
  assert.equal(parseOsiSymbol('261007C00390000'), null, '缺标的');
  assert.equal(parseOsiSymbol(''), null);
  assert.equal(parseOsiSymbol(null), null);
  assert.equal(parseOsiSymbol(undefined), null);
});

test('buildChain：只留 CALL、只留半年内、只留现价 0.9~1.5 倍的行权价', () => {
  const contracts = [
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 140, bid: 0.7, ask: 1.4, last: 0.9, iv: 0.213, oi: 1935, vol: 29, delta: 0.176 },
    { ts: day(43), date: '2026-11-20', cp: 'P', strike: 140, bid: 12, ask: 13, last: 12.5, iv: 0.24, oi: 100, vol: 3, delta: -0.3 }, // PUT 剔除
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 400, bid: 0.01, ask: 0.05, last: 0.02, iv: 0.5, oi: 1, vol: 0, delta: 0.001 }, // 太远剔除
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 100, bid: 29, ask: 30, last: 29.5, iv: 0.30, oi: 1, vol: 0, delta: 0.95 }, // 太近（虚值链用不上）剔除
    { ts: day(-1), date: '2026-10-07', cp: 'C', strike: 140, bid: 1, ask: 2, last: 1.5, iv: 0.2, oi: 1, vol: 1, delta: 0.5 }, // 已过期剔除
    { ts: day(300), date: '2027-08-04', cp: 'C', strike: 145, bid: 8, ask: 9, last: 8.5, iv: 0.3, oi: 1, vol: 1, delta: 0.3 }, // 超 200 天剔除
  ];
  const chain = buildChain(contracts, { sym: 'VGT', spot: 129.37, source: 'cboe', updated: 'x', now: NOW });
  assert.equal(chain.sym, 'VGT');
  assert.equal(chain.spot, 129.37);
  assert.equal(chain.source, 'cboe');
  assert.equal(chain.expiries.length, 1, '只剩 2026-11-20 一个到期日');
  assert.equal(chain.expiries[0].date, '2026-11-20');
  assert.equal(chain.expiries[0].dte, 43);
  assert.deepEqual(chain.expiries[0].calls.map((c) => c.k), [140]);
});

const mk = (date) => ({ date, ts: Math.floor(Date.parse(date + 'T00:00:00Z') / 1000) });

test('dedupeMonthly：每月只留一档，优先第三个周五', () => {
  // 2026-11 的周五是 6/13/20/27，第三个周五 = 11-20；2026-12 的周五是 4/11/18/25，第三个周五 = 12-18
  const out = dedupeMonthly([
    mk('2026-11-06'), mk('2026-11-13'), mk('2026-11-20'), mk('2026-11-27'),
    mk('2026-12-04'), mk('2026-12-18'),
  ]);
  assert.deepEqual(out.map((e) => e.date), ['2026-11-20', '2026-12-18']);
});

test('dedupeMonthly：当月没有第三个周五时，取最接近 19 号的那档', () => {
  // 2026-11-10 与 11-24 都不是周五；|10-19|=9 比 |24-19|=5 远，所以该留 11-24
  assert.deepEqual(dedupeMonthly([mk('2026-11-10'), mk('2026-11-24')]).map((e) => e.date), ['2026-11-24']);
});

/**
 * 回归用例（v325 实测抓到的真 bug）：SMH 这类 ETF 的期权链里，最近的到期日全是**周度**。
 * 旧实现按"最近 N 个到期日"截断，43 天的月度档被周度挤出列表 —— 反解退到 29 天短周期，
 * 年化权利金率被高估（实测 22.0% vs 正确的 19.8%）。
 */
test('buildChain：周度链被压成每月一档，月度档不会被挤出', () => {
  const contracts = [];
  // 2026-10/11/12 每个周五都挂一张，同一个月度档同时存在于链里
  const fridays = [
    '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30',
    '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27',
    '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25',
  ];
  fridays.forEach((date) => {
    [130, 135, 140].forEach((k) => {
      contracts.push({
        ts: Math.floor(Date.parse(date + 'T00:00:00Z') / 1000), date, cp: 'C',
        strike: k, bid: 1, ask: 2, last: 1.5, iv: 0.2, oi: 1, vol: 1, delta: 0.2,
      });
    });
  });
  const chain = buildChain(contracts, { sym: 'SMH', spot: 129.37, now: NOW });
  assert.deepEqual(chain.expiries.map((e) => e.date), ['2026-10-16', '2026-11-20', '2026-12-18'],
    '每个日历月只剩第三个周五那一档');
  assert.deepEqual(chain.expiries[0].calls.map((c) => c.k), [130, 135, 140], '行权价升序');
  const dtes = chain.expiries.map((e) => e.dte);
  assert.deepEqual(dtes, dtes.slice().sort((a, b) => a - b), '按时间升序');
});

test('buildChain：跨很多月时最多保留 10 档', () => {
  const contracts = [];
  for (let m = 0; m < 6; m += 1) {
    const dt = new Date(Date.UTC(2026, 9 + m, 16));
    const date = dt.toISOString().slice(0, 10);
    contracts.push({
      ts: Math.floor(dt.getTime() / 1000), date, cp: 'C',
      strike: 140, bid: 1, ask: 2, last: 1.5, iv: 0.2, oi: 1, vol: 1, delta: 0.2,
    });
  }
  const chain = buildChain(contracts, { sym: 'VGT', spot: 129.37, now: NOW });
  assert.ok(chain.expiries.length <= 10, '实际 ' + chain.expiries.length);
  assert.ok(chain.expiries.length >= 5, '半年内应有 5 档以上，实际 ' + chain.expiries.length);
});

test('buildChain：字段清洗 —— 负/NaN 报价归 0，iv 为 0 时保持 0（让前端反推）', () => {
  const contracts = [
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 140, bid: -1, ask: NaN, last: undefined, iv: 0, oi: null, vol: -5, delta: NaN },
  ];
  const call = buildChain(contracts, { sym: 'VGT', spot: 129.37, now: NOW }).expiries[0].calls[0];
  assert.deepEqual(call, { k: 140, b: 0, a: 0, lp: 0, iv: 0, oi: 0, v: 0, d: 0 });
});

test('buildChain：现价缺失时不按行权价过滤（宁可多留也不误杀）', () => {
  const contracts = [
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 400, bid: 1, ask: 2, last: 1.5, iv: 0.2, oi: 1, vol: 1, delta: 0.1 },
    { ts: day(43), date: '2026-11-20', cp: 'C', strike: 1000, bid: 1, ask: 2, last: 1.5, iv: 0.2, oi: 1, vol: 1, delta: 0.1 },
  ];
  const chain = buildChain(contracts, { sym: 'VGT', spot: 0, now: NOW });
  assert.equal(chain.spot, 0);
  assert.equal(chain.expiries[0].calls.length, 2);
});

test('buildChain：空输入不会炸', () => {
  assert.deepEqual(buildChain([], { sym: 'VGT', spot: 100, now: NOW }).expiries, []);
  assert.deepEqual(buildChain(null, { sym: 'VGT', spot: 100, now: NOW }).expiries, []);
  assert.deepEqual(buildChain(undefined, {}).expiries, []);
});
