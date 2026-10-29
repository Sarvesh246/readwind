const CACHE='readwind-v3';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/favicon.svg'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('folio-')||k.startsWith('readwind-'))&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 // Account data and tokens are never stored in the shared app-shell cache.
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/signin')||url.pathname.startsWith('/signout')||url.pathname.includes('/node_modules/')||url.pathname.startsWith('/@'))return;
 if(req.mode==='navigate') {event.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(async()=>await caches.match(req)||await caches.match('/')||Response.error()));return;}
 if(/\.(?:js|mjs|css|woff2?|svg|png|wasm|bcmap|ttf|traineddata\.gz)$/.test(url.pathname))event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;})));
});
