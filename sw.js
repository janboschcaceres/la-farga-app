// Permite abrir la app al instante y sin conexión.
// Archivos de la app: primero la caché. Escudos, fotos y fuentes: se guardan al verlos.
// Datos de la liga: red con tiempo límite y, si no llega, lo último guardado.
const CACHE = 'lafarga-v40';
const MEDIA = 'lafarga-media-v1';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'supa.js', 'manifest.webmanifest',
  'icons/escudo.webp', 'icons/fondo-equipo.webp', 'icons/camiseta.webp', 'icons/icon-192.png', 'icons/icon-512.png', 'data/liga.json',
  'icons/equipos/almeda-veteranos.png', 'icons/equipos/bolivia-dortmund.png', 'icons/equipos/gossos-fc.png', 'icons/equipos/los-calaveras.png',
  'icons/equipos/menuda-banda-fc.png', 'icons/equipos/sin-fronteras-fc.png', 'galeria/foto-equipo.webp', 'galeria/video1.webp', 'galeria/video2.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARCHIVOS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== MEDIA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const guardar = (nombre, req, r) => { if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(nombre).then(k => k.put(req, c)); } return r; };
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.pathname.includes('/data/')) {
    // la red tiene 3 segundos; si tarda más, se usa lo guardado y se actualiza por detrás
    const red = fetch(req).then(r => guardar(CACHE, req, r));
    e.respondWith(Promise.race([red, new Promise(ok => setTimeout(ok, 3000))]).then(r => r || caches.match(req).then(c => c || red)).catch(() => caches.match(req)));
    return;
  }
  const media = /\.(png|webp|jpg|jpeg|gif|svg|woff2?)$/i.test(url.pathname) || /fonts\.(googleapis|gstatic)\.com/.test(url.host) || /\/assets?\//.test(url.pathname);
  if (media) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => guardar(MEDIA, req, r))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
