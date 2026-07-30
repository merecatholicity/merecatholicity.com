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

    function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
    function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

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
      mount.appendChild(bar);

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

    function buildPlayer() {
      var wrap = el("div", "bible-player");
      /* The dock owns the ELEMENT when the shell is present, so the sound
         survives navigation; only these controls and listeners are ours,
         and they die with this boot's signal. */
      var dock = window.mcAudioDock || null;
      var audio = dock ? dock.audio : new Audio();
      audio.preload = "none";
      var play = el("button", "bp-play", audio.paused ? "▶" : "❙❙"); play.type = "button"; play.title = "Play / pause";
      var back = el("button", "bp-skip", "«10"); back.type = "button"; back.title = "Back 10 seconds";
      var fwd = el("button", "bp-skip", "10»"); fwd.type = "button"; fwd.title = "Forward 10 seconds";
      var seek = el("input", "bp-seek"); seek.type = "range"; seek.min = 0; seek.max = 1000; seek.value = 0; seek.setAttribute("aria-label", "Seek");
      var time = el("span", "bp-time", "0:00 / 0:00");
      var label = el("div", "bp-label");
      var seeking = false;
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
      audio.addEventListener("play", function () { play.textContent = "❙❙"; }, { signal: sig });
      audio.addEventListener("pause", function () { play.textContent = "▶"; }, { signal: sig });
      audio.addEventListener("ended", function () {
        play.textContent = "▶";
        var book = data.books[cur.b];
        if (cur.c < book.chapters.length) go(cur.b, cur.c + 1, 0, true);
        else if (cur.b < data.books.length - 1) go(cur.b + 1, 1, 0, true);
      }, { signal: sig });
      var row = el("div", "bp-row");
      [play, back, seek, fwd, time].forEach(function (n) { row.appendChild(n); });
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
            seek.value = 0; time.textContent = "0:00 / 0:00";
            if (autoplay || was) audio.play().catch(function () {});
          } else if (audio.duration) {
            seek.value = audio.currentTime / audio.duration * 1000;
            time.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration);
          }
          if (dock) dock.claim(text);
        }
      };
    }
  }
  window.mcBibleBoot = boot;
  window.mcBibleTeardown = function () { if (down) { var d = down; down = null; try { d(); } catch (_) { /* torn */ } } };
  boot();
})();
