export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('X-Auth-Token');

    // --- Rate limit (simple in-memory, per IP) ---
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    if (!globalThis._rateMap) globalThis._rateMap = {};
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
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const r = await fetch(
          'https://query1.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&range=1d',
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
      const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM data').all();
      const data = {};
      for (const row of results) {
        try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
      }
      return json({ ok: true, data, ts: Date.now() });
    }

    // --- API: POST /api/sync ---
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const body = await request.json();
      const statements = [];
      for (const [key, value] of Object.entries(body)) {
        statements.push(
          env.DB.prepare(
            'INSERT OR REPLACE INTO data (key, value, updated_at) VALUES (?, ?, unixepoch())'
          ).bind(key, JSON.stringify(value))
        );
      }
      if (statements.length > 0) {
        await env.DB.batch(statements);
      }
      return json({ ok: true, saved: statements.length, ts: Date.now() });
    }

    // --- Static assets ---
    try {
      const asset = await env.ASSETS.fetch(new URL(url.pathname, request.url));
      if (asset.status !== 404) {
        const h = new Headers(asset.headers);
        h.set('Content-Type', 'text/html; charset=utf-8');
        h.set('Cache-Control', 'no-store, max-age=0');
        return new Response(asset.body, { status: asset.status, headers: h });
      }
    } catch (e) {}
    return new Response('Not Found', { status: 404, headers: corsHeaders() });
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
