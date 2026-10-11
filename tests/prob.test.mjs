// 被行权概率的纯计算单测（v325）：正态分布、P(ITM)=N(d2)、反推 IV、按目标概率反解行权价、
// 链上的波动率插值，以及"行权价参考"联动的取值。
// 这块直接决定"该卖多远的 CALL"，数字错了会误导真实下单，所以边界值都要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normCdf, normInv, bsCall, bsCallDelta, probITM, impliedVol,
  contractMid, sortedCalls, nearestCall, ivAtStrike, resolveIv, pickExpiry,
  annualizedPremiumPct, optionProbabilities, probMatrix, matrixCellAt,
  ladderOf, nearestLadderIdx, matrixWindow, MATRIX_COLS, LADDER_MAX_OTM,
} from '../src/app/prob.js';

/** 实测自 CBOE 延迟报价（2026-10-07 收盘）：VGT 现价 129.37、SMH 现价 625.03。 */
const VGT_CHAIN = {
  sym: 'VGT', spot: 129.37, source: 'cboe', updated: '10/07/2026 15:59:58',
  expiries: [
    { date: '2026-10-16', ts: 1, dte: 8, calls: [
      { k: 130, b: 1.6, a: 2.2, lp: 1.9, iv: 0.208, oi: 900, v: 5, d: 0.42 },
      { k: 135, b: 0.15, a: 0.55, lp: 0.35, iv: 0.226, oi: 300, v: 3, d: 0.08 },
    ] },
    { date: '2026-11-20', ts: 2, dte: 43, calls: [
      { k: 130, b: 4.9, a: 5.3, lp: 5.1, iv: 0.211, oi: 500, v: 10, d: 0.50 },
      { k: 135, b: 2.5, a: 2.9, lp: 2.7, iv: 0.212, oi: 400, v: 12, d: 0.34 },
      { k: 140, b: 0.70, a: 1.40, lp: 0.90, iv: 0.213, oi: 1935, v: 29, d: 0.176 },
      { k: 145, b: 0.35, a: 0.95, lp: 0.60, iv: 0.228, oi: 800, v: 15, d: 0.11 },
    ] },
    { date: '2026-12-18', ts: 3, dte: 71, calls: [
      { k: 140, b: 2.1, a: 2.9, lp: 2.5, iv: 0.219, oi: 700, v: 4, d: 0.26 },
      { k: 145, b: 1.3, a: 1.9, lp: 1.6, iv: 0.224, oi: 500, v: 2, d: 0.20 },
    ] },
  ],
};

// ---------- 正态分布 ----------

test('normCdf：与标准值一致（0 / ±1.96 / -1.0204）', () => {
  // 这是 A&S 7.1.26 的近似式（绝对误差 ~1.5e-7），所以用容差而不是严格相等
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normCdf(1.96) - 0.975002) < 1e-5);
  assert.ok(Math.abs(normCdf(-1.96) - 0.024998) < 1e-5);
  assert.ok(Math.abs(normCdf(-1.0204) - 0.153769) < 1e-5);
  assert.equal(normCdf(NaN), 0, '非有限数退化成 0，不抛错');
});

test('normInv：与标准值一致，且与 normCdf 往返自洽', () => {
  assert.ok(Math.abs(normInv(0.975) - 1.959964) < 1e-4);
  assert.ok(Math.abs(normInv(0.15) + 1.036433) < 1e-4);
  [0.001, 0.02, 0.07, 0.15, 0.5, 0.9, 0.999].forEach((p) => {
    assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-6, 'p=' + p + ' 往返失败');
  });
  assert.ok(Number.isNaN(normInv(0)), 'p=0 无定义');
  assert.ok(Number.isNaN(normInv(1)), 'p=1 无定义');
  assert.ok(Number.isNaN(normInv(-0.1)));
});

// ---------- 被行权概率 ----------

test('probITM：对照 CBOE 实测 IV —— VGT +7% OTM ≈ 14.6%、SMH +5% OTM ≈ 30.5%', () => {
  const vgt = probITM({ spot: 129.37, strike: 140, iv: 0.213, dte: 43 });
  const smh = probITM({ spot: 625.03, strike: 660, iv: 0.319, dte: 43 });
  assert.ok(Math.abs(vgt - 0.1463) < 0.002, 'VGT 实际 ' + vgt);
  assert.ok(Math.abs(smh - 0.3054) < 0.002, 'SMH 实际 ' + smh);
});

