/* Iceland EV Road Map — service worker (offline support)
   - App shell (the self-contained index.html) is cached so the app boots offline.
   - Map tiles and Wikimedia photos are cached on demand (cache-first) as you browse,
     so areas you've already viewed work without signal — useful in Iceland's dead zones.
   - tjalda.is (live availability/booking) is always network — never served stale. */
const VERSION = 'v4';
const SHELL = 'shell-' + VERSION;
const TILES = 'tiles-' + VERSION;
const PHOTOS = 'photos-' + VERSION;
const SHELL_ASSETS = ['./', './manifest.webmanifest', './icon-32.png', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function trim(cache, max) {
  if (!max) return;
  cache.keys().then((keys) => { if (keys.length > max) cache.delete(keys[0]); });
}

function cacheFirst(req, cacheName, max) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { cache.put(req, res.clone()); trim(cache, max); }
        return res;
      }).catch(() => hit)
    )
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Map tiles → cache-first (cap ~1000 tiles)
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) ||
      /tiles?\.stadiamaps\.com$/.test(url.hostname) ||
      /(server\.arcgisonline\.com|services\.arcgisonline\.com|basemaps\.)/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, TILES, 1000));
    return;
  }
  // Wikimedia photos → cache-first (cap ~250)
  if (url.hostname.indexOf('wikimedia.org') !== -1) {
    e.respondWith(cacheFirst(req, PHOTOS, 250));
    return;
  }
  // Live booking/availability → always network
  if (url.hostname.indexOf('tjalda.is') !== -1) return;

  // Same-origin app shell → network-first so updates always load when online;
  // fall back to the cached app (and cached './' for navigations) when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
      )
    );
  }
});
