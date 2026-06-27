const CACHE="wealth-v2";
const ASSETS=["/","/index.html","/manifest.json","/favicon.ico","/guide.html"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(cached=>{const fetched=fetch(e.request).then(res=>{if(res&&res.status===200&&res.type==="basic"){caches.open(CACHE).then(c=>c.put(e.request,res.clone()))}return res}).catch(()=>null);return cached||fetched}))});