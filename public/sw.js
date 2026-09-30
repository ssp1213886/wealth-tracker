// Service Worker v309 - focus scroll and unified press feedback
var CACHE = 'wealth-v309';
var PRECACHE = ['/', '/manifest.json', '/assets/main.css', '/assets/app.js'];

function cacheResponse(request, response) {
  if (!response || !response.ok) return Promise.resolve();
  return caches.open(CACHE).then(function(cache) {
    var writes = [cache.put(request, response.clone())];
    if (request.mode === 'navigate') writes.push(cache.put('/', response.clone()));
    return Promise.all(writes);
  });
}

function offlineDocument() {
  return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0e0c"><title>暂时无法连接</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#0b0e0c;color:#f1f3f1;font:15px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center}main{max-width:300px}strong{font-size:18px}p{margin:10px 0 0;color:#9ba59e;line-height:1.65}button{margin-top:18px;min-height:44px;padding:0 18px;border:1px solid #303832;border-radius:12px;background:#151a17;color:inherit;font:inherit}</style></head><body><main><strong>暂时无法连接</strong><p>你的本地数据仍保存在此设备。网络恢复后重新加载即可。</p><button onclick="location.reload()">重新加载</button></main></body></html>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}});
}

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE).then(function(cache) {
    return Promise.all(PRECACHE.map(function(url) {
      return fetch(new Request(url, {cache: 'reload'})).then(function(response) {
        if (!response.ok) return undefined;
        // 预缓存 '/' 时可能还没登录，拿到的是登录页 —— 那不是 App 壳子，绝不能存
        if (url === '/' && response.headers.get('X-WT-Shell') !== '1') return undefined;
        return cache.put(url, response);
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
  // A worker must never answer its own update check from Cache Storage.
  if (url.pathname === '/sw.js') return;
  // 登录页永远走网络：否则已装 PWA 的机器会拿缓存的 App 壳子顶上登录页
  if (url.pathname === '/login') return;
  if (url.pathname.indexOf('/api/') === 0 || request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    var network = fetch(request).then(function(response) {
      if (!response || !response.ok || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Invalid navigation response');
      // 只缓存真正的 App 壳子（Worker 会打 X-WT-Shell 标记）；未登录时同一路径返回登录页，
      // 那个进了缓存就会变成"登出后永远回不去"的事故
      if (response.headers.get('X-WT-Shell') !== '1') return response;
      return cacheResponse(request, response).then(function() { return response; });
    });
    event.waitUntil(network.catch(function() {}));
    // 缓存优先 + 后台更新（v273 改）。
    // 以前是「网络优先 + 3.5 秒竞速」：冷启动（尤其 iOS 重开 PWA）要等满超时才回落缓存，
    // 用户看到的就是白屏。现在只要缓存里有壳子就立刻返回，网络在后台把新版本写进缓存。
    event.respondWith(caches.match('/').then(function(cached) {
      if (cached) return cached;
      return caches.match(request).then(function(hit) {
        return hit || network.catch(function() { return offlineDocument(); });
      });
    }));
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
