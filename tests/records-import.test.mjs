// 记录域纯逻辑单测（v244 抽出）：本地数据规整 + Schwab CSV 解析
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRADE_SYMBOLS, normalizeTrades, normalizeCashLogs, normalizeActivities,
  parseCSVRow, parseMoneyValue, parseSchwabCSV, csvSkipSummary,
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
  assert.deepEqual(TRADE_SYMBOLS, ['VGT', 'SMH', 'IBIT']);
});

test('normalizeTrades：历史的 BTC（Grayscale Mini Trust）按别名归一成 IBIT', () => {
  /* v373：第三腿换成 IBIT 之后，任何写着 BTC 的交易都按 IBIT 记账 ——
     既不让"旧设备推回来的数据"被剔除丢掉，也不留旧的 Mini Trust 语义。 */
  const rows = normalizeTrades([
    { id: 1, symbol: 'BTC', date: '2026-07-18', shares: 10, price: 28.38 },
    { id: 2, symbol: 'btc', date: '2026-07-19', shares: 5, price: 29 },
    { id: 3, symbol: 'BTC-USD', date: '2026-07-20', shares: 1, price: 100 },   // 加密现货仍不是交易标的
  ]);
  assert.deepEqual(rows.map((r) => r.symbol), ['IBIT', 'IBIT'], 'BTC 一律归一成 IBIT');
  /* 1 股 ≠ 1 股：股数按比例换算（×0.778456），但**成本（股数×价格）必须一分不差** */
  assert.ok(Math.abs(rows[0].shares - 10 * 0.778456) < 1e-6, '股数要按比例换算');
  assert.ok(Math.abs(rows[0].shares * rows[0].price - 10 * 28.38) < 1e-3, '成本不变');
  assert.ok(Math.abs(rows[1].shares - 5 * 0.778456) < 1e-6);
});

test('normalizeTrades：id 缺失或重复时自动补一个唯一值', () => {
  const rows = normalizeTrades([
    { id: 7, symbol: 'VGT', date: '2026-07-18', shares: 1, price: 100 },
    { id: 7, symbol: 'SMH', date: '2026-07-18', shares: 1, price: 100 },
    { symbol: 'IBIT', date: '2026-07-18', shares: 1, price: 100 },
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
  assert.equal(out.rows[0].symbol, 'IBIT', 'CSV 里写 BTC 的老导出 → 按别名记成 IBIT');
  assert.ok(Math.abs(out.rows[0].shares - 10 * 0.778456) < 1e-6, '股数按比例换算');
  assert.ok(Math.abs(out.rows[0].shares * out.rows[0].price - 10 * 28.38) < 1e-3, '成本不变');
  assert.equal(out.rows[1].symbol, 'VGT');
  assert.equal(out.rows[1].shares, -1, 'Sell 记负股数');
  assert.match(out.rows[0].time, /^\d{2}:\d{2}$/);
});

test('parseSchwabCSV：中文表头识别；缺表头时报错；与已有交易去重', () => {
  const cn = ['日期,方向,代码,数量,成交价', '2026/7/18,买入,BTC,10,28.38'].join('\n');
  const out = parseSchwabCSV(cn);
  assert.equal(out.imported, 1);
  assert.equal(out.rows[0].symbol, 'IBIT');
  assert.ok(Math.abs(out.rows[0].shares - 10 * 0.778456) < 1e-6);
  assert.throws(() => parseSchwabCSV('foo,bar\n1,2'), /未找到 Date、Symbol、Quantity、Price 列/);
  /* 去重：把"第一次导入的结果"当成已有交易，再导一遍同一份 CSV —— 一行都不该进来。
     （不能手写 shares/price：BTC → IBIT 会换算股数，手写的值对不上，测的就不是去重了） */
  const dup = parseSchwabCSV(cn, { existingTrades: out.rows });
  assert.equal(dup.imported, 0, '与已有交易重复时不重复导入');
  assert.equal(dup.skipped.dup, 1);
});

// v319：被跳过的行不再静默 —— 解析器给出分类统计，导入提示用 csvSkipSummary 说明原因
test('parseSchwabCSV：跳过原因分类统计（标的不支持 / 价格无效 / 重复）', () => {
  const csv = [
    'Date,Action,Symbol,Quantity,Price',
    '07/18/2026,Buy,BTC,10,"$28.38"',   // 正常
    '07/18/2026,Buy,SPY,1,"$500.00"',   // 不在白名单
    '07/18/2026,Buy,VGT,1,"$0.00"',     // 价格无效
    '07/18/2026,Buy,VGT,1,"$0"',        // 价格无效（零价）
    '07/18/2026,Buy,BTC,10,"$28.38"',   // 与第 1 行重复
  ].join('\n');
  const out = parseSchwabCSV(csv, { symbols: TRADE_SYMBOLS, existingTrades: [] });
  assert.equal(out.imported, 1);
  assert.deepEqual(out.skipped, { badDate: 0, symbol: 1, qty: 0, price: 2, dup: 1 });
  assert.equal(
    csvSkipSummary(out.skipped),
    '跳过 4 行：标的不在核心仓 1、价格无效 2、与已有记录重复 1',
  );
  assert.equal(csvSkipSummary({ badDate: 0, symbol: 0, qty: 0, price: 0, dup: 0 }), '', '没有跳过时不给文案');
  assert.equal(csvSkipSummary(null), '', '空输入安全返回');
});
