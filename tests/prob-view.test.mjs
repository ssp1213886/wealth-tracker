// 期权视图层单测（v325 建立 / v330 收敛）：
// 概率配色与文案、到期日历、行情时间解析。
// 这些 HTML 直接决定用户看到什么，错了不会报错、只会静静显示错东西，所以要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probColor, fmtProb, fmtIv,
  expiryCalendarHtml, noteHtml, renderProbUnavailable,
  probMatrixHtml, probTabsHtml, matrixCellHtml, probSummaryHtml,
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
  ], { sym: 'VGT' });
  assert.equal((html.match(/<table/g) || []).length, 1, '一个标的一张表');
  assert.doesNotMatch(html, /<th>标的<\/th>/, '分页后不再需要标的列');
  assert.match(html, /<th>行权价间距<\/th>/);
  assert.match(html, /0\.49%/);
  assert.match(html, /0\.40%/, '间距保留两位');
  assert.doesNotMatch(html, /151 个|69 个/, '不再显示挂牌个数');
  assert.match(html, /is-monthly">月度/);
  assert.match(html, /<span class="cal-tag">周度<\/span>/);
  // v352：节奏 ★ 只留在「被行权概率」卡 —— 两张卡各标一次只会让人分不清该看哪张
  assert.doesNotMatch(html, /按节奏该卖|cal-onbeat/, '到期日历不再标 ★ 节奏档');
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

/* 表里只有 ★ 一个标记（「本轮该处理」已去掉）；卖出日由 ctx.sellFrom 传进来。 */
const MX_ROWS = [
  { date: '2026-11-20', dte: 43, sell: false, monthly: true, gapPct: 3.87,
    cells: [cell(0.362, 138, 2.9, 27.4), cell(0.269, 145, 2.0, 18.9), cell(0.188, 152, 1.4, 13.2), cell(0.096, 160, 0.9, 8.5), cell(0.037, 168, 0.5, 4.7)] },
  { date: '2026-12-18', dte: 71, sell: true, monthly: true, gapPct: 3.87,
    cells: [cell(0.398, 138, 4.6, 17.9), cell(0.324, 145, 3.4, 15.3), cell(0.256, 152, 2.9, 12.1), cell(0.180, 160, 1.9, 9.4), cell(null, 0, null, null)] },
];
/* ★ 与主行＝该卖的那一档（12-18）；卖出日＝本期到期日 11-20（到期日当天卖下一档）。 */
const MX_CTX = { otm: 7, ruleLabel: '每月第三个周五', from: '2026-11-20', periodDate: '2026-11-20', daysToSale: 8, tenor: 28 };
const MX = { otms: [3, 5, 7, 10, 15], rows: MX_ROWS, spot: 129.37 };

test('probMatrixHtml：列头是可点的 OTM 按钮，当前列整列高亮，只有 ★该卖 一个标记', () => {
  const html = probMatrixHtml(MX, { otm: 7 });
  assert.match(html, /<th>到期日<\/th><th>剩余<\/th>/);
  assert.match(html, /class="mx-col is-on" data-probotm="7" title="把 OTM 设成 7%">7%<\/button>/, '当前 OTM 那一列的列头按钮要高亮，且点它就能设 OTM');
  assert.equal((html.match(/mx-col/g) || []).length, 5, '五档 OTM 各自一个按钮');
  assert.equal((html.match(/is-on/g) || []).length, 1, '只有当前 OTM 那个列头按钮带 is-on');
  assert.equal((html.match(/mx-on/g) || []).length, 2, '每行当前 OTM 那一格带 mx-on');
  // 列头第二行＝这一档 OTM 对应的价格（现价 ×(1+OTM)），给"距离多少钱"一个参照
  assert.match(html, /7%<\/button><small class="mx-target">\$138\.43<\/small>/, '7% → 129.37×1.07 = $138.43');
  assert.match(html, /15%<\/button><small class="mx-target">\$148\.78<\/small>/);
  assert.match(html, /class="mx-sell-row"/, '本轮该卖的整行要高亮');
  assert.match(html, /mx-sell-tag" title="[^"]*">★ 该卖</, '★ 标的是该卖那一档，悬停给解释（底部说明已删，口径挪到悬停里）');
  // 「本轮该处理」和「本轮该卖」本来就是同一轮（到期日当天卖下一档），拆两个标记是多读一层
  assert.doesNotMatch(html, /mx-settle/, '不该再有「本轮该处理」的标记');
  assert.doesNotMatch(html, /该处理/);
  assert.match(html, /36\.2%/);
  assert.match(html, /9\.6%/);
  assert.match(html, /var\(--red\)/, '>25% 用红');
  assert.match(html, /var\(--accent\)/, '<10% 用绿');
  assert.match(html, /真实挂牌行权价 \$152\.00/, '悬浮要写清这格实际挂在哪个挂牌行权价上');
  assert.doesNotMatch(html, /mx-fixed/, 'v339 起改用 mx-sell-row');
  assert.doesNotMatch(html, /prob-table/, '矩阵不能用 prob-table（那套手机端规则会把 td 变 grid）');
});

test('probMatrixHtml：每格同时给概率与权利金（不用切视角），年化只在悬停提示里', () => {
  const html = probMatrixHtml(MX, { otm: 7 });
  assert.match(html, /class="mx-prem">\$2\.90</, '下行是权利金');
  assert.match(html, /class="mx-prem">\$4\.60</);
  assert.doesNotMatch(html, /data-probview/, '视角切换已删 —— 两个数同格显示，不需要它');
  assert.match(html, /年化 27\.4%/, '年化挪进悬停提示，不占格位');
  assert.match(html, /class="mx-prem">—</, '缺挂牌那一格下行显示破折号');
});

test('probMatrixHtml：空矩阵给空态；缺 cells 不抛错', () => {
  assert.match(probMatrixHtml(null, {}), /prob-empty/);
  assert.match(probMatrixHtml({ otms: [], rows: [] }, { emptyHint: '没有 14 天以上的档' }), /没有 14 天以上的档/);
  assert.match(probMatrixHtml({ otms: [5], rows: [{ date: 'x', dte: 30, cells: null }] }, {}), /—|prob-empty/);
  assert.doesNotMatch(probMatrixHtml({ otms: [7], rows: MX_ROWS.slice(0, 1) }, {}), /mx-target/, '没有现价就不算目标价，别编一个');
});

test('probMatrixHtml：行头悬停写清「月度/周度 + 行权价间距」——日历卡的两条信息搬到了用得到的地方', () => {
  const html = probMatrixHtml(MX, { otm: 7 });
  assert.match(html, /data-cell="expiry" title="月度到期日（第三个周五） · 相邻行权价间距 3\.87%"/);
  const weekly = probMatrixHtml({ otms: [7], spot: 625, rows: [
    { date: '2026-11-13', dte: 36, monthly: false, gapPct: 0, cells: [cell(0.2, 660, 5, 10)] }] }, { otm: 7 });
  assert.match(weekly, /title="周度到期日"/, '没有间距数据时不硬写数字');
  assert.doesNotMatch(weekly, /0\.00%/);
});

test('matrixCellHtml：上行概率（按风险着色）+ 下行权利金，缺挂牌两行都给「—」', () => {
  const hot = matrixCellHtml(cell(0.362, 138, 2.9, 27.4));
  assert.match(hot, /class="mx-prob" style="color:var\(--red\)">36\.2%<\/span>/, '>25% 用红');
  assert.match(hot, /class="mx-prem">\$2\.90<\/span>/);
  assert.match(matrixCellHtml(cell(0.037, 168, 0.5, 4.7)), /var\(--accent\)/, '<10% 用绿');
  const none = matrixCellHtml(cell(null, 0, null, null));
  assert.match(none, /class="mx-prob" style="color:var\(--muted\)">—<\/span>/);
  assert.match(none, /class="mx-prem">—<\/span>/);
  assert.equal((matrixCellHtml(null).match(/—/g) || []).length, 2, '空 cell 也要给两行，不能少渲染一行（会整行错位）');
  assert.match(matrixCellHtml(cell(0.2, 140, 0, 5)), /class="mx-prem">—<\/span>/, '有概率但没权利金时只这一行给「—」');
});

test('probMatrixHtml：相邻两列吸到同一张合约时显示「同上」，不再重复同一组数字', () => {
  /* 实测 VGT 11-20 在 $135 与 $145 之间只挂了 $140 一档：7%/8%/10% 会全落到它。
     重复报三遍会被读成"卡住了"，所以第二列起显示「同上」。 */
  const dup = {
    otms: [7, 8, 10],
    rows: [{ date: '2026-11-20', dte: 43, cells: [cell(0.146, 140, 1.05, 6.9), cell(0.146, 140, 1.05, 6.9), cell(0.146, 140, 1.05, 6.9)] }],
  };
  const html = probMatrixHtml(dup, { otm: 8 });
  assert.equal((html.match(/14\.6%/g) || []).length, 1, '同一组数字只报一次');
  assert.equal((html.match(/mx-ditto/g) || []).length, 2, '后两列都是「同上」');
  assert.equal((html.match(/同上 \$140\.00/g) || []).length, 2, '「同上」要写明是哪张合约');
  assert.match(html, /和左边那一列是同一张合约/, '悬停要解释清楚');
  // 同一行里换了一张合约就不该再叫「同上」
  const mixed = {
    otms: [7, 10],
    rows: [{ date: '2026-11-20', dte: 43, cells: [cell(0.146, 140, 1.05, 6.9), cell(0.034, 150, 0.2, 1.3)] }],
  };
  assert.doesNotMatch(probMatrixHtml(mixed, { otm: 7 }), /mx-ditto/);
});

test('probSummaryHtml：主行直接给「该卖哪个到期日 / 哪天卖出 / 还有几天 / 持有多久」', () => {
  const html = probSummaryHtml(MX, MX_CTX);
  assert.match(html, /该卖 <b>2026-12-18<\/b> 到期 · 2026-11-20 卖出（还有 8 天） · 持有 28 天/, '第一行就得是"卖哪一个、哪天卖"的答案');
  assert.match(html, /mx-badge is-todo">未卖</, '状态徽章挂在「该卖」那一档上：没记这张 CALL 就是未卖');
  assert.match(html, /\$152\.00/);
  assert.match(html, /25\.6%/, '被行权概率');
  assert.match(html, /\$2\.90/, '权利金');
  assert.match(html, /12\.1%/, '年化');
  assert.match(html, /每月第三个周五/, '节奏名要能看出来（VGT 按月 / SMH 每3周）');
  assert.doesNotMatch(html, /轮 1 次/, '「约 N 轮 1 次」已按用户要求去掉');
});

test('probSummaryHtml：该卖那一档已卖出 → 徽章变「已卖 ✓」，主行仍是该卖那一档', () => {
  const html = probSummaryHtml(MX, { otm: 7, ruleLabel: '每 3 周的周五',
    sold: { sym: 'SMH', type: 'CALL', strike: 665, contracts: 2, premium: 13.45, added: '2026-10-30' },
    from: '2026-11-20', periodDate: '2026-11-20', daysToSale: 8, tenor: 21 });
  assert.match(html, /mx-badge is-done">已卖 ✓</);
  assert.match(html, /每 3 周的周五/, 'SMH 的节奏也要能看出来');
  assert.match(html, /该卖 <b>2026-12-18<\/b> 到期/, '主行讲的始终是"接下来该卖哪一档"');
});

test('probSummaryHtml：今天就是卖出日 → 「还有 N 天」换成「今天」，徽章换成「今天该卖」', () => {
  const html = probSummaryHtml(MX, { otm: 7, due: true, ruleLabel: '每月第三个周五', from: '2026-11-20', periodDate: '2026-11-20' });
  assert.match(html, /该卖 <b>2026-12-18<\/b> 到期 · 2026-11-20 卖出（今天）/, '当天就别再写"还有 N 天"');
  assert.match(html, /mx-badge is-due">今天该卖</);
});

test('probSummaryHtml：拿不到卖出日 / 持有天数时就不写那两段（不编数字）', () => {
  const html = probSummaryHtml(MX, { otm: 7 });
  assert.match(html, /^<div class="mx-sum"><div class="mx-sum-head">该卖 <b>2026-12-18<\/b> 到期 /);
  assert.doesNotMatch(html, /卖出（/);
  assert.doesNotMatch(html, /持有 \d+ 天/);
});

test('probSummaryHtml：节奏日没挂牌、已顺延到真实挂牌档时要说出来', () => {
  const html = probSummaryHtml(MX, { ...MX_CTX, shiftNote: '节奏日 2026-11-20 未挂牌' });
  assert.match(html, /该卖 <b>2026-12-18<\/b> 到期 <span class="mx-shift">节奏日 2026-11-20 未挂牌<\/span>/);
  assert.doesNotMatch(probSummaryHtml(MX, MX_CTX), /mx-shift/, '正常情况不该出现顺延提示');
});

test('probSummaryHtml：当前 OTM 那一档没挂牌时，退到最近可卖的那一档（别变死胡同）', () => {
  /* 复刻实测：VGT 本期 10-16 上方只挂到 $135，5%/6% 够不到，最近的 7% 有数。 */
  const row = { date: '2026-10-16', dte: 8, sell: true, cells: [
    cell(null, 0, null, null), cell(null, 0, null, null), cell(0.146, 140, 1.05, 6.9),
    cell(null, 0, null, null), cell(null, 0, null, null)] };
  const m = { otms: [5, 6, 7, 8, 10], rows: [row], spot: 129.37 };
  const html = probSummaryHtml(m, { otm: 5, ruleLabel: '每月第三个周五' });
  assert.match(html, /5% 在这一档没挂牌档位/, '当前档没挂牌要说清楚');
  assert.match(html, /最近可卖 7% = \$140\.00/, '要给出最近能卖的那一档，而不是只说"换一档"');
  const dead = probSummaryHtml({ otms: [5], rows: [{ date: '2026-10-16', dte: 8, sell: true, cells: [cell(null, 0, null, null)] }] }, { otm: 5 });
  assert.match(dead, /换一档 OTM/, '整行都没挂牌时才退回"换一档"');
  assert.doesNotMatch(dead, /最近可卖/);
});

test('probSummaryHtml：没有 ★ 档 / 该 OTM 那格没挂牌时给明确提示，不显示半截数字', () => {
  assert.match(probSummaryHtml(null, { otm: 7 }), /还没有可卖的到期档/);
  assert.match(probSummaryHtml({ otms: [3, 5, 7, 10, 15], rows: [{ date: 'x', dte: 30, sell: true, cells: [] }] }, { otm: 7 }), /没挂牌档位|没有挂牌/);
  const miss = { otms: [3, 5, 7, 10, 15], rows: [{ date: '2026-12-18', dte: 71, sell: true, cells: [cell(0.3, 138, 2, 9), cell(0.2, 145, 1.5, 7), cell(null, 0, null, null), cell(null, 0, null, null), cell(null, 0, null, null)] }] };
  const html = probSummaryHtml(miss, { otm: 7 });
  assert.match(html, /没挂牌档位/);
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
