const CACHE="totalsorte-v092-public-statistics";
const ASSETS=["./","./index.html","./css/style.css","./js/app.js","./js/supabase-config.js","./js/supabase-client.js","./js/supabase-workflows.js","./manifest.webmanifest","./assets/icons/icon-192.png","./assets/icons/icon-512.png",...Array.from({length:5},(_,i)=>`./assets/pix/pix-${i+1}x.png`)];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET")return;
 const requestUrl=new URL(event.request.url);
 if(requestUrl.origin!==self.location.origin)return;
 const cacheable=ASSETS.some(asset=>new URL(asset,self.location.href).href===requestUrl.href);
 if(!cacheable)return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
  if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone())).catch(error=>console.error("Falha ao armazenar recurso estático no cache.",error));
  return response;
 })));
});
