// public/sw.js
// Hand-written service worker providing an offline app shell. Registered only
// in production (see src/main.jsx). It precaches the entry document and then
// runtime-caches every same-origin GET request (the hashed JS/CSS chunks and,
// crucially, the solver.worker-*.js chunk) as they are fetched during normal
// online use, so a later offline visit — including the Web Worker the solver
// relies on — works without a network connection.

const CACHE = 'klondike-v1';
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Same-origin GET only; let everything else (cross-origin, POST, etc.) pass
// through untouched.
function shouldHandle(event) {
  const req = event.request;
  return (
    req.method === 'GET' &&
    new URL(req.url, self.location.href).origin === self.location.origin
  );
}

self.addEventListener('fetch', (event) => {
  if (!shouldHandle(event)) return;
  const req = event.request;

  // Navigations: try the network first (so updates are picked up), fall back to
  // the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Serve from cache immediately (fast,
  // works offline) and refresh the cache from the network in the background.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
