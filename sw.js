/* Crew Commute service worker: lets the site open fast and install on the home screen.
   App files: network first, cache as backup. Flight data is never cached here. */
const CACHE = 'crew-commute-v1';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'assets/css/app.css',
  'assets/js/core.js', 'assets/js/airports.js', 'assets/js/airlines.js', 'assets/js/store.js',
  'assets/js/i18n.js', 'assets/js/engine.js', 'assets/js/conditions.js',
  'assets/js/score.js', 'assets/js/demo.js', 'assets/js/api.js', 'assets/js/inbound.js', 'assets/js/app.js',
  'data/airports.js', 'data/routes.js', 'data/meta.js', 'assets/img/icon.svg', 'assets/img/icon-192.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; /* helper/API calls go straight to the network */
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
