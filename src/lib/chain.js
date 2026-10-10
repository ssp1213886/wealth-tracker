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

// IBIT 在 CBOE 有链（实测近月 IV≈36%，与 SMH 同量级），所以卖 CALL 的标的里有它
const ALLOWED_SYMBOLS = new Set(['VGT', 'SMH', 'IBIT']);
const CACHE_TTL_SECONDS = 30 * 60;
const MAX_DTE = 200;          // 只留半年内的到期日
// 24 档足够装下 200 天内的全部到期日（SMH 有 16 档、VGT 只有 6 档）。
// 这里**不能**像 v326 那样"每月只留第三个周五"——SMH 的固定节奏是每 3 周，
// 落在 10-30 / 12-11 这些非月度日期上，滤掉周度会让节奏档在链里查不到。
const MAX_EXPIRIES = 24;
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
  /* 先按"是不是这一天的 CALL、在不在窗口内"过一遍，**不动行权价** ——
     这份是市场真实挂牌的完整阶梯，只用来算平值附近的间距。
     下面的 byExpiry 才是给前端用的裁剪版（只留现价 0.9~1.5 倍）。 */
  const marketByDate = new Map();
  (Array.isArray(contracts) ? contracts : []).forEach(function (c) {
    if (!c || c.cp !== 'C') return;
    if (!(c.ts > now) || c.ts > maxTs) return;
    if (!(c.strike > 0)) return;
    if (!marketByDate.has(c.date)) marketByDate.set(c.date, []);
    marketByDate.get(c.date).push(c.strike);
  });
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
  const expiries = Array.from(byExpiry.values())
    .sort(function (a, b) { return a.ts - b.ts; })
    .slice(0, MAX_EXPIRIES);
  expiries.forEach(function (e) {
    e.calls.sort(function (a, b) { return a.k - b.k; });
    e.dte = Math.max(0, Math.round((e.ts - now) / 86400));
    /* 只带间距，不带"挂牌多少个" —— 个数是市场侧事实，前端不用；
       间距才决定"能不能精确挑到目标 OTM%"。lo/hi（全梯度的极值）同理不发。 */
    const ks = (marketByDate.get(e.date) || []).slice().sort(function (a, b) { return a - b; });
    e.gapPct = medianGapPct(ks, spot);
  });
  // iv30 是 CBOE 顶层的官方 30 天隐含波动率（百分数，例如 22.485 = 22.485%）。
  // 它比从期权链插值算出来的更权威，前端拿来当参照；Yahoo 兜底路径没有这个字段，给 0。
  return {
    sym: sym,
    spot: spot,
    source: String(info.source || ''),
    updated: String(info.updated || ''),
    iv30: num(info.iv30),
    expiries: expiries,
  };
}

/**
 * 平值附近相邻行权价的中位间距（占现价 %）。
 *
 * 为什么只看平值 ±10%：阶梯在不同行权价上密度完全不同（VGT 在 105~150 是 $0.625 一档，
 * 更外面是 $5 一档），拿全梯度的平均值会被两翼带偏。而真正决定"能不能精确挑到 7% OTM"
 * 的，就是你要卖的那个区域有多密。样本不足 3 个时退回整条阶梯。
 */
export function medianGapPct(strikes, spot) {
  const s = num(spot);
  const all = (Array.isArray(strikes) ? strikes : []).filter(function (v) { return Number(v) > 0; }).slice().sort(function (a, b) { return a - b; });
  if (!(s > 0) || all.length < 2) return 0;
  const near = all.filter(function (v) { return v >= s * 0.9 && v <= s * 1.1; });
  const use = near.length >= 3 ? near : all;
  const gaps = [];
  for (let i = 1; i < use.length; i += 1) {
    const g = use[i] - use[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 0;
  gaps.sort(function (a, b) { return a - b; });
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(median / s * 10000) / 100;   // 保留两位百分数，例如 0.81
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
    iv30: data.iv30,
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
