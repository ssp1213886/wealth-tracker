// 期权视图层单测（v325 建立 / v330 收敛）：
// 概率配色与文案、到期日历、行情时间解析。
// 这些 HTML 直接决定用户看到什么，错了不会报错、只会静静显示错东西，所以要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probColor, fmtProb, fmtIv,
  expiryCalendarHtml, noteHtml, renderProbUnavailable,
  probMatrixHtml, probTabsHtml, probViewChipsHtml, matrixCellText, probSummaryHtml,
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

test('expiryCalendarHtml：一次只渲染一个标的的表；行权价列只给间距，不给挂牌个数', () => {
  const html = expiryCalendarHtml([
    { date: '2026-11-20', dte: 43, monthly: true, gapPct: 0.49 },
    { date: '2026-12-18', dte: 71, monthly: true, gapPct: 0.48 },
    { date: '2026-10-30', dte: 22, monthly: false, gapPct: 0.4 },
  ], { sym: 'VGT', fixed: '2026-11-20' });
  assert.equal((html.match(/<table/g) || []).length, 1, '一个标的一张表');
  assert.doesNotMatch(html, /<th>标的<\/th>/, '分页后不再需要标的列');
  assert.match(html, /<th>行权价间距<\/th>/);
  assert.match(html, /0\.49%/);
  assert.match(html, /0\.40%/, '间距保留两位');
  assert.doesNotMatch(html, /151 个|69 个/, '不再显示挂牌个数');
  assert.match(html, /is-monthly">月度/);
  assert.match(html, /<span class="cal-tag">周度<\/span>/);
  assert.match(html, /★ 按节奏该卖这档/);
  assert.match(expiryCalendarHtml([{ date: '2026-11-20', dte: 43, monthly: true, gapPct: 0 }], { sym: 'VGT' }), /—/, '算不出间距时给破折号');
});

test('expiryCalendarHtml：表内按剩余天数升序', () => {
  const html = expiryCalendarHtml([
    { date: '2026-12-18', dte: 71, monthly: true, gapPct: 0.48 },
    { date: '2026-10-30', dte: 22, monthly: false, gapPct: 0.4 },
  ], { sym: 'SMH' });
  assert.ok(html.indexOf('2026-10-30') < html.indexOf('2026-12-18'), '近的排前面');
});

test('expiryCalendarHtml：自己有持仓的那一档高亮并显示张数', () => {
  const html = expiryCalendarHtml([
    { date: '2026-11-20', dte: 43, monthly: true, gapPct: 0.49 },
    { date: '2026-12-18', dte: 71, monthly: true, gapPct: 0.48 },
  ], { sym: 'VGT', holdings: { 'VGT|2026-11-20': 2 } });
  assert.match(html, /class="cal-mine"/);
  assert.match(html, /2 张/);
  assert.equal((html.match(/cal-mine/g) || []).length, 1, '只有持有那一档高亮');
});

/** 造一格：prob=null 表示这一档没有挂牌行权价（阶梯够不到）。 */
function cell(prob, strike, premium, annualPct) {
  return { pct: 0, target: 0, strike, drift: 0, prob, premium, annualPct, listed: prob != null };
}

const MX_ROWS = [
  { date: '2026-11-20', dte: 43, settle: true, sell: false,
    cells: [cell(0.362, 138, 2.9, 27.4), cell(0.269, 145, 2.0, 18.9), cell(0.188, 152, 1.4, 13.2), cell(0.096, 160, 0.9, 8.5), cell(0.037, 168, 0.5, 4.7)] },
  { date: '2026-12-18', dte: 71, sell: true, settle: false,
    cells: [cell(0.398, 138, 4.6, 17.9), cell(0.324, 145, 3.4, 15.3), cell(0.256, 152, 2.9, 12.1), cell(0.180, 160, 1.9, 9.4), cell(null, 0, null, null)] },
];
const MX = { otms: [3, 5, 7, 10, 15], rows: MX_ROWS };

test('probMatrixHtml：列头是可点的 OTM 按钮，当前列整列高亮，★该卖/该处理两档分别打标', () => {
  const html = probMatrixHtml(MX, { otm: 7 });
  assert.match(html, /<th>到期日<\/th><th>剩余<\/th>/);
  assert.match(html, /class="mx-col is-on" data-probotm="7" title="把 OTM 设成 7%">7%<\/button>/, '当前 OTM 那一列的列头按钮要高亮，且点它就能设 OTM');
  assert.equal((html.match(/mx-col/g) || []).length, 5, '五档 OTM 各自一个按钮');
  assert.equal((html.match(/is-on/g) || []).length, 1, '只有当前 OTM 那个列头按钮带 is-on');
  assert.equal((html.match(/mx-on/g) || []).length, 2, '每行当前 OTM 那一格带 mx-on');
  assert.match(html, /class="mx-sell-row"/, '本轮该卖的整行要高亮');
  assert.match(html, /mx-sell-tag">★ 本轮该卖</);
  assert.match(html, /class="mx-settle-row"/, '本轮该处理的那行也要能看出来');
  assert.match(html, /mx-settle-tag">本轮该处理</);
  assert.match(html, /36\.2%/);
  assert.match(html, /9\.6%/);
  assert.match(html, /var\(--red\)/, '>25% 用红');
  assert.match(html, /var\(--accent\)/, '<10% 用绿');
  assert.match(html, /真实挂牌行权价 \$152\.00/, '悬浮要写清这格实际挂在哪个挂牌行权价上');
  assert.doesNotMatch(html, /mx-fixed/, 'v339 起改用 mx-sell-row / mx-settle-row');
  assert.doesNotMatch(html, /prob-table/, '矩阵不能用 prob-table（那套手机端规则会把 td 变 grid）');
});

test('probMatrixHtml：权利金 / 年化视角不按概率着色，缺挂牌那格一律「—」', () => {
  const prem = probMatrixHtml(MX, { otm: 7, view: 'premium' });
  assert.match(prem, /\$2\.90/);
  assert.match(prem, /\$4\.60/);
  assert.doesNotMatch(prem, /var\(--red\)/, '看权利金时不该出现「高权利金=红」的误导');
  assert.doesNotMatch(prem, /var\(--accent\)/);
  assert.match(prem, /—/, '缺挂牌那一格显示破折号');
  const ann = probMatrixHtml(MX, { otm: 7, view: 'annual' });
  assert.match(ann, /27\.4%/);
  assert.match(ann, /17\.9%/);
  assert.doesNotMatch(ann, /var\(--red\)/);
});

test('probMatrixHtml：空矩阵给空态；缺 cells 不抛错', () => {
  assert.match(probMatrixHtml(null, {}), /prob-empty/);
  assert.match(probMatrixHtml({ otms: [], rows: [] }, { emptyHint: '没有 14 天以上的档' }), /没有 14 天以上的档/);
  assert.match(probMatrixHtml({ otms: [5], rows: [{ date: 'x', dte: 30, cells: null }] }, {}), /—|prob-empty/);
});

test('matrixCellText：三个视角各取各的值，缺挂牌一律「—」', () => {
  const c = cell(0.1473, 140, 1.05, 8.91);
  assert.equal(matrixCellText(c, 'prob'), '14.7%');
  assert.equal(matrixCellText(c, 'premium'), '$1.05');
  assert.equal(matrixCellText(c, 'annual'), '8.9%');
  assert.equal(matrixCellText(c, undefined), '14.7%', '不给视角默认看概率');
  assert.equal(matrixCellText(cell(null, 0, null, null), 'premium'), '—');
  assert.equal(matrixCellText(null, 'prob'), '—');
});

test('probViewChipsHtml：概率 / 权利金 / 年化三视角，只有当前那个 is-on', () => {
  const html = probViewChipsHtml('premium');
  assert.match(html, /data-probview="prob">概率</);
  assert.match(html, /data-probview="annual">年化</);
  assert.match(html, /class="prob-chip is-on" data-probview="premium">权利金</);
  assert.equal((html.match(/is-on/g) || []).length, 1);
  assert.match(probViewChipsHtml('prob'), /class="prob-chip is-on" data-probview="prob">概率</);
});

test('probSummaryHtml：取 ★该卖 那一行 ∩ 当前 OTM 那一列，一句话给全 行权价/概率/权利金/年化', () => {
  const html = probSummaryHtml(MX, { otm: 7 });
  assert.match(html, /本轮该卖 <b>2026-12-18<\/b> · 还有 71 天/);
  assert.match(html, /（2026-11-20 卖出 · 持有 28 天）/, '要写清「到期日当天卖下一档」——到期日是 12-18，但这一轮 11-20 就卖出、只持有 28 天');
  assert.match(html, /\$152\.00/);
  assert.match(html, /25\.6%/, '被行权概率');
  assert.match(html, /约 4 轮 1 次/, '1/0.256 ≈ 4 轮');
  assert.match(html, /\$2\.90/, '权利金');
  assert.match(html, /12\.1%/, '年化');
});

test('probSummaryHtml：没有「本轮该处理」那一档时，省略持有天数而不是编一个', () => {
  const noSettle = { otms: [3, 5, 7, 10, 15], rows: [{ date: '2026-12-18', dte: 71, sell: true, cells: [cell(0.3, 138, 2, 9), cell(0.2, 145, 1.5, 7), cell(0.19, 152, 1.2, 6), cell(0.1, 160, 0.8, 4), cell(0.05, 168, 0.4, 2)] }] };
  const html = probSummaryHtml(noSettle, { otm: 7 });
  assert.match(html, /本轮该卖 <b>2026-12-18<\/b> · 还有 71 天/);
  assert.doesNotMatch(html, /持有 \d+ 天/, '算不出卖出日就别写');
});

test('probSummaryHtml：没有 ★ 档 / 该 OTM 那格没挂牌时给明确提示，不显示半截数字', () => {
  assert.match(probSummaryHtml(null, { otm: 7 }), /还没有可卖的到期档/);
  assert.match(probSummaryHtml({ otms: [3, 5, 7, 10, 15], rows: [{ date: 'x', dte: 30, sell: true, cells: [] }] }, { otm: 7 }), /没有挂牌行权价/);
  const miss = { otms: [3, 5, 7, 10, 15], rows: [{ date: '2026-12-18', dte: 71, sell: true, cells: [cell(0.3, 138, 2, 9), cell(0.2, 145, 1.5, 7), cell(null, 0, null, null), cell(null, 0, null, null), cell(null, 0, null, null)] }] };
  const html = probSummaryHtml(miss, { otm: 7 });
  assert.match(html, /没有挂牌行权价/);
  assert.doesNotMatch(html, /\$0\.00/);
});

test('probTabsHtml：VGT / SMH 分段，只有当前那个 is-on', () => {
  const html = probTabsHtml('SMH');
  assert.match(html, /data-probtab="VGT"/);
  assert.match(html, /class="prob-chip is-on" data-probtab="SMH"/);
  assert.equal((html.match(/is-on/g) || []).length, 1);
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

test('noteHtml：只写数据源 / 美东时间 / 官方 IV30（口径说明已挪到「到期日历」卡）', () => {
  const closeMs = parseMarketTime(ET_CLOSE);
  const html = noteHtml({
    source: 'cboe', updated: ET_CLOSE, nowMs: closeMs + 11 * 3600 * 1000,
    iv30: { VGT: 22.485, SMH: 41.2 },
  });
  assert.match(html, /CBOE 延迟报价/, '要写明这是延迟报价，不是实时');
  assert.match(html, /上一交易日收盘/);
  assert.match(html, /官方 30 天 IV：VGT 22\.5% · SMH 41\.2%/);
  assert.doesNotMatch(html, /N\(d2\)/, 'v331 起这句只在「到期日历」卡说一次，不在这里重复');
  assert.match(noteHtml({ source: 'yahoo' }), /反推/);
  assert.equal(noteHtml({}), '', '没有数据源时整行留空');
  assert.doesNotMatch(noteHtml({ source: 'cboe', iv30: { VGT: 0 } }), /官方 30 天 IV/, 'IV 无效时不显示');
});

test('renderProbUnavailable：写进矩阵容器（v336 起概率卡只有 probMatrix 一个内容区）', () => {
  const made = {};
  const doc = { getElementById: (id) => (made[id] = { id: id, innerHTML: '' }) };
  renderProbUnavailable(doc, '数据源暂不可用（cboe: http 502）');
  assert.match(made.probMatrix.innerHTML, /期权链暂不可用/);
  assert.match(made.probMatrix.innerHTML, /cboe: http 502/, '要带上原因，别只说坏了');
  assert.ok(!made.probPlan, '不该再碰已经删掉的 probPlan');
});
