// 期权视图层单测（v325 建立 / v330 收敛）：
// 概率配色与文案、到期日历、行情时间解析。
// 这些 HTML 直接决定用户看到什么，错了不会报错、只会静静显示错东西，所以要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probColor, fmtProb, fmtIv,
  expiryCalendarHtml, noteHtml, renderProbUnavailable,
  parseMarketTime, fmtChainTime, fmtChainTimeShort,
} from '../src/app/prob-view.js';

/** CBOE 实际返回的时间戳格式：美东挂钟时间、不带时区标记。 */
const ET_CLOSE = '2026-10-07T15:59:58';

test('probColor：按 10% / 25% 分级（绿 → 橙 → 红）', () => {
  assert.equal(probColor(0.05), 'var(--accent)');
  assert.equal(probColor(0.10), 'var(--orange)', '10% 归橙');
  assert.equal(probColor(0.249), 'var(--orange)');
  assert.equal(probColor(0.25), 'var(--red)', '25% 归红');
  assert.equal(probColor(null), 'var(--muted)');
  assert.equal(probColor(NaN), 'var(--muted)');
});

test('fmtProb / fmtIv：缺值显示「—」而不是 NaN', () => {
  assert.equal(fmtProb(0.1473), '14.7%');
  assert.equal(fmtProb(null), '—');
  assert.equal(fmtProb(undefined), '—');
  assert.equal(fmtIv(0.213), '21.3%');
  assert.equal(fmtIv(0), '—');
  assert.equal(fmtIv(null), '—');
});

test('expiryCalendarHtml：空链给空态', () => {
  assert.match(expiryCalendarHtml([], { emptyHint: '加载中' }), /加载中/);
  assert.match(expiryCalendarHtml(null, {}), /prob-empty/);
});

test('expiryCalendarHtml：月度标「月度」、非月度标「周度」，并列出档位区间', () => {
  const html = expiryCalendarHtml([
    { sym: 'VGT', date: '2026-11-20', dte: 43, monthly: true, calls: 35, lo: 100, hi: 190 },
    { sym: 'SMH', date: '2026-10-09', dte: 1, monthly: false, calls: 75, lo: 530, hi: 760 },
  ], {});
  assert.match(html, /VGT/);
  assert.match(html, /2026-11-20/);
  assert.match(html, /is-monthly">月度/);
  assert.match(html, /2026-10-09/);
  assert.match(html, /36 档|35 档/);
  assert.match(html, /\$100~\$190/);
  assert.match(html, /周度/);
});

test('expiryCalendarHtml：自己有持仓的那一档高亮并显示张数', () => {
  const html = expiryCalendarHtml([
    { sym: 'VGT', date: '2026-11-20', dte: 43, monthly: true, calls: 35, lo: 100, hi: 190 },
    { sym: 'SMH', date: '2026-11-20', dte: 43, monthly: true, calls: 40, lo: 530, hi: 760 },
  ], { holdings: { 'VGT|2026-11-20': 2 } });
  assert.match(html, /class="cal-mine"/);
  assert.match(html, /2 张/);
  assert.equal((html.match(/cal-mine/g) || []).length, 1, '只有持有那一档高亮');
});

/* ---------------- 行情时间（v327：CBOE 给的是无时区标记的美东时间） ---------------- */

test('parseMarketTime：把美东挂钟时间还原成绝对时刻（夏令时/冬令时都要对）', () => {
  // 2026-07-15 处于 EDT（UTC-4）→ 美东 10:00 = UTC 14:00
  assert.equal(parseMarketTime('2026-07-15T10:00:00'), Date.UTC(2026, 6, 15, 14, 0, 0));
  // 2026-01-15 处于 EST（UTC-5）→ 美东 10:00 = UTC 15:00
  assert.equal(parseMarketTime('2026-01-15T10:00:00'), Date.UTC(2026, 0, 15, 15, 0, 0));
  // 实测真实值：CBOE 给 VGT 的 last_trade_time
  assert.equal(parseMarketTime(ET_CLOSE), Date.UTC(2026, 9, 7, 19, 59, 58));
  assert.equal(parseMarketTime('2026-10-07 15:59'), Date.UTC(2026, 9, 7, 19, 59, 0), '空格分隔也认');
  assert.equal(parseMarketTime('bad'), null);
  assert.equal(parseMarketTime(''), null);
  assert.equal(parseMarketTime(null), null);
});

test('fmtChainTime：隔天要写明「上一交易日收盘」，同一天只给时刻 + 相对时间', () => {
  const closeMs = parseMarketTime(ET_CLOSE);
  // 上海次日 14:39 ≈ 美东 10-08 02:39，距收盘约 10.65 小时
  const full = fmtChainTime(ET_CLOSE, closeMs + Math.round(10.65 * 3600 * 1000));
  assert.match(full, /^上一交易日收盘 · 美东 10\/07 15:59（11 小时前）$/);
  // 美东 10-07 17:00 看：同一天，不该说「上一交易日」
  assert.match(fmtChainTime(ET_CLOSE, closeMs + 61 * 60 * 1000), /^美东 15:59（1 小时前）$/);
  assert.equal(fmtChainTime('', Date.now()), '');
  assert.equal(fmtChainTime('bad', Date.now()), '');
});

test('fmtChainTimeShort：右上角的紧凑写法', () => {
  const closeMs = parseMarketTime(ET_CLOSE);
  assert.match(fmtChainTimeShort(ET_CLOSE, closeMs + 30 * 60 * 1000), /^美东 15:59 · 30 分钟前$/);
  assert.match(fmtChainTimeShort(ET_CLOSE, closeMs + 11 * 3600 * 1000), /^上一交易日收盘 · 11 小时前$/);
  assert.equal(fmtChainTimeShort('bad', Date.now()), '');
});

test('noteHtml：写清数据源、美东时间与官方 IV30，以及「不含除息日提前行权」这个口径', () => {
  const closeMs = parseMarketTime(ET_CLOSE);
  const html = noteHtml({
    source: 'cboe', updated: ET_CLOSE, nowMs: closeMs + 11 * 3600 * 1000,
    iv30: { VGT: 22.485, SMH: 41.2 },
  });
  assert.match(html, /CBOE 延迟报价/, '要写明这是延迟报价，不是实时');
  assert.match(html, /上一交易日收盘/);
  assert.match(html, /官方 30 天 IV：VGT 22\.5% · SMH 41\.2%/);
  assert.match(html, /N\(d2\)/);
  assert.match(html, /未含除息日提前行权/);
  assert.match(noteHtml({ source: 'yahoo' }), /反推/);
  assert.match(noteHtml({}), /N\(d2\)/, '没有数据源时也保留口径说明');
  assert.doesNotMatch(noteHtml({ source: 'cboe', iv30: { VGT: 0 } }), /官方 30 天 IV/, 'IV 无效时不显示');
});

test('renderProbUnavailable：写进 probNote，而不是已删除的 probPlan', () => {
  const made = {};
  const doc = { getElementById: (id) => (made[id] = { id: id, innerHTML: '' }) };
  renderProbUnavailable(doc, '数据源暂不可用（cboe: http 502）');
  assert.match(made.probNote.innerHTML, /期权链暂不可用/);
  assert.match(made.probNote.innerHTML, /cboe: http 502/, '要带上原因，别只说坏了');
  assert.ok(!made.probPlan, '不该再碰已经删掉的 probPlan');
});
