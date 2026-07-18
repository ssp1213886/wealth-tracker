// Service Worker v12 - extend navigation background through the iPhone safe area
var CACHE = 'wealth-v12';
var PRECACHE = ['/', '/manifest.json', '/icon.png'];

function cacheResponse(request, response) {
  if (!response || !response.ok) return Promise.resolve();
  return caches.open(CACHE).then(function(cache) {
    var writes = [cache.put(request, response.clone())];
    if (request.mode === 'navigate') writes.push(cache.put('/', response.clone()));
    return Promise.all(writes);
  });
}

function offlineDocument() {
  return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0e0c"><title>暂时无法连接</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#0b0e0c;color:#f1f3f1;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}main{max-width:300px}strong{font-size:18px}p{margin:10px 0 0;color:#9ba59e;line-height:1.65}button{margin-top:18px;min-height:44px;padding:0 18px;border:1px solid #303832;border-radius:12px;background:#151a17;color:inherit;font:inherit}</style></head><body><main><strong>暂时无法连接</strong><p>你的本地数据仍保存在此设备。网络恢复后重新加载即可。</p><button onclick="location.reload()">重新加载</button></main></body></html>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE).then(function(cache) {
    return Promise.all(PRECACHE.map(function(url) {
      return fetch(new Request(url, {cache: 'reload'})).then(function(response) {
        if (response.ok) return cache.put(url, response);
      }).catch(function() {});
    }));
  }).then(function() { return self.skipWaiting(); }));
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) { return key !== CACHE; }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }));
});

self.addEventListener('message', function(event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  if (url.pathname.indexOf('/api/') === 0 || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    var network = fetch(request).then(function(response) {
      if (!response || !response.ok || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Invalid navigation response');
      return cacheResponse(request, response).then(function() { return response; });
    });
    var timeout = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Navigation timeout')); }, 3500);
    });
    event.respondWith(Promise.race([network, timeout]).catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || caches.match('/');
      }).then(function(cached) { return cached || offlineDocument(); });
    }));
    event.waitUntil(network.catch(function() {}));
    return;
  }

  event.respondWith(caches.match(request).then(function(cached) {
    var update = fetch(request).then(function(response) {
      if (response && response.ok && response.type === 'basic') return cacheResponse(request, response).then(function() { return response; });
      return response;
    }).catch(function() { return cached || new Response('', {status: 503}); });
    return cached || update;
  }));
});
