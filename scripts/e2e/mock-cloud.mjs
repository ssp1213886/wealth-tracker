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
