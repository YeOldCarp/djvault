/* Mixmap service worker: precache everything, serve cache-first, works fully offline.
   To ship an update: change CACHE below (e.g. mixmap-v2) and re-upload the files. */
const CACHE = 'mixmap-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Any page navigation gets the cached app shell, even offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('index.html').then(r => r || fetch(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req))
  );
});
