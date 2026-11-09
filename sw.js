const C='run-app-v12',A=['./','index.html','style.css','app.js','community.js','garmin-import.js','garmin-connect.js','garmin-brand.png','manifest.json','icon-192.png','icon-512.png','privacy.html','privacy/index.html'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(A)));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
 const wipe=async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))};
 await wipe();await wipe();
 await self.clients.claim();
 const all=await self.clients.matchAll({includeUncontrolled:true,type:'window'});
 all.forEach(c=>c.postMessage({type:'sw-updated',version:C}));
})());});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));});
