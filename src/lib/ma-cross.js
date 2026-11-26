// 50/200 日均线穿越提醒：策略由 Cloudflare Cron 每个交易日收盘后扫描一次。
// 首次扫描只写基线，不把“价格本来就在均线某一侧”误报成穿越。

const SYMBOLS = ['VGT', 'SMH', 'IBIT'];
export const MA_PERIODS = [50, 200];
const FETCH_TIMEOUT_MS = 8000;

export function movingAverage(values, period) {
  const closes = Array.isArray(values) ? values.map(Number).filter(function (n) { return Number.isFinite(n) && n > 0; }) : [];
  const n = Math.floor(Number(period));
  if (!(n > 0) || closes.length < n) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i += 1) sum += closes[i];
  return sum / n;
}

export function sideOf(price, average) {
  const p = Number(price);
  const a = Number(average);
  if (!(p > 0) || !(a > 0) || p === a) return null;
  return p > a ? 'ABOVE' : 'BELOW';
}

/**
 * 纯规划函数：输入账号、行情和上次状态，产出要写入的新状态与新事件。
 * 交易时段/网络由调用方负责；这里只保证穿越判定可离线测试。
 */
export function planMaCrossScan(input) {
  const source = input || {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  const series = source.series || {};
  const states = Array.isArray(source.states) ? source.states : [];
  const now = Number(source.now) || Date.now();
  const stateMap = new Map();
  states.forEach(function (state) {
    const key = Number(state.user_id) + '|' + String(state.symbol).toUpperCase() + '|' + Number(state.period);
    stateMap.set(key, state);
  });
  const events = [];
  const nextStates = [];
  accounts.forEach(function (account) {
    const userId = Number(account && account.id);
    if (!(userId > 0)) return;
    SYMBOLS.forEach(function (symbol) {
      const row = series[symbol];
      if (!row || !Array.isArray(row.closes) || !(Number(row.price) > 0)) return;
      MA_PERIODS.forEach(function (period) {
        const average = movingAverage(row.closes, period);
        const side = sideOf(Number(row.price), average);
        if (!(average > 0) || !side) return;
        const key = userId + '|' + symbol + '|' + period;
        const previous = stateMap.get(key);
        if (previous && previous.side && previous.side !== side) {
          events.push({
            user_id: userId,
            symbol: symbol,
            period: period,
            from_side: previous.side,
            to_side: side,
            price: Number(row.price),
            average: average,
            triggered_at: now,
          });
        }
        nextStates.push({
          user_id: userId,
          symbol: symbol,
          period: period,
          side: side,
          price: Number(row.price),
          average: average,
          observed_at: now,
        });
      });
    });
  });
  return { events: events, nextStates: nextStates };
}

export async function ensureMaCrossSchema(env) {
  await env.DB.batch([
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS ma_cross_state (user_id INTEGER NOT NULL, symbol TEXT NOT NULL, period INTEGER NOT NULL, side TEXT NOT NULL, price REAL NOT NULL, average REAL NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY (user_id, symbol, period))',
    ),
    env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS ma_cross_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, period INTEGER NOT NULL, from_side TEXT NOT NULL, to_side TEXT NOT NULL, price REAL NOT NULL, average REAL NOT NULL, triggered_at INTEGER NOT NULL, acked_at INTEGER)',
    ),
    env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_ma_cross_events_user ON ma_cross_events(user_id, acked_at, triggered_at DESC)',
    ),
  ]);
}

async function fetchDailySeries(symbol) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1y',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal },
    );
    if (!response.ok) throw new Error('yahoo http ' + response.status);
    const body = await response.json();
    const result = body && body.chart && body.chart.result && body.chart.result[0];
    const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
    const closes = (quote && Array.isArray(quote.close) ? quote.close : [])
      .map(Number)
      .filter(function (n) { return Number.isFinite(n) && n > 0; });
    const price = Number(result && result.meta && result.meta.regularMarketPrice) ||
      (closes.length ? closes[closes.length - 1] : 0);
    if (!closes.length || !(price > 0)) throw new Error('yahoo empty');
    return { closes: closes, price: price };
  } finally {
    clearTimeout(timer);
  }
}

export async function scanMaCrosses(env, options) {
  const opts = options || {};
  await ensureMaCrossSchema(env);
  const accountRows = await env.DB.prepare('SELECT id FROM accounts WHERE disabled = 0 ORDER BY id').all();
  const accounts = accountRows.results || [];
  if (!accounts.length) return { accounts: 0, symbols: 0, events: 0, states: 0 };

  const series = {};
  const errors = [];
  await Promise.all(SYMBOLS.map(async function (symbol) {
    try {
      series[symbol] = await fetchDailySeries(symbol);
    } catch (error) {
      errors.push(symbol + ': ' + ((error && error.message) || 'fetch failed'));
    }
  }));
  if (!Object.keys(series).length) {
    throw new Error('No daily series available: ' + errors.join(' | '));
  }

  const stateRows = await env.DB.prepare(
    'SELECT user_id, symbol, period, side, price, average, observed_at FROM ma_cross_state',
  ).all();
  const plan = planMaCrossScan({
    accounts: accounts,
    series: series,
    states: stateRows.results || [],
    now: Number(opts.now) || Date.now(),
  });
  const statements = [];
  plan.events.forEach(function (event) {
    statements.push(env.DB.prepare(
      'INSERT INTO ma_cross_events (user_id, symbol, period, from_side, to_side, price, average, triggered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(event.user_id, event.symbol, event.period, event.from_side, event.to_side, event.price, event.average, event.triggered_at));
  });
  plan.nextStates.forEach(function (state) {
    statements.push(env.DB.prepare(
      'INSERT INTO ma_cross_state (user_id, symbol, period, side, price, average, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, symbol, period) DO UPDATE SET side = excluded.side, price = excluded.price, average = excluded.average, observed_at = excluded.observed_at',
    ).bind(state.user_id, state.symbol, state.period, state.side, state.price, state.average, state.observed_at));
  });
  if (statements.length) await env.DB.batch(statements);
  return {
    accounts: accounts.length,
    symbols: Object.keys(series).length,
    events: plan.events.length,
    states: plan.nextStates.length,
    errors: errors,
  };
}

export async function listMaCrossEvents(env, userId, limit) {
  await ensureMaCrossSchema(env);
  const max = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await env.DB.prepare(
    'SELECT id, symbol, period, from_side, to_side, price, average, triggered_at FROM ma_cross_events WHERE user_id = ? AND acked_at IS NULL ORDER BY triggered_at DESC, id DESC LIMIT ?',
  ).bind(Number(userId), max).all();
  return (rows.results || []).map(function (row) {
    return {
      id: Number(row.id),
      symbol: row.symbol,
      period: Number(row.period),
      fromSide: row.from_side,
      toSide: row.to_side,
      price: Number(row.price),
      average: Number(row.average),
      triggeredAt: Number(row.triggered_at),
    };
  });
}

export async function ackMaCrossEvent(env, userId, id) {
  await ensureMaCrossSchema(env);
  const result = await env.DB.prepare(
    'UPDATE ma_cross_events SET acked_at = ? WHERE id = ? AND user_id = ? AND acked_at IS NULL',
  ).bind(Date.now(), Number(id), Number(userId)).run();
  return Number(result.meta && result.meta.changes) > 0;
}
