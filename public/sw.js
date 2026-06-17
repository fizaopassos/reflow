const CACHE = 'medidor-v3';
const ASSETS = ['/', '/index.html', '/css/app.css', '/js/api.js', '/js/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;

  const url = new URL(e.request.url);
  const isAsset = ['/js/app.js', '/js/api.js', '/css/app.css'].some(p => url.pathname === p);

  if (isAsset) {
    // network-first: tenta buscar do servidor, cai no cache só se offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // demais recursos: cache-first (ícones, fontes, etc)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});