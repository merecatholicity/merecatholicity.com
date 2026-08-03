/* The service worker: the installable face's minimal cache. ONLY the small
   shell assets and the six tab-page skeletons ride the cache — documents (the
   books most of all) and every /api/* call always take the network, so nothing
   dynamic can ever be served stale and the free-tier budget law holds (this
   file adds zero API traffic). Exact-URL cache keys: a bumped ?v= misses and
   fetches fresh, so the site's standing cache-busting discipline is untouched.
   Bump VERSION to sweep the cache wholesale.

   v5 (2026-08-02, the standalone postmortem): the SW's OWN network path is
   unreliable inside iOS home-screen app containers — a first launch with an
   empty cache white-screened (the intercepted navigation never produced a
   document) and every uncached tab died the same way, in BOTH the v3
   fetch(e.request) and v4 fetch-by-URL forms, while Safari on the same phone
   was fine. So the worker now takes a request ONLY when it positively holds
   the answer: a SYNCHRONOUS known-cached gate (`known`, a Set of exact cache
   keys primed at startup and maintained on every put) decides inside the
   fetch handler — an unknown URL is never respondWith'd at all, and the
   browser handles it exactly as if no SW existed. A worker defect can now
   cost only an optimization, never a page. Skeletons are primed in activate
   (background, failure-tolerant); the versioned shell assets are primed via
   an mc-prime message from nav.js, which alone knows the current ?v= URLs
   (older same-basename keys are evicted as new ones arrive).

   Kept from v4: cache-hit serves revalidate against ORIGIN (cache:'no-cache';
   the 10-min browser HTTP cache never masquerades as freshness) and when the
   bytes differ the cache is updated and every open page told (mc-page-updated)
   so a young page can heal with one reload (nav.js owns that policy); a newly
   activated worker announces itself (mc-sw-updated) — the message channel,
   not controllerchange, which provably fails to fire on claim in some
   engines; messages are re-sent 4x over ~4.5s (a send racing document
   creation reaches nobody) and pages dedupe; cache.put never raises an
   unhandled rejection; truly ?v=-versioned URLs skip revalidation outright. */
var VERSION = 'mc-shell-v5';
var SHELL = {
  'app.js': 1, 'nav.js': 1, 'deeplink.js': 1, 'style.css': 1,
  'manifest.webmanifest': 1, 'icon-192.png': 1, 'icon-512.png': 1,
};
/* The app's own screens: the tab destinations' static skeletons, cached by
   PATHNAME (their query string is client-side routing and their live content
   is API-driven, so nothing dynamic is ever served stale). A cached skeleton
   is served at once — a cold-started installed app paints instantly — and
   revalidated in the background; every OTHER document and all /api/* traffic
   always ride the network untouched. */
var PAGES = {
  '/': 1, '/index.html': 1, '/community.html': 1, '/feed.html': 1,
  '/messages.html': 1, '/profile.html': 1, '/merecat-ai.html': 1,
};

/* The synchronous gate: exact cache-key URLs this worker POSITIVELY holds.
   null until primed from the cache at startup — and until then every request
   passes by untouched (native is the safe default). Maintained on every put
   and eviction, so the fetch handler can decide without awaiting anything. */
var known = null;
function primeKnown() {
  return caches.open(VERSION).then(function (c) { return c.keys(); }).then(function (reqs) {
    var s = new Set();
    reqs.forEach(function (r) { s.add(r.url); });
    known = s;
  }).catch(function () { if (!known) known = new Set(); });
}
primeKnown();

/* Best-effort put + gate bookkeeping: a full or refusing cache (iOS private
   mode, quota) must never surface as an unhandled rejection in the worker. */
function putKnown(cache, key, res) {
  var keyUrl = typeof key === 'string' ? key : key.url;
  try {
    return cache.put(key, res).then(function () {
      if (known) known.add(keyUrl);
    }).catch(function () { /* cache refused */ });
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
    return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      cs.forEach(function (c) { try { c.postMessage(msg); } catch (err) { /* gone */ } });
    }).catch(function () { /* no clients */ });
  }
  return send()
    .then(function () { return wait(700); }).then(send)
    .then(function () { return wait(1300); }).then(send)
    .then(function () { return wait(2500); }).then(send);
}

/* Prime one URL into the cache (and the gate). Failures are silent — priming
   is an optimization pass; the site runs natively without it. */
function primeUrl(cache, keyUrl, fetchUrl) {
  return fetch(fetchUrl, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok) return putKnown(cache, keyUrl, res);
  }).catch(function () { /* offline or refused: native serving continues */ });
}

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
         born uncontrolled just witnessed the first install and ignores it. */
      return Promise.all([
        tellClients({ t: 'mc-sw-updated', v: VERSION }),
        caches.open(VERSION).then(function (cache) {
          return primeKnown().then(function () {
            return Promise.all(Object.keys(PAGES).map(function (path) {
              return primeUrl(cache, self.location.origin + path, path);
            }));
          });
        }),
      ]);
    })
  );
});

