/**
 * Offline cache for the Lattice117 demo.
 *
 * The page already computes with no network — the WASM module opens no
 * sockets, and cutting the connection changes nothing about the verdict. What
 * it could not survive was a *reload* while disconnected, because the browser
 * still had to fetch the HTML from somewhere. That gap mattered more than it
 * sounds: the most sceptical visitor is the one who kills their Wi-Fi and
 * then hits refresh to be sure, and they were the one person guaranteed to
 * see a connection error instead of a working page.
 *
 * Cache-first for the shell, so the demo survives the hardest version of its
 * own claim. Bump CACHE when any listed file changes — old caches are deleted
 * on activate, so a stale shell cannot outlive a deploy.
 */

const CACHE = 'lattice117-v3';

// Same-directory paths, so this works at a project-pages sub-path
// (/lattice117-verify/) exactly as it does at a domain root.
const SHELL = [
  './',
  './index.html',
  './audit.html',
  './licence.js',
  './lattice117_wasm.wasm',
  './example-fleet.json',
  './example-route-sheet.csv',
];

self.addEventListener('install', (e) => {
  // One missing file must not fail the whole install and leave the visitor
  // with no cache at all, so each is added on its own.
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // Only same-origin, genuinely successful responses are worth keeping.
      // An opaque cross-origin response cached here would be indistinguishable
      // from a working one when it is not.
      if (res.ok && new URL(req.url).origin === self.location.origin) {
        (await caches.open(CACHE)).put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Offline and not cached. A navigation still gets the shell, so a
      // disconnected reload lands on a working page rather than a browser
      // error; anything else genuinely is not available.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
