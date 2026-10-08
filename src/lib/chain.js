// 期权链代理：CBOE 延迟报价为主（免费、无需认证、带真实 IV 与希腊字母），Yahoo 期权链为兜底。
//
// 为什么必须在服务端裁剪：CBOE 的原始响应 VGT 约 1MB、SMH 约 3MB（七千多张合约），
// 而"被行权概率"只用得到半年内的 CALL。裁剪完大约几十 KB，再压一层边缘缓存。
//
// 归一化后的形状（前端只认这个，两种来源必须一致）：
//   { sym, spot, source, updated, expiries:[{ date, ts, dte, calls:[{k,b,a,lp,iv,oi,v,d}] }] }
// iv / oi / v / d 允许缺失或为 0 —— Yahoo 的 impliedVolatility 是垃圾值（实测一律 3.1%/6.3%），
// 所以兜底路径把 iv 留成 0，由前端用成交价反推，绝不让脏 IV 流进概率计算。
import { edgeGetJson, edgePutJson } from './edge-cache.js';

const ALLOWED_SYMBOLS = new Set(['VGT', 'SMH']);
const CACHE_TTL_SECONDS = 30 * 60;
const MAX_DTE = 200;          // 只留半年内的到期日
const MAX_EXPIRIES = 10;      // 去重后每月一档，10 档已覆盖半年窗口
const MIN_STRIKE_RATIO = 0.9;
const MAX_STRIKE_RATIO = 1.5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 归一化用的数值清洗：非有限数一律 0，避免 NaN 顺着 JSON 传成 null。 */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round4(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : 0;
}

/**
 * 解析 OSI 合约代码（CBOE 的 `option` 字段），形如 SMH261007C00390000：
 *   标的 + YYMMDD + C/P + 行权价×1000（8 位左补零）。
 * 日期会回读校验一遍，挡掉 261332 这类不存在的月份/日期。
 */