test('probITM：行权价越远概率越低；波动率越高概率越高', () => {
  const near = probITM({ spot: 100, strike: 105, iv: 0.25, dte: 30 });
  const far = probITM({ spot: 100, strike: 120, iv: 0.25, dte: 30 });
  assert.ok(near > far);
  const calm = probITM({ spot: 100, strike: 110, iv: 0.15, dte: 30 });
  const wild = probITM({ spot: 100, strike: 110, iv: 0.50, dte: 30 });
  assert.ok(wild > calm);
});

test('probITM：边界 —— 到期日当天退化成确定事件；缺 IV 返回 null 而不是编数', () => {
  assert.equal(probITM({ spot: 140, strike: 140, iv: 0.2, dte: 0 }), 0, '到期日平值不算实值');
  assert.equal(probITM({ spot: 141, strike: 140, iv: 0.2, dte: 0 }), 1);
  assert.equal(probITM({ spot: 139, strike: 140, iv: 0.2, dte: 0 }), 0);
  assert.equal(probITM({ spot: 100, strike: 110, iv: 0, dte: 30 }), null, '缺 IV 不能猜');
  assert.equal(probITM({ spot: 0, strike: 110, iv: 0.2, dte: 30 }), null);
  assert.equal(probITM({ spot: 100, strike: 0, iv: 0.2, dte: 30 }), null);
});

// ---------- 反推 IV ----------

test('impliedVol：与 bsCall 精确往返', () => {
  [0.12, 0.213, 0.319, 0.60].forEach((iv) => {
    const price = bsCall(129.37, 140, 43 / 365, 0.04, iv);
    const back = impliedVol({ price: price, spot: 129.37, strike: 140, dte: 43 });
    assert.ok(Math.abs(back - iv) < 1e-5, 'iv=' + iv + ' 反推得 ' + back);
  });
});

test('impliedVol：实值且价格不高于内在价值时返回 null（不硬凑一个 IV）', () => {
  // 注意：虚值 call 对任意正价格都有解（vol→0 时理论价→0），所以"无解"只出现在实值档
  const intrinsic = 129.37 - 120 * Math.exp(-0.04 * (43 / 365));
  assert.ok(intrinsic > 9, '先确认这是实值档，内在价值 ' + intrinsic);
  assert.equal(impliedVol({ price: intrinsic, spot: 129.37, strike: 120, dte: 43 }), null, '时间价值为 0 → 无解');
  assert.equal(impliedVol({ price: intrinsic - 0.5, spot: 129.37, strike: 120, dte: 43 }), null, '低于内在价值 → 无解');
  assert.equal(impliedVol({ price: 0, spot: 129.37, strike: 120, dte: 43 }), null);
  assert.equal(impliedVol({ price: 5, spot: 129.37, strike: 120, dte: 0 }), null, '已到期 → 无解');
});

// ---------- 反解行权价 ----------

// ---------- 链辅助 ----------

test('contractMid：优先买卖价中值，缺失时退回最新成交价/买价', () => {
  assert.ok(Math.abs(contractMid({ b: 0.70, a: 1.40, lp: 0.90 }) - 1.05) < 1e-9);
  assert.equal(contractMid({ b: 0, a: 0, lp: 0.90 }), 0.90);
  assert.equal(contractMid({ b: 0, a: 0, lp: 0 }), 0);
  assert.equal(contractMid({ b: 0.70, a: 0, lp: 0 }), 0.70);
  assert.equal(contractMid(null), 0);
});

test('ivAtStrike：两档之间线性插值，两端各自夹住', () => {
  const exp = VGT_CHAIN.expiries[1];
  assert.equal(ivAtStrike(exp, 140), 0.213, '正好落在挂牌档');
  assert.ok(Math.abs(ivAtStrike(exp, 142.5) - 0.2205) < 1e-9, '中间档插值');
  assert.equal(ivAtStrike(exp, 100), 0.211, '低于最低档 → 取下沿');
  assert.equal(ivAtStrike(exp, 999), 0.228, '高于最高档 → 取上沿');
  assert.equal(ivAtStrike({ dte: 30, calls: [{ k: 100, iv: 0 }] }, 100), null, '全 0 IV 视为没有');
});

