import { CORE_SYMBOLS, CORE_TARGETS } from './portfolio-config.js';
import { cashSigned } from './util.js';

function isCapitalEntry(entry) {
  const type = String(entry && entry.type || '');
  return type.indexOf('入金') >= 0 || type.indexOf('出金') >= 0 || type.indexOf('修正') >= 0;
}

function monthOf(date) {
  const ym = String(date || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(ym) ? ym : '';
}

/**
 * 目标策略基准：与用户相同的月末净入金，按固定目标比例投入，
 * 每年 12 月的月末恢复一次目标比例。
 *
 * 这是历史执行标尺，不是未来收益预测。任一期缺少任一核心标的价格时，
 * 从该期起停止推算并标 gap，不用后续价格倒推已经缺失的资产。
 */
export function policyBenchmarkSeries(input) {
  const source = input || {};
  const months = (Array.isArray(source.months) ? source.months : []).map(String).filter(Boolean);
  const cashLog = Array.isArray(source.cashLog) ? source.cashLog : [];
  const priceByMonth = source.priceByMonth || {};
  const targets = source.targets || CORE_TARGETS;
  const units = {};
  CORE_SYMBOLS.forEach(function (symbol) { units[symbol] = 0; });
  const points = [];
  let broken = false;
  let invested = 0;

  months.forEach(function (ym) {
    if (broken) {
      points.push({ ym: ym, value: null, gap: true, invested: invested });
      return;
    }

    const prices = {};
    const complete = CORE_SYMBOLS.every(function (symbol) {
      const price = Number(priceByMonth[symbol] && priceByMonth[symbol][ym]);
      prices[symbol] = price;
      return price > 0;
    });
    if (!complete) {
      broken = true;
      points.push({ ym: ym, value: null, gap: true, invested: invested });
      return;
    }

    let flow = 0;
    cashLog.forEach(function (entry) {
      if (monthOf(entry && entry.date) === ym && isCapitalEntry(entry)) {
        flow += cashSigned(entry);
      }
    });
    invested += flow;

    if (flow > 0) {
      CORE_SYMBOLS.forEach(function (symbol) {
        units[symbol] += flow * (Number(targets[symbol]) || 0) / prices[symbol];
      });
    } else if (flow < 0) {
      const valueBefore = CORE_SYMBOLS.reduce(function (sum, symbol) {
        return sum + units[symbol] * prices[symbol];
      }, 0);
      if (valueBefore > 0) {
        const factor = Math.max(0, Math.min(1, (valueBefore + flow) / valueBefore));
        CORE_SYMBOLS.forEach(function (symbol) { units[symbol] *= factor; });
      }
    }

    let value = CORE_SYMBOLS.reduce(function (sum, symbol) {
      return sum + units[symbol] * prices[symbol];
    }, 0);
    if (ym.slice(5, 7) === '12' && value > 0) {
      CORE_SYMBOLS.forEach(function (symbol) {
        units[symbol] = value * (Number(targets[symbol]) || 0) / prices[symbol];
      });
      value = CORE_SYMBOLS.reduce(function (sum, symbol) {
        return sum + units[symbol] * prices[symbol];
      }, 0);
    }

    points.push({
      ym: ym,
      value: Number(value.toFixed(6)),
      gap: false,
      invested: Number(invested.toFixed(6)),
    });
  });

  const usable = points.filter(function (point) { return !point.gap; });
  return {
    points: points,
    ready: usable.length >= 2,
    last: usable.length ? usable[usable.length - 1] : null,
    invested: Number(invested.toFixed(6)),
  };
}

export function benchmarkComparison(actualSeries, benchmarkSeries) {
  const actual = actualSeries && actualSeries.last;
  const benchmark = benchmarkSeries && benchmarkSeries.last;
  if (!actual || !benchmark || !(benchmark.value > 0)) {
    return { available: false, delta: null, pct: null };
  }
  const delta = Number((actual.value - benchmark.value).toFixed(6));
  return {
    available: true,
    actual: actual.value,
    benchmark: benchmark.value,
    delta: delta,
    pct: delta / benchmark.value,
  };
}