export function parseOsiSymbol(code) {
  const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(String(code || '').trim().toUpperCase());
  if (!m) return null;
  const year = 2000 + Number(m[2].slice(0, 2));
  const month = Number(m[2].slice(2, 4));
  const day = Number(m[2].slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ts = Date.UTC(year, month - 1, day) / 1000;
  const back = new Date(ts * 1000);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return {
    root: m[1],
    ts: ts,
    date: back.toISOString().slice(0, 10),
    cp: m[3],
    strike: Number(m[4]) / 1000,
  };
}

/**
 * 把扁平的合约列表整成按到期日分组的链：只留 CALL、半年内、行权价在现价 0.9~1.5 倍之间。
 * 过滤掉脏数据（行权价 ≤ 0、已过期）是刻意的 —— 这份数据直接喂给概率计算。
 */
export function buildChain(contracts, meta) {
  const info = meta || {};
  const sym = String(info.sym || '').toUpperCase();
  const spot = num(info.spot);
  const now = Number(info.now) || Math.floor(Date.now() / 1000);
  const maxTs = now + MAX_DTE * 86400;
  const lo = spot > 0 ? spot * MIN_STRIKE_RATIO : 0;
  const hi = spot > 0 ? spot * MAX_STRIKE_RATIO : Infinity;
  const byExpiry = new Map();
  (Array.isArray(contracts) ? contracts : []).forEach(function (c) {
    if (!c || c.cp !== 'C') return;
    if (!(c.ts > now) || c.ts > maxTs) return;
    if (!(c.strike > 0) || c.strike < lo || c.strike > hi) return;
    if (!byExpiry.has(c.date)) byExpiry.set(c.date, { date: c.date, ts: c.ts, calls: [] });
    byExpiry.get(c.date).calls.push({
      k: c.strike,
      b: num(c.bid),
      a: num(c.ask),
      lp: num(c.last),
      iv: round4(c.iv),
      oi: num(c.oi),
      v: num(c.vol),
      d: round4(c.delta),
    });
  });
  const expiries = dedupeMonthly(Array.from(byExpiry.values())).slice(0, MAX_EXPIRIES);
  expiries.forEach(function (e) {
    e.calls.sort(function (a, b) { return a.k - b.k; });
    e.dte = Math.max(0, Math.round((e.ts - now) / 86400));
  });
  return { sym: sym, spot: spot, source: String(info.source || ''), updated: String(info.updated || ''), expiries: expiries };
}

/**
 * 每个日历月只留一个到期日，优先标准月度（每月第三个周五）。
 *
 * 为什么要做：SMH 这类 ETF 有**周度**期权，最近的十个到期日全是周度，
 * 会把 43 天的月度档直接挤出列表 —— 反解就退到 29 天的短周期，年化权利金被明显高估。
 * 去重后列表稳定成"每月一档"，和 30/45/60 天这个期限选择器才是同一套口径。
 */
export function dedupeMonthly(expiries) {
  const byMonth = new Map();
  (Array.isArray(expiries) ? expiries : []).forEach(function (e) {
    const date = String((e && e.date) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const day = Number(date.slice(8, 10));
    const isMonthly = new Date(e.ts * 1000).getUTCDay() === 5 && day >= 15 && day <= 21;
    const score = isMonthly ? 0 : Math.abs(day - 19) + 1;   // 当月没有月度档时，取最接近 19 号的那个
    const ym = date.slice(0, 7);
    const cur = byMonth.get(ym);
    if (!cur || score < cur.score || (score === cur.score && e.ts < cur.exp.ts)) byMonth.set(ym, { exp: e, score: score });
  });
  return Array.from(byMonth.values())
    .map(function (v) { return v.exp; })
    .sort(function (a, b) { return a.ts - b.ts; });
}

/** 带超时的 fetch，模式与 lib/price.js 一致。 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** CBOE 延迟报价：一次拿到全链，字段齐全。 */
async function fetchFromCboe(sym, now) {
  const response = await fetchWithTimeout(
    'https://cdn.cboe.com/api/global/delayed_quotes/options/' + sym + '.json',
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    12000,
  );
  if (!response.ok) throw new Error('cboe http ' + response.status);
  const payload = await response.json();
  const data = payload && payload.data;
  if (!data || !Array.isArray(data.options)) throw new Error('cboe shape');
  const contracts = [];
  data.options.forEach(function (o) {
    const parsed = parseOsiSymbol(o && o.option);
    if (!parsed || parsed.cp !== 'C') return;
    contracts.push({
      ts: parsed.ts, date: parsed.date, cp: parsed.cp, strike: parsed.strike,
      bid: o.bid, ask: o.ask, last: o.last_trade_price,
      iv: o.iv, oi: o.open_interest, vol: o.volume, delta: o.delta,
    });
  });
  return buildChain(contracts, {
    sym: sym,
    spot: num(data.close) || num(data.current_price),
    source: 'cboe',
    updated: data.last_trade_time || '',
    now: now,
  });
}

/** 从响应里拼出 Cookie 头（Workers 的 fetch 不会自动帮我们存 cookie）。 */
function readSetCookie(response) {
  let list = [];
  if (typeof response.headers.getSetCookie === 'function') {
    list = response.headers.getSetCookie() || [];
  } else {
    const raw = response.headers.get('set-cookie');
    if (raw) list = [raw];
  }
  return list.map(function (c) { return String(c).split(';')[0]; }).filter(Boolean).join('; ');
}

/**
 * Yahoo 兜底：期权链必须 cookie + crumb 两步（实测缺任一都 401）。
 * 这里刻意只取最近的几个到期日，每条到期日一次请求，避免把兜底路径变成六七个来回。
 * 注意 iv 一律留 0 —— Yahoo 的 impliedVolatility 是占位值，交给前端反推。
 */
async function fetchFromYahoo(sym, now) {
  const seed = await fetchWithTimeout('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' }, 8000);
  const cookie = readSetCookie(seed);
  if (!cookie) throw new Error('yahoo cookie');
  const crumbRes = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    { headers: { 'User-Agent': UA, Cookie: cookie } },
    8000,
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 40 || /[<>\s]/.test(crumb)) throw new Error('yahoo crumb');
  const headers = { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' };
  const baseRes = await fetchWithTimeout(
    'https://query1.finance.yahoo.com/v7/finance/options/' + sym + '?crumb=' + encodeURIComponent(crumb),
    { headers: headers },
    12000,
  );
  if (!baseRes.ok) throw new Error('yahoo http ' + baseRes.status);
  const baseJson = await baseRes.json();
  const root = baseJson && baseJson.optionChain && baseJson.optionChain.result && baseJson.optionChain.result[0];
  if (!root) throw new Error('yahoo shape');
  const spot = num(root.quote && root.quote.regularMarketPrice);
  const maxTs = now + MAX_DTE * 86400;
  const wanted = (Array.isArray(root.expirationDates) ? root.expirationDates : [])
    .filter(function (ts) { return ts > now && ts <= maxTs; })
    .slice(0, 6);
  // 第一次响应里已经带了最近一个到期日，避免重复请求
  const rest = wanted.slice(1);
  const extra = await Promise.all(rest.map(async function (ts) {
    try {
      const r = await fetchWithTimeout(
        'https://query1.finance.yahoo.com/v7/finance/options/' + sym + '?date=' + ts + '&crumb=' + encodeURIComponent(crumb),
        { headers: headers },
        12000,
      );
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.optionChain && j.optionChain.result && j.optionChain.result[0] && j.optionChain.result[0].options
        ? j.optionChain.result[0].options[0] : null;
    } catch (error) {
      return null;
    }
  }));
  const rawOptions = [];
  if (root.options && root.options[0]) rawOptions.push(root.options[0]);
  extra.forEach(function (o) { if (o) rawOptions.push(o); });
  const contracts = [];
  rawOptions.forEach(function (chain) {
    const exp = Number(chain && chain.expirationDate);
    if (!(exp > now)) return;
    const date = new Date(exp * 1000).toISOString().slice(0, 10);
    (chain.calls || []).forEach(function (c) {
      contracts.push({
        ts: exp, date: date, cp: 'C', strike: Number(c.strike),
        bid: c.bid, ask: c.ask, last: c.lastPrice,
        iv: 0, oi: c.openInterest, vol: c.volume, delta: 0,
      });
    });
  });
  if (!contracts.length) throw new Error('yahoo empty');
  return buildChain(contracts, { sym: sym, spot: spot, source: 'yahoo', updated: '', now: now });
}

/**
 * GET /api/chain?sym=VGT
 * 返回归一化后的期权链；两种来源都失败时返回 502，由前端降级到"已实现波动率"。
 */
export async function handleChain(request, url) {
  if (request.method !== 'GET') return { status: 405, body: { ok: false, error: 'Method not allowed' } };
  const sym = String(url.searchParams.get('sym') || '').toUpperCase();
  if (!ALLOWED_SYMBOLS.has(sym)) return { status: 400, body: { ok: false, error: 'Unsupported symbol' } };
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = 'chain:' + sym;
  const cached = await edgeGetJson(url.origin, cacheKey);
  if (cached && cached.ok) return { status: 200, body: cached };
  const failures = [];
  const sources = [fetchFromCboe, fetchFromYahoo];
  for (let i = 0; i < sources.length; i += 1) {
    try {
      const chain = await sources[i](sym, now);
      if (!chain.expiries.length) throw new Error('empty chain');
      const body = { ok: true, chain: chain };
      // 必须 await：Worker 一返回响应，没跑完的异步写入会被取消
      await edgePutJson(url.origin, cacheKey, body, CACHE_TTL_SECONDS);
      return { status: 200, body: body };
    } catch (error) {
      failures.push((i === 0 ? 'cboe' : 'yahoo') + ': ' + error.message);
    }
  }
  return { status: 502, body: { ok: false, error: 'Chain unavailable', detail: failures.join(' | ') } };
}