test('resolveIv：链里没有 IV 时用成交价反推（Yahoo 兜底路径）', () => {
  const spot = 129.37;
  const dte = 43;
  const price = bsCall(spot, 140, dte / 365, 0.04, 0.25);
  const exp = { dte, calls: [{ k: 140, b: 0, a: 0, lp: price, iv: 0 }] };
  const iv = resolveIv(exp, spot, dte, 140, 0.04);
  assert.ok(Math.abs(iv - 0.25) < 1e-4, '实际 ' + iv);
});

test('pickExpiry：挑最接近目标天数的一个，并列取更早', () => {
  const exps = [{ date: 'a', dte: 15 }, { date: 'b', dte: 43 }, { date: 'c', dte: 71 }];
  assert.equal(pickExpiry(exps, 30).date, 'b', '|43-30|=13 比 |15-30|=15 近');
  assert.equal(pickExpiry(exps, 45).date, 'b');
  assert.equal(pickExpiry(exps, 200).date, 'c');
  assert.equal(pickExpiry(exps, 0).date, 'a', '目标非法时退到第一个');
  assert.equal(pickExpiry([], 30), null);
  assert.equal(pickExpiry([{ date: 'x', dte: 0 }], 30), null, '已到期的不要');
});

test('annualizedPremiumPct：单轮权利金折算年化', () => {
  assert.ok(Math.abs(annualizedPremiumPct(0.70, 129.37, 43) - 4.59) < 0.02);
  assert.ok(Math.abs(annualizedPremiumPct(14.60, 625.03, 43) - 19.83) < 0.02);
  assert.equal(annualizedPremiumPct(0, 100, 30), null);
  assert.equal(annualizedPremiumPct(1, 100, 0), null);
});

test('sortedCalls / nearestCall：排序与吸附', () => {
  const exp = { calls: [{ k: 145 }, { k: 130 }, { k: 140 }] };
  assert.deepEqual(sortedCalls(exp).map((c) => c.k), [130, 140, 145]);
  assert.equal(nearestCall(sortedCalls(exp), 138.4).k, 140, '138.4 离 140 更近');
  assert.equal(nearestCall(sortedCalls(exp), 131).k, 130, '131 离 130 更近');
  assert.equal(nearestCall(sortedCalls(exp), 130).k, 130);
  assert.equal(nearestCall([], 130), null);
});

// ---------- 目标概率反解（板块主功能）----------

// ---------- 「行权价参考」联动 ----------

// ---------- 概率矩阵（周期 × OTM）----------

/**
 * 造一条"阶梯齐全"的链：125~160 每 $1 一档，任何 3~15% 的目标 OTM 都吸得住。
 * 矩阵的取值 / 单调性要用完整阶梯来验；"阶梯被截断"的行为另用 TRUNCATED_CHAIN 单独卡。
 */
function denseExpiry(date, dte, iv) {
  const calls = [];
  for (let k = 125; k <= 160; k += 1) {
    const mid = Math.max(0.20, (160 - k) * 0.09 + 0.60);
    calls.push({ k, b: +(mid - 0.05).toFixed(2), a: +(mid + 0.05).toFixed(2), lp: +mid.toFixed(2), iv, oi: 100, v: 5, d: 0.3 });
  }
  return { date: date, ts: 1, dte: dte, calls: calls };
}
const DENSE_CHAIN = {
  sym: 'VGT', spot: 130,
  expiries: [denseExpiry('2026-11-20', 43, 0.21), denseExpiry('2026-12-18', 71, 0.22)],
};

/** VGT 实测那种"近月阶梯被截断"的链：现价 +4% 以外没有挂牌档。 */
const TRUNCATED_CHAIN = {
  sym: 'VGT', spot: 129.37,
  expiries: [{ date: '2026-10-16', ts: 1, dte: 20, calls: [
    { k: 130, b: 2, a: 2.4, lp: 2.2, iv: 0.21, oi: 1, v: 1, d: 0.5 },
    { k: 135, b: 0.7, a: 1.4, lp: 0.9, iv: 0.213, oi: 1, v: 1, d: 0.2 },
  ] }],
};

