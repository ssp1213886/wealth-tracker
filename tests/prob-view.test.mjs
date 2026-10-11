// 期权视图层单测（v325 建立 / v330 收敛）：
// 概率配色与文案、到期日历、行情时间解析。
// 这些 HTML 直接决定用户看到什么，错了不会报错、只会静静显示错东西，所以要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probColor, fmtProb, fmtIv,
  expiryCalendarHtml, noteHtml, renderProbUnavailable,
  probMatrixHtml, probTabsHtml, matrixCellHtml,
  parseMarketTime, fmtChainTime, fmtChainTimeShort,
} from '../src/app/prob-view.js';

/** CBOE 实际返回的时间戳格式：美东挂钟时间、不带时区标记。 */
const ET_CLOSE = '2026-10-07T15:59:58';

test('probColor：按 10% / 25% 分级（绿 → 橙 → 红）', () => {
  assert.equal(probColor(0.05), 'var(--ok)', 'v385：低风险用固定语义绿，不再用随配色变的 --accent');
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
  // v355：剩余天数并进到期日格 —— 少一列，手机上四列刚好放得下
  assert.match(html, /data-cell="expiry">2026-11-20<small class="prob-sub">43 天<\/small><\/td>/);
  assert.doesNotMatch(html, /<th>剩余<\/th>|data-cell="dte"/, '不再有独立的「剩余」列');
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
  /* otmPct＝这一档相对**现价**的 OTM（主行显示的就是它）；drift＝相对你设的目标价的误差项（只进悬停） */
  return { pct: 7, target: 138.43, strike, drift: 0.011, otmPct: 0.05, prob, premium, annualPct, listed: prob != null };
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

test('probMatrixHtml：列头是可点的 OTM 按钮，当前列整列高亮；每行都给年化（v389 不再标该卖）', () => {
  const html = probMatrixHtml(MX, { otm: 7 });
  // v355：剩余天数并进到期日格（第二行小字），少一列 —— 手机上才不用横滑
  assert.match(html, /<thead><tr><th>到期日<\/th><th><button/);
  assert.match(html, /data-cell="expiry" title="月度到期日[^"]*">2026-11-20<small class="prob-sub">43 天<\/small><small class="prob-sub">年化 13\.2%<\/small><\/td>/, '到期日格里带剩余天数与年化（分两行，宽度不撑表）');
  assert.match(html, /class="mx-col is-on" data-probotm="7" title="把 OTM 设成 7%" aria-label="把 OTM 设成 7%">7%<\/button>/, '当前 OTM 那一列的列头按钮要高亮、可点、且有 aria-label');
  assert.equal((html.match(/mx-col/g) || []).length, 5, '五档 OTM 各自一个按钮');
  assert.equal((html.match(/is-on/g) || []).length, 1, '只有当前 OTM 那个列头按钮带 is-on');
  assert.equal((html.match(/mx-on/g) || []).length, 2, '每行当前 OTM 那一格带 mx-on');
  // 列头第二行＝这一档 OTM 对应的价格（现价 ×(1+OTM)），给"距离多少钱"一个参照
  assert.match(html, /7%<\/button><small class="mx-target">\$138\.43<\/small>/, '7% → 129.37×1.07 = $138.43');
  assert.match(html, /15%<\/button><small class="mx-target">\$148\.78<\/small>/);
  // v389：不再标该卖；行头给的是事实 —— 剩余天数 · 持有几张（若有）· 年化（按当前 OTM）
  assert.match(html, /<small class="prob-sub">年化 13\.2%<\/small>/, '行头要带年化（按当前 OTM 那一列算）');
  assert.doesNotMatch(html, /★|该卖/, 'v389：表里不再有该卖的字样');
  const held = probMatrixHtml(MX, { otm: 7, holdings: { '2026-12-18': 2 } });
  assert.match(held, /class="mx-held-row"/, '我持有的那一档用中性标记标出来');
  assert.match(held, /71 天 · <span class="mx-held-tag">持有 2 张<\/span><\/small><small class="prob-sub">年化 12\.1%<\/small>/, '持有张数只是事实，不是建议');
  /* 颜色必须挂在**子元素**上：手机端有一条 `.card small{color:var(--muted)!important}`，
     写在 <small class="prob-sub mx-held-tag"> 自身会被它压掉（v387 的橙色小字在手机上从没显过色）。 */
  assert.doesNotMatch(held, /<small class="prob-sub mx-held-tag"/, '持有标记不能直接挂在 small 上（手机端 !important 会吃掉颜色）');
  // 「本轮该处理」和「本轮该卖」本来就是同一轮（到期日当天卖下一档），拆两个标记是多读一层
  assert.doesNotMatch(html, /mx-settle/, '不该再有「本轮该处理」的标记');
  assert.doesNotMatch(html, /该处理/);
  assert.match(html, /36\.2%/);
  assert.match(html, /9\.6%/);
  assert.match(html, /var\(--red\)/, '>25% 用红');
  assert.match(html, /var\(--ok\)/, '<10% 用语义绿');
  assert.match(html, /真实挂牌行权价 \$152\.00/, '悬浮要写清这格实际挂在哪个挂牌行权价上');
  assert.match(html, /距现价 \+5\.0% · 你设的目标 7% = \$138\.43 · 年化/, '悬停里：完整的 OTM + 你设的目标价当参照');
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
  assert.match(matrixCellHtml(cell(0.037, 168, 0.5, 4.7)), /var\(--ok\)/, '<10% 用语义绿');
  const none = matrixCellHtml(cell(null, 0, null, null));
  assert.match(none, /class="mx-prob" style="color:var\(--muted\)">—<\/span>/);
  assert.match(none, /class="mx-prem">—<\/span>/);
  assert.equal((matrixCellHtml(null).match(/—/g) || []).length, 2, '空 cell 也要给两行，不能少渲染一行（会整行错位）');
  assert.match(matrixCellHtml(cell(0.2, 140, 0, 5)), /class="mx-prem">—<\/span>/, '有概率但没权利金时只这一行给「—」');
});

test('probMatrixHtml：相邻两列吸到同一张合约时照常各写一遍（不用「同上」这种简称）', () => {
  /* 实测 VGT 11-20 在 $135 与 $145 之间只挂了 $140 一档：7%/8%/10% 会全落到它。
     以前从第二列起写「同上」，但手机上没有 hover 可解释 —— 改成照常重复数字。 */
  const dup = {
    otms: [7, 8, 10],
    rows: [{ date: '2026-11-20', dte: 43, cells: [cell(0.146, 140, 1.05, 6.9), cell(0.146, 140, 1.05, 6.9), cell(0.146, 140, 1.05, 6.9)] }],
  };
  const html = probMatrixHtml(dup, { otm: 8 });
  assert.equal((html.match(/14\.6%/g) || []).length, 3, '三列都照常写数字');
  assert.equal((html.match(/mx-prem">\$1\.05/g) || []).length, 3);
  assert.doesNotMatch(html, /同上|mx-ditto|mx-same/, '不再有「同上」这种简称');
  assert.match(html, /真实挂牌行权价 \$140\.00/, '悬停里仍然写明实际挂在哪一档');
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
