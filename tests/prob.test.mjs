// 被行权概率的纯计算单测（v325）：正态分布、P(ITM)=N(d2)、反推 IV、按目标概率反解行权价、
// 链上的波动率插值，以及"行权价参考"联动的取值。
// 这块直接决定"该卖多远的 CALL"，数字错了会误导真实下单，所以边界值都要卡住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normCdf, normInv, bsCall, bsCallDelta, probITM, impliedVol,
  contractMid, sortedCalls, nearestCall, ivAtStrike, resolveIv, pickExpiry, findExpiry,
  annualizedPremiumPct, planAtOtm, optionProbabilities,
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

test('planAtOtm：给定 OTM% 得到对应概率与权利金（联动那一行）', () => {
  const at7 = planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: 7, targetDte: 45 });
  assert.equal(at7.strike, 140, '129.37×1.07=138.43 → 吸附到 140');
  assert.ok(Math.abs(at7.prob - 0.1463) < 0.003);
  assert.ok(Math.abs(at7.premium - 1.05) < 1e-9, '实际 ' + at7.premium);
});

test('planAtOtm：OTM 拉大 → 概率单调下降（这就是调 +/- 时看到的曲线）', () => {
  const probs = [2, 5, 7, 10, 13].map((o) => planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: o, targetDte: 45 }).prob);
  for (let i = 1; i < probs.length; i += 1) {
    assert.ok(probs[i] <= probs[i - 1], '第 ' + i + ' 个没有更小：' + probs.join(' > '));
  }
  assert.ok(probs[0] > probs[probs.length - 1]);
});

test('planAtOtm：缺现价或 OTM 非法时返回 null（界面显示「—」）', () => {
  assert.equal(planAtOtm({ chain: { sym: 'VGT', spot: 0, expiries: VGT_CHAIN.expiries }, sym: 'VGT', otmPct: 7, targetDte: 45 }), null);
  assert.equal(planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: 0, targetDte: 45 }), null);
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

/* ---------------- v330：精确锁到期日（节奏卡 → 选行权价 用同一天） ---------------- */

test('findExpiry：按日期精确匹配，链里没有就返回 null', () => {
  assert.equal(findExpiry(VGT_CHAIN, '2026-11-20').dte, 43);
  assert.equal(findExpiry(VGT_CHAIN, '2026-12-18').dte, 71);
  assert.equal(findExpiry(VGT_CHAIN, '2026-11-21'), null, '不是挂牌日');
  assert.equal(findExpiry(VGT_CHAIN, ''), null);
  assert.equal(findExpiry(null, '2026-11-20'), null);
  assert.equal(findExpiry({ expiries: [{ date: '2026-11-20', dte: 0 }] }, '2026-11-20'), null, '已到期的档不算');
});

test('planAtOtm：给了 expiry 就精确锁到那一档；链里没有才退回 targetDte', () => {
  const onBeat = planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: 7, expiry: '2026-11-20' });
  assert.equal(onBeat.expiry, '2026-11-20');
  assert.equal(onBeat.dte, 43);
  const far = planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: 7, expiry: '2026-12-18' });
  assert.equal(far.expiry, '2026-12-18', '锁到更远一档时到期日要跟着变');
  assert.equal(far.dte, 71);
  const fallback = planAtOtm({ chain: VGT_CHAIN, sym: 'VGT', otmPct: 7, expiry: '2099-01-01', targetDte: 43 });
  assert.equal(fallback.expiry, '2026-11-20', '链里没有那一天 → 退回按天数挑最近');
});
