// Permite abrir la app sin conexión. Los datos de la liga se piden primero a la red.
const CACHE = 'lafarga-v7';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'supa.js', 'manifest.webmanifest', 'icons/escudo.webp', 'icons/fondo-equipo.webp', 'icons/camiseta.webp', 'icons/icon-192.png', 'icons/icon-512.png', 'data/liga.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const datos = e.request.url.includes('/data/');
  e.respondWith(
    datos
      ? fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
          .catch(() => caches.match(e.request))
      : caches.match(e.request).then(r => r || fetch(e.request))
  );
});
