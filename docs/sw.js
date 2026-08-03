/* The service worker: the installable face's minimal cache. ONLY the small
   shell assets ride stale-while-revalidate here — documents (the books most
   of all) and every /api/* call always take the network, so nothing dynamic
   can ever be served stale and the free-tier budget law holds (this file
   adds zero API traffic). Exact-URL cache keys: a bumped ?v= misses and
   fetches fresh, so the site's standing cache-busting discipline is
   untouched. Bump VERSION to sweep the cache wholesale. */
var VERSION = 'mc-shell-v3';
var SHELL = {
  'app.js': 1, 'nav.js': 1, 'deeplink.js': 1, 'style.css': 1,
  'manifest.webmanifest': 1, 'icon-192.png': 1, 'icon-512.png': 1,
};
/* The app's own screens: the tab destinations' static skeletons, cached by
   PATHNAME (their query string is client-side routing and their live content
   is API-driven, so nothing dynamic is ever served stale). Serving the cached
   skeleton at once and revalidating in the background is what lets a
   cold-started installed app open and hop tabs without seconds of network
   blank — every OTHER document (the books, the papers) and all /api/* traffic
   still always ride the network. */
var PAGES = {
  '/': 1, '/index.html': 1, '/community.html': 1, '/feed.html': 1,
  '/messages.html': 1, '/profile.html': 1, '/merecat-ai.html': 1,
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
  if (PAGES[url.pathname]) {
    /* one skeleton per page: the cache key strips the query, so
       community.html?topic=N and ?cat=X share the one cached document */
    var pageKey = url.origin + url.pathname;
    e.respondWith(
      caches.open(VERSION).then(function (cache) {
        return cache.match(pageKey).then(function (hit) {
          var refresh = fetch(e.request).then(function (res) {
            if (res && res.ok) cache.put(pageKey, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || refresh;
        });
      })
    );
    return;
  }
  var name = url.pathname.split('/').pop();
  if (!SHELL[name]) return;
  /* nav.js and style.css are UNVERSIONED, and nav.js decides which app.js?v=N
     the whole session runs — serving them stale-while-revalidate meant every
     installed-app launch after a deploy ran yesterday's bundle against
     today's markup (a whole-launch staleness window, seen as PWA gremlins).
     They go network-first now: a short race keeps a dead network from
     stalling the launch, and the cache stays the offline fallback. The
     versioned assets keep cache-first — their ?v= URL IS their freshness. */
  var networkFirst = name === 'nav.js' || name === 'style.css';
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        var refresh = fetch(e.request).then(function (res) {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit; });
        if (!networkFirst) return hit || refresh;
        if (!hit) return refresh;
        var settle = new Promise(function (resolve) {
          setTimeout(function () { resolve(hit); }, 2500);
        });
        return Promise.race([refresh, settle]);
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
