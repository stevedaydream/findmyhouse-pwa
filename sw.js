const CACHE_NAME = 'findmyhouse-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/config.js',
  '/js/storage.js',
  '/js/overpass.js',
  '/js/scoring.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/lib/leaflet.js',
  '/lib/leaflet.css',
  '/lib/images/marker-icon.png',
  '/lib/images/marker-icon-2x.png',
  '/lib/images/marker-shadow.png',
  '/lib/images/layers.png',
  '/lib/images/layers-2x.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always network for API routes (Vercel serverless functions)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for Overpass API calls
  if (url.hostname.includes('overpass-api.de') || url.hostname.includes('overpass.osm.ch')) {
    e.respondWith(
      fetch(e.request, { signal: AbortSignal.timeout(30000) })
        .catch(() => new Response(JSON.stringify({ error: 'offline', elements: [] }), {
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Network-first for local JS/CSS (always get latest in dev; fallback to cache offline)
  if (url.pathname.match(/\.(js|css)$/)) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for other static assets (HTML, images, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