/* ---------- 候选阶梯（v391：列改成真实档位之后的底座）---------- */

test('ladderOf：候选阶梯＝高于现价 ≤20% 的真实挂牌档，升序', () => {
  assert.deepEqual(ladderOf(VGT_CHAIN.expiries[1], 129.37), [130, 135, 140, 145], '11-20 那期四档都在带内');
  assert.deepEqual(ladderOf(VGT_CHAIN.expiries[0], 129.37), [130, 135], '10-16 那期只有两档');
  const dense = ladderOf(denseExpiry('2026-11-20', 43, 0.21), 130);
  assert.equal(dense[0], 130, '带从现价开始（低于现价的档不是卖 CALL 的候选）');
  assert.equal(dense[dense.length - 1], 156, '+20% 正好 156，边界含');
  assert.equal(dense.indexOf(157), -1, '再往上不进候选（权利金趋近 0）');
  assert.deepEqual(ladderOf(null, 130), [], '没链就空');
  assert.deepEqual(ladderOf(VGT_CHAIN.expiries[1], 0), [], '没现价就空');
  assert.deepEqual(ladderOf({ calls: [{ k: 100 }] }, 130), [], '低于现价的档不算候选');
  assert.equal(LADDER_MAX_OTM, 0.2, '候选带是"现价 0~20%"');
  assert.equal(MATRIX_COLS, 4, '手机上一屏 4 列');
});

test('nearestLadderIdx / matrixWindow：窗口以选中的那一档为锚，两端贴边不越界', () => {
  const lad = [130, 135, 140, 145, 150, 155];
  assert.equal(nearestLadderIdx(lad, 129.37, 7), 2, '7% 目标 138.43 → 最近的挂牌档 140');
  assert.equal(nearestLadderIdx(lad, 129.37, 100), 5, '目标离谱时夹到最后一档，不越界');
  assert.equal(nearestLadderIdx([], 129.37, 7), -1);

  const w1 = matrixWindow(lad, 129.37, 3, 4);
  assert.deepEqual(w1.window, [130, 135, 140, 145], '选中靠左时窗口贴左边');
  assert.equal(w1.selected, 1, '选中的 135 落在窗口第 2 位');
  const w2 = matrixWindow(lad, 129.37, 7, 4);
  assert.deepEqual(w2.window, [135, 140, 145, 150], '选中 140 → 窗口跟着滑一格');
  assert.equal(w2.selected, 1);
  const w3 = matrixWindow(lad, 129.37, 20, 4);
  assert.deepEqual(w3.window, [140, 145, 150, 155], '选中靠右时窗口贴右边');
  assert.equal(w3.selected, 3);
  assert.deepEqual(matrixWindow([], 129.37, 7, 4), { window: [], selected: -1, start: 0 }, '没有阶梯就空窗口');
});

