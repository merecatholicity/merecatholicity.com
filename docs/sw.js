/* The service worker: the installable face's minimal cache. ONLY the small
   shell assets and the six tab-page skeletons ride the cache — documents (the
   books most of all) and every /api/* call always take the network, so nothing
   dynamic can ever be served stale and the free-tier budget law holds (this
   file adds zero API traffic). Exact-URL cache keys: a bumped ?v= misses and
   fetches fresh, so the site's standing cache-busting discipline is untouched.
   Bump VERSION to sweep the cache wholesale.

   v4 (2026-08-02, the installed-app staleness postmortem): a cached skeleton
   carries a literal comments.js?v=NN from the deploy it was cached under — an
   installed app launching on yesterday's skeleton ran a mixed-version client
   that painted the shell and never the content. So: (1) every fetch this
   worker makes rides cache:'no-cache' where freshness matters — the 10-min
   browser HTTP cache no longer masquerades as revalidation (Pages answers 304
   cheaply); (2) a skeleton served from cache is byte-compared against the
   fresh copy in the background, and when they differ the cache is updated and
   every open page is told (mc-page-updated) so a just-launched page can heal
   itself with one reload (nav.js owns that policy); (3) a cache+network double
   miss REJECTS honestly — the old `hit || refresh` resolved respondWith with
   undefined, a silent NetworkError the shell could not distinguish from a
   dead network; (4) a non-ok network answer falls back to the cache instead
   of being served over it; (5) fetches are re-issued by URL, never by
   re-dispatching the Request object (a WebKit navigation-request trap); and
   (6) cache.put can never raise an unhandled rejection (iOS private mode /
   quota). Truly versioned URLs (?v=N) skip background revalidation outright —
   their URL is their freshness, and refetching them doubled bandwidth. */
var VERSION = 'mc-shell-v4';
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
    }).then(function () { return self.clients.claim(); }).then(function () {
      /* Every activation announces itself; each PAGE decides relevance — one
         born controlled is living through an UPDATE and may heal-reload, one
         born uncontrolled just witnessed the first install and ignores it.
         (The SW cannot make that call: a pre-claim matchAll from the NEW
         worker lists only clients it already controls — none — and the
         controllerchange event provably fails to fire on claim in some
         engines. Both found headless, 2026-08-02.) */
      return tellClients({ t: 'mc-sw-updated', v: VERSION });
    })
  );
});

/* Best-effort put: a full or refusing cache (iOS private mode, quota) must
   never surface as an unhandled rejection in the worker. */
function putSafe(cache, key, res) {
  try {
    return cache.put(key, res).catch(function () { /* cache refused */ });
  } catch (err) { return Promise.resolve(); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* Tell every open page something changed underneath it; each page's nav.js
   decides whether a quick heal-reload is safe (young page, not mid-typing).
   Delivery is SENT FOUR TIMES over ~4.5s: a message posted right after a
   navigation response is handed over races the document's creation — the new
   page is not yet in matchAll() and the dying old one is — so a single send
   reliably reaches nobody (found headless, 2026-08-02). Pages dedupe via a
   sessionStorage stamp, so the resends cost nothing. */
function tellClients(msg) {
  function send() {
    return self.clients.matchAll({ type: 'window' }).then(function (cs) {
      cs.forEach(function (c) { try { c.postMessage(msg); } catch (err) { /* gone */ } });
    }).catch(function () { /* no clients */ });
  }
  return send()
    .then(function () { return wait(700); }).then(send)
    .then(function () { return wait(1300); }).then(send)
    .then(function () { return wait(2500); }).then(send);
}

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
          var net = fetch(url.pathname + url.search, { cache: 'no-cache' });
          if (!hit) {
            /* nothing cached: the network IS the answer (cached for the next
               launch); a failure rejects honestly so the shell's retry and
               full-load fallback see a real error, never a silent undefined */
            return net.then(function (res) {
              if (res && res.ok) putSafe(cache, pageKey, res.clone());
              return res;
            });
          }
          /* cached: serve instantly, revalidate + stale-notify in the
             background. Clone the hit BEFORE returning it — a Response whose
             body the page has consumed can no longer be cloned. */
          var hitCmp = hit.clone();
          e.waitUntil(net.then(function (res) {
            if (!(res && res.ok)) return;
            var forPut = res.clone();
            return res.text().then(function (fresh) {
              return hitCmp.text().then(function (stale) {
                if (fresh === stale) return;
                return putSafe(cache, pageKey, forPut).then(function () {
                  return tellClients({ t: 'mc-page-updated', path: url.pathname });
                });
              });
            });
          }).catch(function () { /* offline: the cached copy stands */ }));
          return hit;
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
     They go network-first: a short race keeps a dead network from stalling
     the launch, and the cache stays the offline fallback. Versioned assets
     keep cache-first — their ?v= URL IS their freshness — and the unversioned
     rest (manifest, icons) keep stale-while-revalidate. */
  var networkFirst = name === 'nav.js' || name === 'style.css';
  var versioned = /(^|[?&])v=\d/.test(url.search);
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        if (hit && !networkFirst && versioned) return hit;   // immutable by law
        var net = fetch(url.href, { cache: networkFirst ? 'no-cache' : 'default' })
          .then(function (res) {
            if (res && res.ok) {
              putSafe(cache, e.request, res.clone());
              return res;
            }
            return hit || res;      // a 5xx never outranks a good cached copy
          }, function (err) {
            if (hit) return hit;
            throw err;              // double miss: an honest network error
          });
        if (!hit) return net;
        if (!networkFirst) {
          /* stale-while-revalidate: serve the hit now; net refreshed the cache */
          net.catch(function () { /* offline: fine */ });
          return hit;
        }
        var settle = new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, 2500);
        });
        return Promise.race([net, settle]).then(function (winner) { return winner || hit; });
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
