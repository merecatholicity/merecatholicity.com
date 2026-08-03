/* Deep-link anchors for the generated Scripture and Fathers pages. Loaded on
   every page by nav.js; it acts only on the pandoc-built corpus (which carries
   `.unnumbered` headings) and no-ops on the hand-authored site pages.

   It gives every heading and paragraph a stable id and a hover-revealed ¶
   marker whose click copies an exact deep-link URL, so a reader can point
   someone at a precise paragraph of a Father, a council, or the Summa. On the
   KJV it additionally stamps every verse with a canonical id
   (book-slug-chapter-verse, e.g. `romans-8-28`) so the forum's scripture
   autolinks land on the exact verse. Headings keep pandoc's own slug id (the
   table of contents still resolves); paragraphs hang off the nearest heading
   id as `<heading-id>__p<n>`. All DOM, never innerHTML.

   Re-runnable by design (v2): the app shell swaps page content in place and
   calls window.mcDeeplink.run() on the fresh document — the walk skips
   elements already stamped (.dl), the document-level listeners register
   once, and the ¶ click builds its URL from location AT CLICK TIME, so a
   pushState'd path always copies correctly. */
(function () {
  "use strict";

  // The 66 KJV books in canonical order; the book <h2> headings run in this
  // order, so the nth maps to SLUGS[n]. Only used on kjv.html.
  var SLUGS = [
    "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua",
    "judges", "ruth", "1-samuel", "2-samuel", "1-kings", "2-kings",
    "1-chronicles", "2-chronicles", "ezra", "nehemiah", "esther", "job",
    "psalms", "proverbs", "ecclesiastes", "song-of-solomon", "isaiah",
    "jeremiah", "lamentations", "ezekiel", "daniel", "hosea", "joel", "amos",
    "obadiah", "jonah", "micah", "nahum", "habakkuk", "zephaniah", "haggai",
    "zechariah", "malachi", "matthew", "mark", "luke", "john", "acts",
    "romans", "1-corinthians", "2-corinthians", "galatians", "ephesians",
    "philippians", "colossians", "1-thessalonians", "2-thessalonians",
    "1-timothy", "2-timothy", "titus", "philemon", "hebrews", "james",
    "1-peter", "2-peter", "1-john", "2-john", "3-john", "jude", "revelation"
  ];

  function inChrome(el) {          // skip site nav, the pandoc TOC, the footer
    return el.closest("nav, header, footer, #TOC");
  }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function slugify(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 60);
  }

  // --- arrival: scroll to and tint the hash target ---------------------
  function reveal() {
    if (!location.hash || location.hash.length < 2) return;
    var t;
    try { t = document.getElementById(decodeURIComponent(location.hash.slice(1))); }
    catch (_) { t = null; }
    if (!t) return;
    t.scrollIntoView({ block: "center" });
    t.classList.add("dl-target");
    setTimeout(function () { t.classList.remove("dl-target"); }, 2600);
  }

  // --- corpus reader extras: ask-merecat selection chip, reading-position
  //     tracker, end-of-work nav. All re-runnable under the app shell:
  //     cleanupExtras() tears the per-page observers down at the top of every
  //     run() (including the early-returning non-corpus runs), the document
  //     and window listeners bind once behind extrasBound, and the
  //     selectionchange handler self-gates on the corpus marker each time. ---
  var chipEl = null, chipQ = "", selDebT = null;
  var extrasBound = false;
  var posTargets = null, posCurId = null, posSaveT = null, posScanT = null;
  var endObserver = null;
  var orderPromise = null;

  function extrasCss() {
    if (document.getElementById("mc-askchip-css")) return;
    var s = el("style");
    s.id = "mc-askchip-css";
    s.textContent =
      ".mc-askchip{position:absolute;z-index:120;background:var(--maroon,#8b1a1a);" +
      "color:#fff;font-family:inherit;font-size:.85rem;font-weight:600;border:0;" +
      "border-radius:999px;padding:.4em .9em;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer}" +
      ".mc-askchip[hidden]{display:none}" +
      ".mc-endnav{margin-top:2.5em;padding-top:1em;border-top:1px solid var(--rule,#d9cfb8);" +
      "color:var(--faint,#8a7f6a);font-size:.95em}";
    document.head.appendChild(s);
  }

  // --- feature 1: the ask-merecat selection chip -----------------------
  function hideChip() {
    if (chipEl) chipEl.hidden = true;
    chipQ = "";
  }

  function ensureChip() {
    if (chipEl && document.body.contains(chipEl)) return chipEl;
    chipEl = el("button", "mc-askchip");
    chipEl.type = "button";
    chipEl.textContent = "Ask merecat";
    chipEl.hidden = true;
    var keep = function (e) { e.preventDefault(); };   // a tap must not collapse the selection
    chipEl.addEventListener("mousedown", keep);
    chipEl.addEventListener("touchstart", keep);
    chipEl.addEventListener("click", function () {
      if (!chipQ) return;
      try {
        localStorage.setItem("mc-merecat-prefill",
          JSON.stringify({ q: chipQ, at: Date.now() }));
      } catch (_) {}
      location.href = "merecat-ai.html";
    });
    document.body.appendChild(chipEl);
    return chipEl;
  }

  function onSelection() {
    if (!document.querySelector(".unnumbered")) { hideChip(); return; }
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { hideChip(); return; }
    var text = String(sel).replace(/\s+/g, " ").trim();
    if (!text) { hideChip(); return; }
    var range = sel.getRangeAt(0);
    var scope = range.commonAncestorContainer;
    if (scope && scope.nodeType !== 1) scope = scope.parentElement;
    var main = document.querySelector("main.prose");
    if (!scope || !main || !main.contains(scope) || inChrome(scope)) { hideChip(); return; }
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideChip(); return; }

    // Build the question now, so a click that collapses the selection still works.
    var h1 = main.querySelector("h1.title");
    var title = (h1 && h1.textContent.trim()) || document.title;
    var start = range.startContainer;
    if (start && start.nodeType !== 1) start = start.parentElement;
    var anchored = start && start.closest && start.closest("[id]");
    var link = location.origin + location.pathname;
    if (anchored && main.contains(anchored) && anchored.id) link += "#" + anchored.id;
    chipQ = "In " + title + ', what is meant by this passage? "' +
      text.slice(0, 400) + '" ' + link;

    var chip = ensureChip();
    chip.hidden = false;
    var w = chip.offsetWidth || 120;
    var x = rect.left + rect.width / 2 - w / 2 + window.scrollX;
    var lo = window.scrollX + 8;
    var hi = window.scrollX + window.innerWidth - w - 8;
    if (x > hi) x = hi;
    if (x < lo) x = lo;
    chip.style.left = x + "px";
    chip.style.top = (rect.bottom + 10 + window.scrollY) + "px";
  }

  // --- feature 2: reading position (contract: key and shape exact) -----
  function savePos() {
    if (!posCurId || !document.querySelector(".unnumbered")) return;
    try {
      localStorage.setItem("mc-readpos:" + location.pathname,
        JSON.stringify({ id: posCurId, title: document.title, at: Date.now() }));
    } catch (_) {}
  }

  function schedulePos() {
    if (posSaveT) return;
    // Capture the key at schedule time: a soft navigation can change
    // location.pathname before this trailing save fires.
    var key = "mc-readpos:" + location.pathname;
    var title = document.title;
    posSaveT = setTimeout(function () {
      posSaveT = null;
      if (!posCurId) return;
      try {
        localStorage.setItem(key,
          JSON.stringify({ id: posCurId, title: title, at: Date.now() }));
      } catch (_) {}
    }, 2000);
  }

  function initPos() {
    var main = document.querySelector("main.prose");
    if (!main) return;
    // Headings only: the KJV carries ~31k verse paragraphs and the big
    // Fathers volumes thousands of stamped paragraphs; chapter and section
    // headings are the honest continue-reading anchor and keep the scan
    // small. A throttled position scan, not an IntersectionObserver:
    // observers fire on boundary CROSSINGS, so an instant jump (End key,
    // find-in-page, a deep link) moved headings past the viewport without
    // ever intersecting it and the position never updated.
    var heads = main.querySelectorAll("h1.unnumbered, h2, h3, h4, h5, h6");
    posTargets = [];
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].id && !inChrome(heads[i])) posTargets.push(heads[i]);
    }
    if (!posTargets.length) return;
    samplePos();
  }
  function samplePos() {
    if (!posTargets || !posTargets.length) return;
    var band = window.innerHeight * 0.4;
    var best = null;
    for (var i = 0; i < posTargets.length; i++) {
      var top = posTargets[i].getBoundingClientRect().top;
      if (top < band) best = posTargets[i].id;
      else break;   // document order: past the band, the rest are lower still
    }
    // Before the first heading enters the band the honest position is the
    // page top: remember the work with its first anchor so Continue reading
    // can still offer it.
    posCurId = best || posTargets[0].id;
    schedulePos();
  }

  // --- feature 3: end-of-work nav --------------------------------------
  function loadOrder() {
    if (!orderPromise) {
      orderPromise = fetch("library-order.json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return orderPromise;
  }

  function basename(p) {
    return String(p || "").split("/").pop().split("#")[0].split("?")[0];
  }

  function renderEndnav() {
    var main = document.querySelector("main.prose");
    if (!main || document.getElementById("mc-endnav")) return;
    loadOrder().then(function (data) {
      // The fetch may resolve after a soft navigation replaced the page.
      if (!main.isConnected || document.getElementById("mc-endnav")) return;
      if (!document.querySelector(".unnumbered")) return;
      var next = null;
      if (data && Array.isArray(data.works)) {
        var here = basename(location.pathname);
        for (var i = 0; i < data.works.length; i++) {
          var w = data.works[i] || {};
          if (basename(w.href) === here) {
            var n = data.works[i + 1];
            // "This shelf" must be true: suppress a cross-shelf neighbor.
            if (n && n.shelf === w.shelf && n.href && n.title) next = n;
            break;
          }
        }
      }
      var nav = el("nav", "mc-endnav");
      nav.id = "mc-endnav";
      if (next) {
        var p1 = el("p");
        p1.appendChild(document.createTextNode("Next on this shelf: "));
        var a1 = el("a");
        a1.href = String(next.href);
        a1.textContent = String(next.title);
        p1.appendChild(a1);
        p1.appendChild(document.createTextNode("."));
        nav.appendChild(p1);
      }
      var p2 = el("p");
      var a2 = el("a");
      a2.href = "library.html";
      a2.textContent = "Back to the Library";
      p2.appendChild(a2);
      p2.appendChild(document.createTextNode("."));
      nav.appendChild(p2);
      main.appendChild(nav);
    });
  }

  function initEndnav() {
    if (!("IntersectionObserver" in window)) return;
    var main = document.querySelector("main.prose");
    var target = (main && main.lastElementChild) || document.querySelector("footer");
    if (!target) return;
    endObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          if (endObserver) { endObserver.disconnect(); endObserver = null; }
          renderEndnav();
          return;
        }
      }
    }, { rootMargin: "600px 0px" });
    endObserver.observe(target);
  }

  // --- extras lifecycle -------------------------------------------------
  function cleanupExtras() {
    posTargets = null;
    if (endObserver) { endObserver.disconnect(); endObserver = null; }
    if (posSaveT) { clearTimeout(posSaveT); posSaveT = null; }
    if (posScanT) { clearTimeout(posScanT); posScanT = null; }
    if (selDebT) { clearTimeout(selDebT); selDebT = null; }
    posCurId = null;
    hideChip();
    var stale = document.getElementById("mc-endnav");
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  }

  function bindExtras() {
    if (extrasBound) return;
    extrasBound = true;
    document.addEventListener("selectionchange", function () {
      if (selDebT) clearTimeout(selDebT);
      selDebT = setTimeout(function () { selDebT = null; onSelection(); }, 250);
    });
    window.addEventListener("scroll", hideChip, { passive: true });
    window.addEventListener("scroll", function () {
      if (posScanT) return;
      posScanT = setTimeout(function () { posScanT = null; samplePos(); }, 1500);
    }, { passive: true });
    window.addEventListener("pagehide", savePos);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePos();
    });
  }

  function initExtras() {
    extrasCss();
    bindExtras();
    initPos();
    initEndnav();
  }

  var listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    // One delegated click handler for all ¶ markers, not thousands of
    // listeners — and it survives content swaps because it rides document.
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a.dl-anchor");
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute("href").slice(1);
      try { if (navigator.clipboard) navigator.clipboard.writeText(location.origin + location.pathname + "#" + id); } catch (_) {}
      if (history.replaceState) history.replaceState(null, "", "#" + id);
      else location.hash = id;
      a.classList.add("dl-copied");
      setTimeout(function () { a.classList.remove("dl-copied"); }, 1200);
    });
    window.addEventListener("hashchange", reveal);
  }

  function run() {
    cleanupExtras();   // per-page observers and chip die before any early return
    if (!document.querySelector(".unnumbered")) return;  // hand-authored page
    var isKJV = /(^|\/)kjv\.html$/.test(location.pathname);

    // --- assign ids and collect anchorable elements --------------------
    var nodes = document.querySelectorAll(
      "h1.unnumbered, h2, h3, h4, h5, h6, p");
    var used = {};                   // ids we have assigned or reserved
    function taken(id) {
      // collides with one we assigned, a pandoc slug, or its toc- copy
      return used[id] || document.getElementById(id) || document.getElementById("toc-" + id);
    }
    function unique(id) {
      var base = id || "sec", i = 2;
      id = base;
      while (taken(id)) { id = base + "-" + i++; if (i > 999) break; }
      used[id] = true;
      return id;
    }
    function verseId(p) {                     // <strong>C:V</strong> at start
      var s = p.firstElementChild;
      if (!s || s.tagName !== "STRONG") return null;
      var m = /^(\d+):(\d+)\.?$/.exec((s.textContent || "").trim());
      if (!m || bookIdx < 0 || bookIdx >= SLUGS.length) return null;
      return SLUGS[bookIdx] + "-" + m[1] + "-" + m[2];
    }

    var curHeadId = null, paraN = 0;         // for Fathers-style paragraph ids
    var bookIdx = -1;                        // for KJV verse ids (h2 order)
    var anchorables = [];
    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      if (inChrome(node)) continue;
      var already = node.classList.contains("dl");   // stamped on a prior run
      var tag = node.tagName;
      if (tag !== "P") {                      // a heading
        if (isKJV && tag === "H2") bookIdx++;
        if (node.id) used[node.id] = true;    // keep pandoc's slug (TOC needs it)
        else node.id = unique(slugify(node.textContent));
        curHeadId = node.id; paraN = 0;
        if (!already) anchorables.push({ el: node, id: node.id });
        continue;
      }
      if (node.id) {                          // a stamped or pandoc-id'd para
        used[node.id] = true;
        if (!already && !isKJV) { paraN++; anchorables.push({ el: node, id: node.id }); }
        continue;
      }
      var vid = isKJV ? verseId(node) : null;  // a paragraph
      if (vid) {
        // a KJV verse: give it the canonical id the autolinks target, but no
        // visible marker — 31,000 of them would be noise and weight; the verse
        // is still a scroll target and readers cite it by reference.
        node.id = unique(vid);
      } else {
        paraN++;
        node.id = unique((curHeadId || "p") + "__p" + paraN);
        anchorables.push({ el: node, id: node.id });
      }
    }

    // --- the ¶ markers (hover on desktop, tap-visible on touch) ---------
    for (var j = 0; j < anchorables.length; j++) {
      var it = anchorables[j];
      it.el.classList.add("dl");
      var a = el("a", "dl-anchor");
      a.href = "#" + it.id;
      a.textContent = "¶";
      a.title = "Copy a link to this passage";
      a.setAttribute("aria-label", "Copy a link to this passage");
      it.el.appendChild(a);
    }
    listen();
    initExtras();
    // ids were just assigned, so the browser hasn't scrolled — do it now.
    if (location.hash) setTimeout(reveal, 0);
  }

  // The app shell re-runs this after swapping content; reveal is exposed so
  // an anchored soft navigation can land exactly like a hard one.
  window.mcDeeplink = { run: run, reveal: reveal };
  run();
})();
