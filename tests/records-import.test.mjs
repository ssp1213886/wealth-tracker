// 记录域纯逻辑单测（v244 抽出）：本地数据规整 + Schwab CSV 解析
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRADE_SYMBOLS, normalizeTrades, normalizeCashLogs, normalizeActivities,
  parseCSVRow, parseMoneyValue, parseSchwabCSV,
} from '../src/app/records-import.js';

test('normalizeTrades：合法记录通过，日期归一化，方向与 tag 正确', () => {
  const rows = normalizeTrades([
    { id: 1, symbol: 'vgt', date: '7/18/2026', shares: 10, price: 100, time: '10:00' },
    { id: 2, symbol: 'SMH', date: '2026-07-19', shares: -2, price: 500, tag: 'assign' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: 1, symbol: 'VGT', date: '2026-07-18', time: '10:00', shares: 10, price: 100, type: 'buy', tag: '' });
  assert.equal(rows[1].type, 'sell');
  assert.equal(rows[1].tag, 'assign');
});

test('normalizeTrades：非白名单标的/坏日期/零股数/非正价格一律剔除', () => {
  const rows = normalizeTrades([
    { id: 1, symbol: 'BTC-USD', date: '2026-07-18', shares: 1, price: 100 },   // 现货不是 ETF 代码
    { id: 2, symbol: 'VGT', date: '2026-13-40', shares: 1, price: 100 },       // 坏日期
    { id: 3, symbol: 'VGT', date: '2026-07-18', shares: 0, price: 100 },       // 零股数
    { id: 4, symbol: 'VGT', date: '2026-07-18', shares: 1, price: 0 },         // 价格 0
    { id: 5, symbol: 'VGT', date: '2026-07-18', shares: 1, price: -5 },        // 负价格
    { id: 6, symbol: 'SPY', date: '2026-07-18', shares: 1, price: 100 },       // 不在核心仓
  ]);
  assert.deepEqual(rows, []);
  assert.deepEqual(normalizeTrades('not-an-array'), []);
  assert.equal(normalizeTrades([{ symbol: 'VGT', date: '2026-07-18', shares: 1, price: 1 }]).length, 1, '不传白名单时用默认三只');
  assert.deepEqual(TRADE_SYMBOLS, ['VGT', 'SMH', 'BTC']);
});

test('normalizeTrades：id 缺失或重复时自动补一个唯一值', () => {
  const rows = normalizeTrades([
    { id: 7, symbol: 'VGT', date: '2026-07-18', shares: 1, price: 100 },
    { id: 7, symbol: 'SMH', date: '2026-07-18', shares: 1, price: 100 },
    { symbol: 'BTC', date: '2026-07-18', shares: 1, price: 100 },
  ]);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, 3, '三行 id 必须互不相同');
  assert.ok(ids.every((id) => Number.isFinite(id)));
});

test('normalizeCashLogs：日期/类型/金额缺一不可', () => {
  const rows = normalizeCashLogs([
    { id: 1, date: '2026/9/2', type: '入金', amount: '5000' },
    { id: 2, date: '', type: '入金', amount: 100 },
    { id: 3, date: '2026-09-02', type: '', amount: 100 },
    { id: 4, date: '2026-09-02', type: '出金', amount: 'abc' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-09-02');
  assert.equal(rows[0].amount, 5000);
});

test('normalizeActivities：只保留最近 200 条，坏日期剔除', () => {
  const many = [];
  for (let i = 0; i < 250; i += 1) many.push({ id: i + 1, date: '2026-09-01', time: '10:00', action: '买入 ' + i, detail: '' });
  many.unshift({ id: 999, date: 'bad', action: 'x' });   // 坏日期的放最前，会被"最近 200 条"直接截掉
  const rows = normalizeActivities(many);
  assert.equal(rows.length, 200);
  assert.equal(rows[rows.length - 1].action, '买入 249', '保留的是最后 200 条');
  assert.ok(rows.every((r) => r.date === '2026-09-01'));
  assert.deepEqual(normalizeActivities(null), []);
});

test('parseCSVRow / parseMoneyValue：引号、逗号、货币符号', () => {
  assert.deepEqual(parseCSVRow('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCSVRow('"a,b",c'), ['a,b', 'c']);
  assert.deepEqual(parseCSVRow('"say ""hi""",2'), ['say "hi"', '2']);
  assert.equal(parseMoneyValue('"$1,234.50"'), 1234.5);
  assert.equal(parseMoneyValue('$0'), 0);
  assert.equal(parseMoneyValue('abc'), 0);
});

test('parseSchwabCSV：英文表头 + 买/卖 + 去重 + 白名单过滤', () => {
  const csv = [
    'Date,Action,Symbol,Quantity,Price',
    '07/18/2026,Buy,BTC,10,"$28.38"',
    '07/18/2026,Sell,VGT,1,"$113.10"',
    '07/18/2026,Buy,SPY,1,"$500.00"',      // 不在白名单 → 跳过
    '07/18/2026,Buy,BTC,10,"$28.38"',      // 与上一行重复 → 跳过
  ].join('\n');
  const out = parseSchwabCSV(csv, { symbols: TRADE_SYMBOLS, existingTrades: [], now: new Date('2026-09-29T02:00:00Z') });
  assert.equal(out.imported, 2);
  assert.equal(out.rows[0].symbol, 'BTC');
  assert.equal(out.rows[0].shares, 10);
  assert.equal(out.rows[1].symbol, 'VGT');
  assert.equal(out.rows[1].shares, -1, 'Sell 记负股数');
  assert.match(out.rows[0].time, /^\d{2}:\d{2}$/);
});

test('parseSchwabCSV：中文表头识别；缺表头时报错；与已有交易去重', () => {
  const cn = ['日期,方向,代码,数量,成交价', '2026/7/18,买入,BTC,10,28.38'].join('\n');
  const out = parseSchwabCSV(cn);
  assert.equal(out.imported, 1);
  assert.equal(out.rows[0].symbol, 'BTC');
  assert.equal(out.rows[0].shares, 10);
  assert.throws(() => parseSchwabCSV('foo,bar\n1,2'), /未找到 Date、Symbol、Quantity、Price 列/);
  const dup = parseSchwabCSV(cn, { existingTrades: [{ date: '2026-07-18', symbol: 'BTC', shares: 10, price: 28.38 }] });
  assert.equal(dup.imported, 0, '与已有交易重复时不重复导入');
});
