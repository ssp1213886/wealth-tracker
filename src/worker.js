import { authRequired, isAuthorized } from './lib/auth.js';
import { serveAsset } from './lib/assets.js';
import { corsHeaders, json } from './lib/http.js';
import { handlePrice } from './lib/price.js';
import { handleSyncGet, handleSyncPost } from './lib/sync.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { handleLog } from './lib/logs.js';

const rateLimiter = createRateLimiter();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (!rateLimiter.check(ip)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { ...corsHeaders(), 'Retry-After': '60' },
      });
    }

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

    if (authRequired(url) && !isAuthorized(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    if (url.pathname === '/api/price') {
      const result = await handlePrice(request, url);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/log') {
      const result = await handleLog(request, env);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      const result = await handleSyncGet(env);
      return json(result.body, result.status);
    }
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const result = await handleSyncPost(request, env);
      return json(result.body, result.status);
    }

    const asset = await serveAsset(request, url, env);
    if (asset) return asset;
    return json({ error: 'Not Found' }, 404);
  },
};
