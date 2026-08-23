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
  // the cached app shell when offline. respondWith must ALWAYS receive a
  // Response, so we never let the promise resolve to undefined — if even the
  // cached shell is missing we synthesize a minimal one.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        } catch {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          if (cached) return cached;
          return new Response(
            '<!doctype html><html><head><meta charset="utf-8"><title>Klondike</title></head><body><div id="root"></div></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
        }
      })(),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Serve from cache immediately (fast,
  // works offline) and refresh the cache from the network in the background. If
  // the asset is neither cached nor reachable, return a 404 Response rather than
  // undefined (which would throw "Failed to convert value to 'Response'").
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) {
        fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
          })
          .catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return new Response(null, { status: 404, statusText: 'Not cached (offline)' });
      }
    })(),
  );
});