/* nav.js reports the CURRENT versioned asset URLs (only it knows this
   deploy's ?v= keys). Constrained to our own origin and our own asset names —
   nothing else is cacheable by message. A newly-keyed asset evicts its
   same-basename predecessors so the cache never hoards dead versions. */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (!d || d.t !== 'mc-prime' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    return primeKnown().then(function () {
      return Promise.all(d.urls.slice(0, 16).map(function (u) {
        var url;
        try { url = new URL(u, self.location.origin); } catch (err) { return Promise.resolve(); }
        if (url.origin !== self.location.origin) return Promise.resolve();
        if (PAGES[url.pathname]) {
          var pageKey = url.origin + url.pathname;
          if (known && known.has(pageKey)) return Promise.resolve();
          return primeUrl(cache, pageKey, url.pathname);
        }
        var name = url.pathname.split('/').pop();
        if (!SHELL[name]) return Promise.resolve();
        if (known && known.has(url.href)) return Promise.resolve();
        return cache.keys().then(function (reqs) {
          return Promise.all(reqs.filter(function (r) {
            var p;
            try { p = new URL(r.url); } catch (err) { return false; }
            return p.pathname.split('/').pop() === name && r.url !== url.href;
          }).map(function (r) {
            return cache.delete(r).then(function () { if (known) known.delete(r.url); })
              .catch(function () { /* fine */ });
          }));
        }).then(function () { return primeUrl(cache, url.href, url.href); });
      }));
    });
  }).catch(function () { /* priming is best-effort */ }));
});

self.addEventListener('fetch', function (e) {
  try {
    if (e.request.method !== 'GET') return;
    var url;
    try { url = new URL(e.request.url); } catch (err) { return; }
    if (url.origin !== self.location.origin) return;
    if (url.pathname.indexOf('/api/') === 0) return;

    if (PAGES[url.pathname]) {
      /* one skeleton per page: the cache key strips the query, so
         community.html?topic=N and ?cat=X share the one cached document */
      var pageKey = url.origin + url.pathname;
      if (!known || !known.has(pageKey)) return;        // not ours: fully native
      e.respondWith(
        caches.open(VERSION).then(function (cache) {
          return cache.match(pageKey).then(function (hit) {
            if (!hit) {
              /* the gate lied (evicted underneath us): repair it and step
                 aside as nearly as an in-flight respondWith allows */
              if (known) known.delete(pageKey);
              return fetch(e.request);
            }
            /* serve instantly; revalidate + stale-notify in the background.
               Clone BEFORE returning — a consumed body can't be cloned. */
            var hitCmp = hit.clone();
            e.waitUntil(fetch(url.pathname + url.search, { cache: 'no-cache' }).then(function (res) {
              if (!(res && res.ok)) return;
              var forPut = res.clone();
              return res.text().then(function (fresh) {
                return hitCmp.text().then(function (stale) {
                  if (fresh === stale) return;
                  return putKnown(cache, pageKey, forPut).then(function () {
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
    if (!known || !known.has(url.href)) return;         // not ours: fully native
    /* nav.js and style.css are UNVERSIONED and decide which ?v= keys the
       session runs: when cached they go network-first (2.5s race, cache as
       the fallback). ?v=-versioned assets are immutable by law: cache-first,
       no revalidation. The unversioned rest (manifest, icons) serve from
       cache with a background refresh. */
    var networkFirst = name === 'nav.js' || name === 'style.css';
    var versioned = /(^|[?&])v=\d/.test(url.search);
    e.respondWith(
      caches.open(VERSION).then(function (cache) {
        return cache.match(e.request).then(function (hit) {
          if (!hit) {
            if (known) known.delete(url.href);
            return fetch(e.request);
          }
          if (!networkFirst && versioned) return hit;
          var net = fetch(url.href, { cache: 'no-cache' }).then(function (res) {
            if (res && res.ok) {
              putKnown(cache, e.request, res.clone());
              return res;
            }
            return hit;                 // a 5xx never outranks a good cached copy
          }, function () { return hit; });
          if (!networkFirst) {
            /* stale-while-revalidate: serve now, net refreshed the cache */
            net.catch(function () { /* fine */ });
            return hit;
          }
          var settle = new Promise(function (resolve) {
            setTimeout(function () { resolve(null); }, 2500);
          });
          return Promise.race([net, settle]).then(function (winner) { return winner || hit; });
        });
      })
    );
  } catch (err) { /* an internal fault must never take over a request */ }
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