test('probMatrix：行=到期日、列=真实挂牌档位；概率随行权价递减、长期限更高', () => {
  const m = probMatrix(DENSE_CHAIN, { otm: 7, minDte: 14, maxRows: 3 });
  assert.equal(m.spot, 130);
  assert.deepEqual(m.rows.map((r) => r.date), ['2026-11-20', '2026-12-18']);
  assert.deepEqual(m.columns.map((c) => c.strike), [138, 139, 140, 141], '7% 目标 139.1 → 最近的挂牌档是 139，窗口 138~141');
  assert.equal(m.selected, 1, '139 是选中（is-on）那一列');
  assert.equal(m.selectedAbs, 9, 'selectedAbs 是选中档在**完整阶梯**里的下标（± 靠它走相邻真实档）');
  assert.equal(m.ladder[m.selectedAbs], 139, '拿 selectedAbs 去索引阶梯，必须正好是选中的那一档');
  assert.ok(Math.abs(m.columns[1].otmPct - (139 / 130 - 1)) < 1e-9, '列上的 OTM% 是相对现价算的');
  assert.ok(m.ladder.length > m.columns.length, 'ladder 是完整阶梯，± 靠它逐档移动');
  m.rows.forEach((r) => {
    assert.equal(r.cells.length, 4, '每行四格');
    assert.deepEqual(r.probs, r.cells.map((c) => c.prob), 'probs 是 cells 的兼容映射，别让两者脱钩');
    assert.ok(r.cells.every((c) => c.listed && c.prob != null && c.prob > 0 && c.prob < 1), '完整阶梯上每格都该有挂牌档与概率');
    for (let i = 1; i < r.cells.length; i += 1) {
      assert.ok(r.cells[i].prob < r.cells[i - 1].prob, '同一期里行权价越高概率越低：' + r.cells.map((c) => c.prob).join(' > '));
    }
  });
  assert.equal(m.rows[1].sell, undefined, 'v389：fixed/sell 已取消，行上不再有该卖标记');
  for (let i = 0; i < m.columns.length; i += 1) {
    assert.ok(m.rows[1].cells[i].prob > m.rows[0].cells[i].prob, '同一档下更长期限概率应更高');
  }
});

test('probMatrix：某一期没有这一档 → 那一格 listed=false（界面写「无此档」），不吸到隔壁', () => {
  /* 11-20 那期挂牌 130/135/140/145；12-18 那期只有 140/145 —— 窗口落在 130/135 时第二行两格都没报价 */
  const m = probMatrix(VGT_CHAIN, { otm: 1, minDte: 14, maxRows: 3, cols: 2 });
  assert.deepEqual(m.columns.map((c) => c.strike), [130, 135], '1% 目标 130.66 → 最近的挂牌档是 130');
  assert.equal(m.rows[0].cells[0].strike, 130);
  assert.equal(m.rows[0].cells[0].listed, true, '11-20 有 130');
  assert.equal(m.rows[1].cells[0].listed, false, '12-18 没有 130 → 照实说没有，不吸到 140');
  assert.equal(m.rows[1].cells[0].prob, null);
  assert.equal(m.rows[1].cells[1].listed, false, '12-18 也没有 135');
  /* 窗口挪到两期都挂牌的档上，两行就都算得出来 */
  const m2 = probMatrix(VGT_CHAIN, { otm: 11, minDte: 14, maxRows: 3, cols: 2 });
  assert.deepEqual(m2.columns.map((c) => c.strike), [140, 145], '11% 目标 143.6 → 最近的挂牌档是 145，窗口贴右');
  assert.ok(m2.rows.every((r) => r.cells.every((c) => c.listed)), '两期都有 140/145，不该有空格');
});

/* ---------- 矩阵的一格：直接取这一档的真实报价 ---------- */

test('matrixCellAt：直接取这一档的报价，权利金用买卖价中值、年化按剩余天数折算', () => {
  const exp = VGT_CHAIN.expiries[1];   /* 11-20，挂牌 130/135/140/145 */
  const c = matrixCellAt(exp, 129.37, 140, 0.04);
  assert.equal(c.listed, true);
  assert.equal(c.strike, 140);
  assert.ok(Math.abs(c.otmPct - (140 / 129.37 - 1)) < 1e-9, 'otmPct 相对现价：+' + ((140 / 129.37 - 1) * 100).toFixed(1) + '%');
  assert.ok(Math.abs(c.premium - 1.05) < 1e-9, '权利金用买卖价中值 (0.70+1.40)/2');
  assert.ok(Math.abs(c.prob - 0.1463) < 0.002, '这一档链里就有 IV 0.213，概率应对上实测值');
  assert.ok(Math.abs(c.annualPct - annualizedPremiumPct(1.05, 129.37, 43)) < 1e-9);
});

