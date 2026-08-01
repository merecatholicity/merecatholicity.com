/* The service worker: the installable face's minimal cache. ONLY the small
   shell assets ride stale-while-revalidate here — documents (the books most
   of all) and every /api/* call always take the network, so nothing dynamic
   can ever be served stale and the free-tier budget law holds (this file
   adds zero API traffic). Exact-URL cache keys: a bumped ?v= misses and
   fetches fresh, so the site's standing cache-busting discipline is
   untouched. Bump VERSION to sweep the cache wholesale. */
var VERSION = 'mc-shell-v2';
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

/* Web Push: show the notification the worker sent (title/body/url only — never
   message content). The payload is the JSON deliverPush encrypted. */
self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  var title = d.title || 'Mere Catholicity';
  var opts = {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/community.html' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

/* Tapping a notification focuses an existing tab (navigating it to the deep link)
   or opens a new one. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/community.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      for (var i = 0; i < cs.length; i++) {
        if ('focus' in cs[i]) {
          try { cs[i].navigate(url); } catch (e) { /* cross-origin/older browser */ }
          return cs[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

/* The push subscription can be rotated by the browser/OS. Best-effort no-op here;
   the client re-checks and re-registers its subscription on every load. */
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(Promise.resolve());
});
