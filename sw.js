/* The service worker: the installable face's minimal cache. ONLY the small
   shell assets ride stale-while-revalidate here — documents (the books most
   of all) and every /api/* call always take the network, so nothing dynamic
   can ever be served stale and the free-tier budget law holds (this file
   adds zero API traffic). Exact-URL cache keys: a bumped ?v= misses and
   fetches fresh, so the site's standing cache-busting discipline is
   untouched. Bump VERSION to sweep the cache wholesale. */
var VERSION = 'mc-shell-v1';
var SHELL = {
  'app.js': 1, 'nav.js': 1, 'deeplink.js': 1, 'style.css': 1,
  'manifest.webmanifest': 1, 'icon-192.png': 1, 'icon-512.png': 1,
};

self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  var name = url.pathname.split('/').pop();
  if (!SHELL[name]) return;
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        var refresh = fetch(e.request).then(function (res) {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || refresh;
      });
    })
  );
});
