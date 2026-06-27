const CACHE="wealth-v3";
self.addEventListener("install",e=>{self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(res=>{if(res&&res.status===200){var r=res.clone();caches.open(CACHE).then(c=>c.put(e.request,r))}return res}).catch(function(){return caches.match(e.request)}))});