import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const host = process.env.LAN_PREVIEW_HOST || '0.0.0.0';
const port = Number(process.env.LAN_PREVIEW_PORT || 8788);
const quoteSymbols = new Set(['VGT', 'SMH', 'BTC', 'SGOV']);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(response, body, status = 200) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function proxyPrice(url, response) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!quoteSymbols.has(symbol)) return sendJson(response, { error: 'Unsupported symbol' }, 400);
  const range = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']).has(url.searchParams.get('range'))
    ? url.searchParams.get('range')
    : '1d';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    if (upstream.ok) return sendJson(response, { ok: true, data: await upstream.json() });
    throw new Error(`Yahoo HTTP ${upstream.status}`);
  } catch (yahooError) {
    try {
      const fallback = await fetch(`https://qt.gtimg.cn/q=us${encodeURIComponent(symbol)}`, {
        headers: { Referer: 'https://finance.qq.com', 'User-Agent': 'Mozilla/5.0' },
      });
      if (!fallback.ok) throw new Error(`Tencent HTTP ${fallback.status}`);
      const match = (await fallback.text()).match(/"([^"]+)"/);
      const fields = match ? match[1].split('~') : [];
      const price = Number(fields[3]);
      const previousClose = Number(fields[4]);
      if (!(price > 0)) throw new Error('Tencent quote unavailable');
      return sendJson(response, {
        ok: true,
        data: {
          chart: {
            result: [{
              meta: {
                regularMarketPrice: price,
                chartPreviousClose: previousClose || price,
                previousClose: previousClose || price,
                fiftyTwoWeekHigh: Number(fields[48]) || 0,
              },
            }],
          },
        },
      });
    } catch (tencentError) {
      return sendJson(response, { ok: false, error: `${yahooError.message}; ${tencentError.message}` }, 502);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function serveAsset(url, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/guide') pathname = '/guide.html';
  const target = path.resolve(publicDir, `.${pathname}`);
  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const content = await readFile(target);
    response.writeHead(200, {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    response.end();
    return;
  }
  if (url.pathname === '/api/price' && request.method === 'GET') return proxyPrice(url, response);
  if (url.pathname.startsWith('/api/')) return sendJson(response, { error: 'Cloud sync is unavailable in LAN preview' }, 503);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }).end();
    return;
  }
  return serveAsset(url, response);
});

server.listen(port, host, () => {
  console.log(`LAN preview listening on http://${host}:${port}`);
});
