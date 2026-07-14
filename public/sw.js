// Service Worker v3 - StaleWhileRevalidate + precache
var CACHE = 'wealth-v3';
var PRECACHE = ['/', '/index.html', '/manifest.json', '/icon.png', '/guide'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); }).then(function() { self.skipWaiting(); }));
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }).then(function() { return clients.claim(); }));
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  // Never intercept API calls - always go to network
  if (url.pathname.indexOf('/api/') === 0) return;
  // Only handle GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var fetchPromise = fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return response;
      }).catch(function() { return cached; });
      // Return cached immediately, update in background
      return cached || fetchPromise;
    })
  );
});
