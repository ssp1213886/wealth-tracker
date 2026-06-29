export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('X-Auth-Token');

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

    // --- Auth check (skip for static files) ---
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/price') {
      if (!auth || auth !== env.AUTH_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: corsHeaders(),
        });
      }
    }

    // --- API: Price proxy — Yahoo Finance bypass CORS ---
    if (url.pathname === '/api/price' && request.method === 'GET') {
      const sym = url.searchParams.get('symbol');
      if (!sym) return json({ error: 'Missing symbol' }, 400);
      try {
        const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=2m&range=1d&includePrePost=true', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const data = await r.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
        // Detect market state from trading periods
        let marketState = '';
        if (meta?.currentTradingPeriod) {
          const now = Math.floor(Date.now() / 1000);
          const pre = meta.currentTradingPeriod.pre;
          const post = meta.currentTradingPeriod.post;
          if (pre && now >= pre.start && now < pre.end) marketState = 'pre';
          else if (post && now >= post.start && now < post.end) marketState = 'post';
          else marketState = 'regular';
        }
        // Use indicators close for pre/post market price (meta only has regularMarketPrice)
        let price = meta?.regularMarketPrice;
        if ((marketState === 'pre' || marketState === 'post') && quotes?.close) {
          const lastClose = quotes.close.filter(v => v != null);
          if (lastClose.length > 0) price = lastClose[lastClose.length - 1];
        }
        return json({ ok: true, data, marketState, price,
          prevClose: meta?.chartPreviousClose || meta?.previousClose,
          hi52: meta?.fiftyTwoWeekHigh });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }

    // --- API: GET /api/sync — load all data ---
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM data').all();
      const data = {};
      for (const row of results) {
        try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
      }
      return json({ ok: true, data, ts: Date.now() });
    }

    // --- API: POST /api/sync — save all data ---
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

    // --- Fallback: serve static HTML from assets ---
    try {
      const asset = await env.ASSETS.fetch(new URL(url.pathname, request.url));
      if (asset.status !== 404) {
        const h = new Headers(asset.headers);
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

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: corsHeaders() });
}
