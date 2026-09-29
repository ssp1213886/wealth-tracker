// 策略工具 / 提款模拟的纯逻辑（不碰 DOM、不碰全局状态），便于单测与后续继续拆分 index.js。
// 数据形状：state.plan = { income: [[档位名, 下限, 上限] × 4], exit: [动作 × 4], wd: {portfolio, rate, ret, infl} }

export const PLAN_DEFAULTS = {
  income: [['起步期', '$2K', '$2.5K'], ['增长期', '$2.5K', '$3.5K'], ['巅峰期', '$3.5K', '$5K'], ['冲刺期', '$5K+', '']],
  exit: ['持续进攻', '检查退出', '等待窗口', '保守组合'],
  wd: { portfolio: 2270000, rate: 4, ret: 6, infl: 2.5 },
};

/** 提款模拟的四个输入：DOM id → plan.wd 字段 */
export const WD_FIELDS = [['rWdPortfolio', 'portfolio'], ['rWdRate', 'rate'], ['rWdReturn', 'ret'], ['rWdInfl', 'infl']];

export const PLAN_WD_KEYS = ['portfolio', 'rate', 'ret', 'infl'];

/**
 * 归一化 state.plan：缺字段补默认；收入档位必须是 4 行 3 列、退出动作必须 4 条，
 * 数值字段非有限数时回落到默认值。返回全新的对象（不改传入的 state）。
 */
export function readPlan(state) {
  const p = (state && state.plan) || {};
  const income = (p.income && p.income.length === 4)
    ? p.income.map((row) => [String((row && row[0]) || ''), String((row && row[1]) || ''), String((row && row[2]) || '')])
    : PLAN_DEFAULTS.income.map((row) => row.slice());
  const exit = (p.exit && p.exit.length === 4)
    ? p.exit.map((v) => String(v || ''))
    : PLAN_DEFAULTS.exit.slice();
  const wd = {};
  PLAN_WD_KEYS.forEach((key) => {
    // null / undefined / 空串一律视为"没设置"→ 回落默认（历史实现里 Number(null)===0 会把通胀算成 0%）
    const raw = p.wd ? p.wd[key] : undefined;
    const v = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
    wd[key] = Number.isFinite(v) ? v : PLAN_DEFAULTS.wd[key];
  });
  return { income, exit, wd };
}

/**
 * 就地编辑一格：kind='income' 改 [档位名/下限/上限]（k=0/1/2），kind='exit' 改动作文案。
 * 返回新的 plan；越界或无对应字段时返回 null（调用方据此忽略这次编辑）。
 */
export function setPlanText(plan, kind, index, key, text) {
  const d = readPlan({ plan });
  const i = Number(index);
  const k = Number(key);
  if (kind === 'income') {
    if (!d.income[i]) return null;
    d.income[i][k] = String(text == null ? '' : text);
    return d;
  }
  if (kind === 'exit') {
    if (d.exit[i] === undefined) return null;
    d.exit[i] = String(text == null ? '' : text);
    return d;
  }
  return null;
}

/**
 * 提款模拟：按"年提款 = 本金 × 提款率"计算年度/月度提款额、实际回报率（收益 − 通胀）、
 * 以及在该实际回报率下本金耗尽所需年数（回报率 ≤ 0 或提款率高于实际回报时才会耗尽）。
 */
export function computeWithdrawal(input) {
  const p = Number(input && input.portfolio) || 0;
  const rate = (Number(input && input.ratePct) || 0) / 100;
  const ret = (Number(input && input.returnPct) || 0) / 100;
  const infl = (Number(input && input.inflPct) || 0) / 100;
  const annual = p * rate;
  const realReturn = ret - infl;
  let depletionYears = null;      // null = 永续
  if (rate > realReturn || realReturn <= 0) {
    let balance = p;
    let years = 0;
    while (balance > 0 && years < 80) {
      balance = balance * (1 + realReturn) - annual;
      years += 1;
    }
    if (years < 80) depletionYears = years;
  }
  return { annual, monthly: annual / 12, realReturn, depletionYears };
}