test('matrixCellAt：这一期没有这一档（或参数非法）→ listed=false 且三个数为 null，不编数', () => {
  const exp = TRUNCATED_CHAIN.expiries[0];   /* 只有 130 / 135 */
  const c = matrixCellAt(exp, 129.37, 140, 0.04);
  assert.equal(c.listed, false);
  assert.equal(c.prob, null);
  assert.equal(c.premium, null);
  assert.equal(c.annualPct, null);
  assert.equal(matrixCellAt({ dte: 20, calls: [] }, 129.37, 135, 0.04).listed, false, '完全没有挂牌档');
  assert.equal(matrixCellAt(exp, 0, 130, 0.04).listed, false, '没现价');
  assert.equal(matrixCellAt(exp, 129.37, 0, 0.04).listed, false, '没行权价');
  /* 浮点容差：链里是 132.5，问 132.499999 也该认到（CBOE 的档位都是 0.5/1/2.5/5 的倍数） */
  const near = matrixCellAt({ dte: 30, calls: [{ k: 132.5, b: 1, a: 1.2, iv: 0.2 }] }, 120, 132.4999999, 0.04);
  assert.equal(near.listed, true);
});

test('probMatrix：现价缺失 / 没到期日 → 空表，不抛错', () => {
  assert.deepEqual(probMatrix({ spot: 0, expiries: VGT_CHAIN.expiries }, {}).rows, []);
  assert.deepEqual(probMatrix(VGT_CHAIN, { minDte: 400 }).rows, [], '没有满足 minDte 的档');
  assert.deepEqual(probMatrix(null, {}).rows, []);
  assert.deepEqual(probMatrix(null, {}).columns, [], '空链时列也要空（界面据此出提示）');
  assert.equal(probMatrix(VGT_CHAIN, { cols: 2, maxRows: 1 }).rows[0].probs.length, 2, '列数可配（手机上默认 4）');
});

test('probMatrix：maxRows 限制行数', () => {
  assert.equal(probMatrix(VGT_CHAIN, { minDte: 14, maxRows: 1 }).rows.length, 1);
  assert.equal(probMatrix(VGT_CHAIN, { minDte: 14, maxRows: 99 }).rows.length, 2, '链里只有 2 档 ≥14 天');
});

// ---------- 活跃持仓概率 ----------

test('optionProbabilities：过滤掉已结算/已归档/PUT，并按概率降序', () => {
  const options = [
    { id: 1, sym: 'VGT', type: 'CALL', strike: 140, contracts: 2, expiry: '2026-11-20' },
    { id: 2, sym: 'VGT', type: 'CALL', strike: 130, contracts: 1, expiry: '2026-11-20' },
    { id: 3, sym: 'VGT', type: 'CALL', strike: 140, contracts: 1, expiry: '2026-11-20', settled: true },
    { id: 4, sym: 'VGT', type: 'CALL', strike: 140, contracts: 1, expiry: '2026-11-20', archived: true },
    { id: 5, sym: 'VGT', type: 'PUT', strike: 140, contracts: 1, expiry: '2026-11-20' },
  ];
  const rows = optionProbabilities(VGT_CHAIN, options, { chains: { VGT: VGT_CHAIN } });
  assert.equal(rows.length, 2, '只留两张有效 CALL');
  assert.deepEqual(rows.map((r) => r.id), [2, 1], '概率高的（行权价近的）排前面');
  assert.ok(rows[0].prob > rows[1].prob);
  assert.equal(rows[1].dte, 43);
  assert.equal(rows[1].contracts, 2);
});

test('optionProbabilities：链缺失时 prob 为 null，不抛错', () => {
  const rows = optionProbabilities(null, [{ id: 9, sym: 'SMH', type: 'CALL', strike: 660, contracts: 1, expiry: '2026-11-20' }], {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prob, null);
});

// ---------- BS 辅助 ----------

test('bsCall / bsCallDelta：基本性质', () => {
  const price = bsCall(100, 110, 30 / 365, 0.04, 0.25);
  assert.ok(price > 0 && price < 5);
  assert.ok(bsCall(100, 110, 30 / 365, 0.04, 0.40) > price, '波动率越高越贵');
  const d = bsCallDelta(100, 110, 30 / 365, 0.04, 0.25);
  assert.ok(d > 0 && d < 0.5, '虚值 call 的 delta 应小于 0.5');
  assert.ok(bsCallDelta(100, 100, 30 / 365, 0.04, 0.25) > 0.5);
  assert.equal(bsCall(100, 90, 0, 0.04, 0.25), 10, '到期日退化成内在价值');
});
