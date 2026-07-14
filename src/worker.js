export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('X-Auth-Token');

    // --- Rate limit (simple in-memory, per IP) ---
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    if (!globalThis._rateMap) globalThis._rateMap = {};
    // Cleanup expired entries every 5 minutes to prevent memory leak
    if (!globalThis._rateCleanup || now - globalThis._rateCleanup > 300000) {
      for (const k in globalThis._rateMap) {
        if (now - globalThis._rateMap[k].window > 120000) delete globalThis._rateMap[k];
      }
      globalThis._rateCleanup = now;
    }
    const entry = globalThis._rateMap[ip] || { count: 0, window: now };
    if (now - entry.window > 60000) { entry.count = 0; entry.window = now; }
    entry.count++;
    globalThis._rateMap[ip] = entry;
    if (entry.count > 60) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...corsHeaders(), 'Retry-After': '60' },
      });
    }

    // --- CORS ---
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Auth-Token',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // --- Auth check (skip static files and price proxy) ---
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/price') {
      if (!auth || auth !== env.AUTH_TOKEN) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    // --- API: Price proxy via Yahoo Finance ---
    if (url.pathname === '/api/price' && request.method === 'GET') {
      const sym = url.searchParams.get('symbol');
      if (!sym) return json({ error: 'Missing symbol' }, 400);
      // P0-2: validate symbol format to prevent path traversal / open proxy abuse
      if (!/^[A-Z0-9.\-^]{1,12}$/i.test(sym)) return json({ error: 'Invalid symbol' }, 400);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const allowedRanges = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max'];
        const range = allowedRanges.indexOf(url.searchParams.get('range')) > -1 ? url.searchParams.get('range') : '1d';
        const r = await fetch(
          'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=' + range,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal }
        );
        clearTimeout(timeout);
        const data = await r.json();
        return json({ ok: true, data });
      } catch (e) {
        return json({ ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message }, 502);
      }
    }

    // --- API: GET /api/sync ---
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM data').all();
        const data = {};
        const meta = {};
        for (const row of results) {
          try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
          meta[row.key] = row.updated_at;
        }
        return json({ ok: true, data, ts: Date.now(), meta });
      } catch (e) {
        return json({ ok: false, error: 'DB error', detail: e.message }, 502);
      }
    }

    // --- API: POST /api/sync ---
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      // P0-3: input validation
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return json({ error: 'Invalid payload' }, 400);
      }
      const entries = Object.entries(body);
      if (entries.length > 50) return json({ error: 'Too many keys' }, 400);
      // P0-3: key whitelist
      const allowedKeys = new Set(['trades','cashBalance','cashLog','state','activities','optionTrades','otmSettings','exit_portfolio','prices']);
      const statements = [];
      for (const [key, value] of entries) {
        if (typeof key !== 'string' || key.length > 64 || !/^[a-zA-Z0-9_\-.]+$/.test(key)) {
          return json({ error: 'Bad key: ' + key }, 400);
        }
        if (!allowedKeys.has(key)) {
          return json({ error: 'Unknown key: ' + key }, 400);
        }
        const s = JSON.stringify(value);
        if (s.length > 512 * 1024) return json({ error: 'Value too large for key: ' + key }, 400);
        statements.push(
          env.DB.prepare(
            'INSERT OR REPLACE INTO data (key, value, updated_at) VALUES (?, ?, unixepoch())'
          ).bind(key, s)
        );
      }
      try {
        if (statements.length > 0) {
          await env.DB.batch(statements);
        }
        return json({ ok: true, saved: statements.length, ts: Date.now() });
      } catch (e) {
        return json({ ok: false, error: 'DB error', detail: e.message }, 502);
      }
    }

    // --- Static assets ---
    try {
      const asset = await env.ASSETS.fetch(new URL(url.pathname, request.url));
      if (asset.status !== 404 && asset.body) {
        const h = new Headers(asset.headers);
        h.set('Cache-Control', 'no-store, max-age=0');
        return new Response(asset.body, { status: asset.status, headers: h });
      }
    } catch (e) { console.error(e); }
    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: corsHeaders() });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: corsHeaders() });
}
