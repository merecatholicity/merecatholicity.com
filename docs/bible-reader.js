/* A one-page Bible reader. Instead of rendering all ~31,000 verses at once
   (which buries a phone), it loads the text as JSON and paints one chapter at
   a time: choose a book, land on chapter 1, drill to any chapter from the row
   of numbers. Generic — the page's mount element carries the config:

     <div id="bible-reader" data-json="kjv.json"
          data-audio="https://audio.merecatholicity.com/kjv"
          data-audio-label="Alexander Scourby"></div>

   With data-audio present, each chapter gets a real audio player (labelled
   reader, play/pause, a seek slider, -10s/+10s, a running time, and
   auto-advance to the next chapter). Deep links work both ways: arriving at
   #<bookslug>-<chapter>[-<verse>] opens and scrolls there, and navigating
   updates the URL, so a shared verse link lands exactly. All DOM, never
   innerHTML.

   SWAP-AWARE (the app shell, 2026-07-30): the whole reader is a boot
   function with per-boot listeners (AbortController signal), and the AUDIO
   ELEMENT itself belongs to the shell's persistent dock when one exists —
   so navigating away mid-chapter keeps the reading playing in the corner,
   and coming back rejoins it without restarting the verse. */
(function () {
  "use strict";
  var down = null;
  function boot() {
    if (down) { try { down(); } catch (_) { /* torn */ } down = null; }
    var mount = document.getElementById("bible-reader");
    if (!mount) return;
    var ctl = new AbortController();
    var sig = ctl.signal;
    down = function () {
      try { ctl.abort(); } catch (_) { /* already */ }
      if (window.mcAudioDock) window.mcAudioDock.release();
    };
    var JSON_URL = mount.getAttribute("data-json");
    var AUDIO = mount.getAttribute("data-audio") || "";
    var READER = mount.getAttribute("data-audio-label") || "";
    if (!JSON_URL) return;

    var data = null, slugIdx = {}, cur = { b: 0, c: 1 };
    var bookSel, chapWrap, title, content, player = null;
    var results = null, findT = null;
    var POS_KEY = "mc-bible-pos:" + location.pathname;
    var pendingResume = null;   // {slug, c, t} saved audio position to rejoin
    var routedOnce = false;

    function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
    function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

    /* Reader chrome styles ride an injected block (the mc-emoji-css idiom):
       token-driven so the dark theme follows automatically. */
    function ensureCss() {
      if (document.getElementById("mc-bible-css")) return;
      var s = el("style");
      s.id = "mc-bible-css";
      s.textContent =
        ".bible-find{font:inherit;margin-left:auto;min-width:11em;padding:.3em .6em;" +
        "border:1px solid var(--rule,#d9cfb8);border-radius:6px;background:var(--surface,#fffdf7);color:var(--ink,#222)}" +
        ".bible-results{border:1px solid var(--rule,#d9cfb8);border-radius:8px;margin:.6rem 0;" +
        "max-height:22em;overflow-y:auto;background:var(--surface,#fffdf7)}" +
        ".bible-sr{display:block;padding:.45em .7em;text-decoration:none;color:var(--ink,#222);" +
        "border-bottom:1px solid var(--rule,#d9cfb8)}" +
        ".bible-sr:hover{background:var(--cream,#faf6ee)}" +
        ".bible-sr-ref{color:var(--maroon,#8b1a1a);margin-right:.4em}" +
        ".bible-sr mark{background:var(--cream,#faf6ee);color:var(--maroon,#8b1a1a);font-weight:600}" +
        ".bible-sr-count{padding:.45em .7em;margin:0;color:var(--faint,#8a7f6a);font-size:.9em}" +
        ".bible-bottom{display:flex;justify-content:space-between;gap:.5em;margin:1.5rem 0 .5rem}";
      document.head.appendChild(s);
    }

    /* In-Bible word search over the loaded JSON: no network, results link
       straight to the verse through go() with the existing hit highlight. */
    function runSearch(qRaw) {
      results.textContent = "";
      var q = String(qRaw || "").trim().toLowerCase();
      if (q.length < 2) { results.hidden = true; return; }
      var CAP = 200, total = 0, rows = [];
      data.books.forEach(function (book, bi) {
        book.chapters.forEach(function (ch, ci) {
          (ch || []).forEach(function (text, vi) {
            if (!text) return;
            var low = text.toLowerCase();
            var at = low.indexOf(q);
            if (at === -1) return;
            total += 1;
            if (rows.length >= CAP) return;
            var a = el("a", "bible-sr");
            a.href = "#" + book.slug + "-" + (ci + 1) + "-" + (vi + 1);
            a.appendChild(el("b", "bible-sr-ref", book.name + " " + (ci + 1) + ":" + (vi + 1)));
            var snip = el("span");
            var from = Math.max(0, at - 40);
            var to = Math.min(text.length, at + q.length + 50);
            if (from > 0) snip.appendChild(document.createTextNode("…"));
            snip.appendChild(document.createTextNode(text.slice(from, at)));
            var mk = el("mark", null, text.slice(at, at + q.length));
            snip.appendChild(mk);
            snip.appendChild(document.createTextNode(text.slice(at + q.length, to)));
            if (to < text.length) snip.appendChild(document.createTextNode("…"));
            a.appendChild(snip);
            (function (b2, c2, v2) {
              a.addEventListener("click", function (e) { e.preventDefault(); go(b2, c2, v2); });
            })(bi, ci + 1, vi + 1);
            rows.push(a);
          });
        });
      });
      results.hidden = false;
      if (!total) {
        results.appendChild(el("p", "bible-sr-count", "No matches were found."));
        return;
      }
      results.appendChild(el("p", "bible-sr-count",
        total === 1 ? "1 verse matches this search." : total + " verses match this search."));
      rows.forEach(function (r) { results.appendChild(r); });
      if (total > CAP) {
        results.appendChild(el("p", "bible-sr-count",
          "Showing the first " + CAP + " matches. Narrow the search to see the rest."));
      }
    }

    /* Cross-session resume: the last opened chapter (and, on audio pages,
       the second within it) keyed per reader page. Deep links always win. */
    function savePos(t) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          slug: data.books[cur.b].slug, c: cur.c, t: Math.floor(t || 0),
        }));
      } catch (_) { /* blocked */ }
    }
    function readPos() {
      try {
        var v = JSON.parse(localStorage.getItem(POS_KEY));
        if (v && slugIdx[v.slug] != null) return v;
      } catch (_) { /* blocked or bad */ }
      return null;
    }

    mount.textContent = "";
    mount.appendChild(el("p", "bible-loading", "Loading the text…"));
    fetch(JSON_URL).then(function (r) { return r.json(); }).then(function (d) {
      if (sig.aborted) return;
      data = d;
      d.books.forEach(function (b, i) { slugIdx[b.slug] = i; });
      build();
    }).catch(function () { mount.textContent = "Could not load the Bible text."; });

    function build() {
      mount.textContent = "";
      var bar = el("div", "bible-bar");
      bar.appendChild(el("label", "bible-lbl", "Book"));
      bookSel = el("select", "bible-book");
      var groups = {};
      data.books.forEach(function (b, i) {
        var t = b.t === "nt" ? "New Testament" : "Old Testament";
        if (!groups[t]) { groups[t] = el("optgroup"); groups[t].label = t; bookSel.appendChild(groups[t]); }
        var o = el("option", null, b.name); o.value = i; groups[t].appendChild(o);
      });
      bookSel.addEventListener("change", function () { go(+bookSel.value, 1); });
      bar.appendChild(bookSel);
      ensureCss();
      var find = el("input", "bible-find");
      find.type = "search";
      find.placeholder = "Search the text";
      find.setAttribute("aria-label", "Search the text");
      find.addEventListener("input", function () {
        if (findT) clearTimeout(findT);
        findT = setTimeout(function () {
          findT = null;
          if (sig.aborted) return;
          runSearch(find.value);
        }, 250);
      });
      bar.appendChild(find);
      mount.appendChild(bar);
      results = el("div", "bible-results");
      results.hidden = true;
      mount.appendChild(results);

      chapWrap = el("div", "bible-chapters");
      mount.appendChild(chapWrap);
      if (AUDIO) { player = buildPlayer(); mount.appendChild(player.el); }
      title = el("h2", "bible-title");
      mount.appendChild(title);
      content = el("div", "bible-content");
      mount.appendChild(content);

      routeFromHash();
      window.addEventListener("hashchange", routeFromHash, { signal: sig });
    }

    function chapterBar(book) {
      chapWrap.textContent = "";
      var prev = el("button", "bible-step", "‹ Prev"); prev.type = "button";
      prev.addEventListener("click", function () {
        if (cur.c > 1) go(cur.b, cur.c - 1);
        else if (cur.b > 0) go(cur.b - 1, data.books[cur.b - 1].chapters.length);
      });
      chapWrap.appendChild(prev);
      var grid = el("span", "bible-chap-grid");
      var n = book.chapters.length;
      for (var i = 1; i <= n; i++) {
        var b = el("button", "bible-chap" + (i === cur.c ? " on" : ""), String(i));
        b.type = "button";
        (function (ci) { b.addEventListener("click", function () { go(cur.b, ci); }); })(i);
        grid.appendChild(b);
      }
      chapWrap.appendChild(grid);
      var next = el("button", "bible-step", "Next ›"); next.type = "button";
      next.addEventListener("click", function () {
        if (cur.c < n) go(cur.b, cur.c + 1);
        else if (cur.b < data.books.length - 1) go(cur.b + 1, 1);
      });
      chapWrap.appendChild(next);
    }

    function render(book) {
      content.textContent = "";
      (book.chapters[cur.c - 1] || []).forEach(function (text, i) {
        if (!text) return;   // sparse slot: e.g. the Vulgate Psalm split leaves 115 starting at v10
        var vn = i + 1, p = el("p", "bible-verse");
        p.id = book.slug + "-" + cur.c + "-" + vn;
        var num = el("a", "bible-vnum", vn); num.href = "#" + p.id;
        num.title = "Copy a link to this verse";
        (function (id) {
          num.addEventListener("click", function (e) {
            e.preventDefault();
            try { if (navigator.clipboard) navigator.clipboard.writeText(location.origin + location.pathname + "#" + id); } catch (_) { /* denied */ }
            if (history.replaceState) history.replaceState(null, "", "#" + id);
            num.classList.add("copied");
            setTimeout(function () { num.classList.remove("copied"); }, 1200);
          });
        })(p.id);
        p.appendChild(num);
        p.appendChild(document.createTextNode(" " + text));
        content.appendChild(p);
      });
      /* A second Prev/Next pair at the chapter's foot: finishing a chapter
         must never mean scrolling all the way back up. Lives inside content,
         so it re-renders with every chapter. */
      var bottom = el("div", "bible-bottom");
      var bPrev = el("button", "bible-step", "‹ Prev"); bPrev.type = "button";
      bPrev.addEventListener("click", function () {
        if (cur.c > 1) go(cur.b, cur.c - 1);
        else if (cur.b > 0) go(cur.b - 1, data.books[cur.b - 1].chapters.length);
      });
      var bNext = el("button", "bible-step", "Next ›"); bNext.type = "button";
      bNext.addEventListener("click", function () {
        var n2 = book.chapters.length;
        if (cur.c < n2) go(cur.b, cur.c + 1);
        else if (cur.b < data.books.length - 1) go(cur.b + 1, 1);
      });
      bottom.appendChild(bPrev);
      bottom.appendChild(bNext);
      content.appendChild(bottom);
    }

    var quiet = false;   // true while WE set the hash, so it doesn't re-route
    function go(b, c, v, autoplay) {
      if (b < 0 || b >= data.books.length) return;
      var book = data.books[b];
      c = Math.max(1, Math.min(c || 1, book.chapters.length));
      cur.b = b; cur.c = c;
      bookSel.value = b;
      chapterBar(book);
      title.textContent = book.name + " " + c;
      render(book);
      if (player) player.set(book, c, autoplay);
      savePos(0);
      quiet = true;
      var hash = "#" + book.slug + "-" + c + (v ? "-" + v : "");
      if (history.replaceState) history.replaceState(null, "", hash); else location.hash = hash;
      quiet = false;
      if (v) {
        var vn = document.getElementById(book.slug + "-" + c + "-" + v);
        if (vn) { vn.scrollIntoView({ block: "center" }); vn.classList.add("bible-hit"); setTimeout(function () { vn.classList.remove("bible-hit"); }, 2600); }
      } else {
        var top = mount.getBoundingClientRect().top + window.pageYOffset - 8;
        window.scrollTo(0, Math.max(0, top));
      }
    }

    function routeFromHash() {
      if (quiet) return;
      var r = parseHash(decodeURIComponent(location.hash.slice(1)));
      /* First route only: with no deep link, reopen where the reader left
         off last session (a deep link always wins). Later hash changes keep
         the plain Genesis 1 fallback. */
      if (!r && !routedOnce) {
        var pos = readPos();
        if (pos) {
          routedOnce = true;
          if (pos.t > 5) pendingResume = pos;
          go(slugIdx[pos.slug], pos.c);
          return;
        }
      }
      routedOnce = true;
      if (r) go(r.b, r.c, r.v);
      else go(0, 1);
    }
    function parseHash(h) {
      if (!h) return null;
      var m = h.match(/^(.+)-(\d+)-(\d+)$/);   // book-chapter-verse
      if (m && slugIdx[m[1]] != null) return { b: slugIdx[m[1]], c: +m[2], v: +m[3] };
      m = h.match(/^(.+)-(\d+)$/);             // book-chapter
      if (m && slugIdx[m[1]] != null) return { b: slugIdx[m[1]], c: +m[2], v: 0 };
      if (slugIdx[h] != null) return { b: slugIdx[h], c: 1, v: 0 };   // book only
      return null;
    }

    /* Continuous ("keep reading") play, shared with the shell's audio dock via
       localStorage so the one setting governs both. Default on. */
    function contOn() { try { return localStorage.getItem("mc-audio-continuous") !== "0"; } catch (e) { return true; } }

    function buildPlayer() {
      var wrap = el("div", "bible-player");
      /* The dock owns the ELEMENT when the shell is present, so the sound
         survives navigation; only these controls and listeners are ours,
         and they die with this boot's signal. */
      var dock = window.mcAudioDock || null;
      var audio = dock ? dock.audio : new Audio();
      audio.preload = "none";
      /* Playback speed, remembered per browser. defaultPlaybackRate too, so
         the rate survives every src change including the dock's own chapter
         stepping after this page is swapped away. */
      var RATES = [1, 1.25, 1.5, 2];
      var rate = 1;
      try { var r0 = parseFloat(localStorage.getItem("mc-audio-rate")); if (RATES.indexOf(r0) !== -1) rate = r0; } catch (_) { /* blocked */ }
      function applyRate() { audio.playbackRate = rate; audio.defaultPlaybackRate = rate; }
      applyRate();
      function expectedSrc() { return AUDIO + "/" + data.books[cur.b].slug + "/" + cur.c + ".mp3"; }
      var play = el("button", "bp-play", audio.paused ? "▶" : "❙❙"); play.type = "button"; play.title = "Play / pause";
      var back = el("button", "bp-skip", "«10"); back.type = "button"; back.title = "Back 10 seconds";
      var fwd = el("button", "bp-skip", "10»"); fwd.type = "button"; fwd.title = "Forward 10 seconds";
      var seek = el("input", "bp-seek"); seek.type = "range"; seek.min = 0; seek.max = 1000; seek.value = 0; seek.setAttribute("aria-label", "Seek");
      var time = el("span", "bp-time", "0:00 / 0:00");
      var label = el("div", "bp-label");
      var seeking = false, dockBooks = null;
      play.addEventListener("click", function () { if (audio.paused) audio.play().catch(function () {}); else audio.pause(); });
      back.addEventListener("click", function () { audio.currentTime = Math.max(0, audio.currentTime - 10); });
      fwd.addEventListener("click", function () { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
      seek.addEventListener("input", function () { seeking = true; if (audio.duration) time.textContent = fmt(seek.value / 1000 * audio.duration) + " / " + fmt(audio.duration); });
      seek.addEventListener("change", function () { if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; });
      audio.addEventListener("timeupdate", function () {
        if (!audio.duration || seeking) return;
        seek.value = audio.currentTime / audio.duration * 1000;
        time.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration);
      }, { signal: sig });
      audio.addEventListener("play", function () { play.textContent = "❙❙"; applyRate(); }, { signal: sig });
      audio.addEventListener("pause", function () {
        play.textContent = "▶";
        if (!sig.aborted && audio.src === expectedSrc()) savePos(audio.currentTime);
      }, { signal: sig });
      /* Save the audio position every ~5s while THIS chapter plays — never
         while the dock plays some other chapter under this page. */
      var lastSave = 0;
      audio.addEventListener("timeupdate", function () {
        if (sig.aborted || audio.src !== expectedSrc()) return;
        var now = Date.now();
        if (now - lastSave < 5000) return;
        lastSave = now;
        savePos(audio.currentTime);
      }, { signal: sig });
      /* Rejoin a saved position: armed by the first-route restore, applied
         once the metadata lands (preload is none, so this fires on first play). */
      var pendingT = 0;
      audio.addEventListener("loadedmetadata", function () {
        if (pendingT > 0 && audio.duration && pendingT < audio.duration - 3) {
          try { audio.currentTime = pendingT; } catch (_) { /* not seekable */ }
        }
        pendingT = 0;
      }, { signal: sig });
      audio.addEventListener("ended", function () {
        play.textContent = "▶";
        if (!contOn()) return;   // continuous play off: stop at the end of this chapter
        var book = data.books[cur.b];
        if (cur.c < book.chapters.length) go(cur.b, cur.c + 1, 0, true);
        else if (cur.b < data.books.length - 1) go(cur.b + 1, 1, 0, true);
      }, { signal: sig });
      var cont = el("button", "bp-cont" + (contOn() ? " on" : ""), "🔁"); cont.type = "button";
      cont.title = "Continuous play — keep reading into the next chapter"; cont.setAttribute("aria-label", "Continuous play");
      cont.setAttribute("aria-pressed", contOn() ? "true" : "false");
      cont.addEventListener("click", function () {
        var next = !contOn();
        try { localStorage.setItem("mc-audio-continuous", next ? "1" : "0"); } catch (e) { /* blocked */ }
        cont.classList.toggle("on", next); cont.setAttribute("aria-pressed", next ? "true" : "false");
      });
      var rateBtn = el("button", "bp-skip bp-rate", rate + "×"); rateBtn.type = "button";
      rateBtn.title = "Playback speed";
      rateBtn.addEventListener("click", function () {
        rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
        try { localStorage.setItem("mc-audio-rate", String(rate)); } catch (_) { /* blocked */ }
        rateBtn.textContent = rate + "×";
        applyRate();
      });
      var row = el("div", "bp-row");
      [play, back, seek, fwd, cont, rateBtn, time].forEach(function (n) { row.appendChild(n); });
      wrap.appendChild(label); wrap.appendChild(row);
      return {
        el: wrap,
        set: function (book, c, autoplay) {
          var src = AUDIO + "/" + book.slug + "/" + c + ".mp3";
          var text = "♪ " + (READER ? READER + " — " : "") + book.name + " " + c;
          label.textContent = text;
          /* Rejoining the chapter that is ALREADY playing (a soft return to
             this page) must not restart the verse: leave src and position
             alone, just re-adopt the display. */
          if (audio.src !== src) {
            var was = !audio.paused;
            audio.src = src;
            applyRate();
            /* A saved mid-chapter position for THIS chapter rejoins on load. */
            if (pendingResume && pendingResume.slug === book.slug && pendingResume.c === c && pendingResume.t > 5) {
              pendingT = pendingResume.t;
            }
            pendingResume = null;
            seek.value = 0; time.textContent = "0:00 / 0:00";
            if (autoplay || was) audio.play().catch(function () {});
          } else if (audio.duration) {
            seek.value = audio.currentTime / audio.duration * 1000;
            time.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration);
          }
          /* Hand the dock the whole book table + position so it can step
             chapters, auto-advance, and link back to this reader on its own
             once this page is swapped away. Built once, reused. */
          if (dock) {
            if (!dockBooks) dockBooks = data.books.map(function (bk) {
              return { slug: bk.slug, name: bk.name, chapters: bk.chapters.length };
            });
            dock.claim({ books: dockBooks, audioBase: AUDIO, page: location.pathname, reader: READER, b: cur.b, c: c });
          }
        }
      };
    }
  }
  window.mcBibleBoot = boot;
  window.mcBibleTeardown = function () { if (down) { var d = down; down = null; try { d(); } catch (_) { /* torn */ } } };
  boot();
})();
