#!/usr/bin/env node
// e2e 用的假云端：既当静态服务器（发 public/），也模拟 /api/sync 与行情接口。
// 这样端到端测试完全不碰生产数据，也不受网络/限流影响。
// 端口：E2E_PORT（默认 8790）。每次推送都会记到 /_log 供测试断言。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认发当前仓库的 public/；可用 E2E_PUBLIC=<目录> 发别的目录（例如用 git worktree 拉出旧版本做对比）
const PUB = process.env.E2E_PUBLIC ? path.resolve(process.env.E2E_PUBLIC) : fileURLToPath(new URL('../../public/', import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8790);
// 可选：设了 E2E_AUTH_TOKEN 就校验 X-Auth-Token（用于测"坏令牌 → 401"这条路径）
const AUTH_TOKEN = process.env.E2E_AUTH_TOKEN || '';
const store = {};
const meta = {};          // 每个键的"云端版本号"（毫秒），与真 worker 的 updated_at 语义一致
const log = [];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Auth-Token',
    });
    return res.end();
  }
  // 测试专用：查看假云端收到的数据与推送历史
  if (url.pathname === '/_log') {
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ store, meta, log }));
  }
  if (url.pathname === '/_reset') {
    Object.keys(store).forEach((k) => delete store[k]);
    Object.keys(meta).forEach((k) => delete meta[k]);
    log.length = 0;
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ ok: true }));
  }
  // 测试专用：模拟"另一台设备"往云端写入（用于验证拉取/冲突路径）
  if (url.pathname === '/_seed' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body); } catch (e) { /* 忽略 */ }
      const keys = Object.keys(json).filter((k) => k !== 'meta' && k !== 'prices');
      keys.forEach((k) => { store[k] = json[k]; meta[k] = Date.now(); });
      if (json.meta) {
        log.push({ at: new Date().toISOString(), keys: keys.map((k) => 'remote:' + k), expected: json.meta });
      }
      res.writeHead(200, cors);
      res.end(JSON.stringify({ ok: true, keys }));
    });
    return;
  }
  if (url.pathname === '/api/sync') {
    // 可选鉴权：设了 E2E_AUTH_TOKEN 就校验（用于测"坏令牌"路径）；不设则全放行，既有场景不受影响
    if (AUTH_TOKEN && (req.headers['x-auth-token'] || '') !== AUTH_TOKEN) {
      res.writeHead(401, cors);
      return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    }
    if (req.method === 'GET') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ ok: true, data: store, ts: Date.now(), meta: meta }));
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let json = {};
        try { json = JSON.parse(body); } catch (e) { /* 忽略坏 JSON，按空包处理 */ }
        const keys = Object.keys(json).filter((k) => k !== '__expectedVersions' && k !== 'prices');
        const syncTs = Date.now();
        // 版本冲突判定必须与真 worker（src/lib/sync.js）逐字一致，否则会造出假警报：
        //   ① 空对象 {} 直接跳过检查（前端"不知道云端版本"时就会发这个）；
        //   ② 只校验 __expectedVersions 里**列出的键**，不是本次推送的所有键；
        //   ③ 云端没有这一行不算冲突（同步不变量 3）。
        const expected = json.__expectedVersions;
        if (expected && typeof expected === 'object') {
          const expectedKeys = Object.keys(expected);
          const conflicted = expectedKeys.length > 0 && expectedKeys.some((k) => {
            if (meta[k] === undefined) return false;
            return Number(meta[k]) !== Number(expected[k]);
          });
          if (conflicted) {
            log.push({
              at: new Date().toISOString(), keys, expected: expected, conflict: true,
              metaSnapshot: Object.assign({}, meta),
              detail: keys.map((k) => k + ': meta=' + meta[k] + ' expected=' + (Number(expected[k]) || 0)).join(' | '),
            });
            res.writeHead(409, cors);
            return res.end(JSON.stringify({ ok: false, error: 'conflict' }));
          }
        }
        keys.forEach((k) => { store[k] = json[k]; meta[k] = syncTs; });
        log.push({ at: new Date().toISOString(), keys, expected: json.__expectedVersions || null });
        res.writeHead(200, cors);
        res.end(JSON.stringify({ ok: true, saved: keys.length, ts: syncTs }));
      });
      return;
    }
  }
  // 图标代理（对应线上 src/lib/logos.js）：本地测试返回一张 1×1 PNG，也走一遍代码校验
  if (url.pathname === '/api/logo') {
    const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (!/^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/.test(symbol)) {
      res.writeHead(400, cors);
      return res.end(JSON.stringify({ ok: false, error: 'invalid symbol' }));
    }
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
    return res.end(png);
  }
  // 行情代理（对应线上 src/lib/quotes.js 的 handleQuotes）：给一份确定性的报价
  if (url.pathname === '/api/quotes') {
    const prices = {
      NVDA: 186.4, AAPL: 231.2, MSFT: 512.6, VGT: 124.85, SMH: 606.9, TSM: 456.94,
      IWM: 242.3, BTC: 83042.73, BTCETF: 29.38, SPY: 640.1, SKHYV: 31.5, MRVL: 78.2, KLAC: 105.4,
    };
    const symbols = String(url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const quotes = {};
    const missing = [];
    symbols.forEach((sym) => {
      const price = prices[sym];
      if (price) quotes[sym] = { price, prevClose: Number((price / 1.01).toFixed(2)), changePct: 1, name: sym, currency: 'USD', source: 'yahoo', asOf: Date.now() };
      else missing.push(sym);
    });
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ ok: true, quotes, missing, invalid: [], ts: Date.now() }));
  }
  // 前十大（对应线上 src/lib/quotes.js 的 handleHoldings）：SMH 用 stockanalysis 那份（含 SKHYV）
  if (url.pathname === '/api/holdings') {
    const lists = {
      VGT: [['NVDA', 'NVIDIA Corp', 17.74], ['AAPL', 'Apple Inc', 15.8], ['MSFT', 'Microsoft Corp', 11.52], ['AVGO', 'Broadcom Inc', 4.52], ['MU', 'Micron Technology Inc', 4.18], ['AMD', 'Advanced Micro Devices Inc', 2.95], ['CSCO', 'Cisco Systems Inc', 1.71], ['PLTR', 'Palantir Technologies Inc', 1.61], ['INTC', 'Intel Corp', 1.54], ['LRCX', 'Lam Research Corp', 1.49]],
      SMH: [['NVDA', 'Nvidia Corp', 19.14], ['TSM', 'Taiwan Semiconductor Manufacturing', 9.16], ['AMD', 'Advanced Micro Devices Inc', 5.76], ['AVGO', 'Broadcom Inc', 5.24], ['MU', 'Micron Technology Inc', 5.01], ['INTC', 'Intel Corp', 4.94], ['SKHYV', 'SK hynix Inc.', 4.59], ['TXN', 'Texas Instruments Inc', 4.54], ['MRVL', 'Marvell Technology Inc', 4.44], ['AMAT', 'Applied Materials Inc', 4.42]],
    };
    const symbol = String(url.searchParams.get('symbol') || '').toUpperCase();
    if (!lists[symbol]) {
      res.writeHead(400, cors);
      return res.end(JSON.stringify({ error: 'Unsupported symbol' }));
    }
    res.writeHead(200, cors);
    return res.end(JSON.stringify({
      ok: true, symbol, name: symbol, source: 'stockanalysis', asOf: 'Sep 26, 2026',
      list: lists[symbol].map(([sym, name, weight]) => ({ sym, name, weight })), ts: Date.now(),
    }));
  }
  // 市值代理（对应线上 src/lib/marketcap.js）：固定值，未列出的进 missing
  if (url.pathname === '/api/marketcap') {
    const caps = {
      NVDA: 5475761000000, AAPL: 4169451600000, MSFT: 3810000000000, AVGO: 1450000000000,
      MU: 210000000000, AMD: 340000000000, CSCO: 260000000000, PLTR: 449111939156,
      INTC: 612698108410, LRCX: 190000000000, TSM: 2369921550834, TXN: 180000000000,
      MRVL: 230861463000, AMAT: 200000000000, VGT: 6966630000, SMH: 78467697147, IWM: 68000000000,
      BTC: 1663425017662, ETH: 326869319620,
    };
    const symbols = String(url.searchParams.get('symbols') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const out = {};
    const missing = [];
    symbols.forEach((sym) => { if (caps[sym]) out[sym] = caps[sym]; else missing.push(sym); });
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ ok: true, caps: out, missing, ts: Date.now() }));
  }
  // 账号接口（对应线上 src/lib/worker.js 的 /api/accounts）
  if (url.pathname === '/api/accounts') {
    res.writeHead(200, cors);
    return res.end(JSON.stringify({
      ok: true, userId: 1,
      me: { id: 1, username: 'admin', name: 'Admin' },
      accounts: [{ id: 1, username: 'admin', name: 'Admin' }],
    }));
  }
  // 其它 /api/*：返回空但结构正确，避免前端等待或报错
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ ok: true, quotes: {}, missing: [], invalid: [], data: { chart: { result: [] } } }));
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUB, decodeURIComponent(rel));
  if (!file.startsWith(PUB)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  try {
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(PORT, () => console.log('mock-cloud listening on http://127.0.0.1:' + PORT));
