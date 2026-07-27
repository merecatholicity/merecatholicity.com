/* Chapter-level audio for the King James pages: George W. Scourby's public-
   domain reading, one MP3 per chapter, self-hosted on R2 and served from
   audio.merecatholicity.com. A play button is grafted onto every chapter
   heading; one shared <audio> element plays the chapter and, when it ends,
   rolls on to the next so a reader can follow straight through. Desktop and
   mobile: a single element, playback always started by a user gesture. */
(function () {
  "use strict";
  var BASE = "https://audio.merecatholicity.com/kjv";
  // The 66 books in canonical order -- the h2 book headings on the page run
  // in this same order, so the nth book heading maps to SLUGS[n].
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
  var PLAY = "▶", PAUSE = "❙❙";

  function css() {
    var s = document.createElement("style");
    s.textContent =
      ".kjv-play{font:inherit;cursor:pointer;border:1px solid var(--rule,#d8ccb4);" +
      "background:#faf6ee;color:var(--maroon,#7b2e2e);border-radius:4px;" +
      "padding:0 .45em;margin-right:.5em;line-height:1.5;vertical-align:middle;" +
      "font-size:.8em;}" +
      ".kjv-play:hover{background:var(--maroon,#7b2e2e);color:#faf6ee;}" +
      ".kjv-playing{color:var(--maroon,#7b2e2e);}";
    document.head.appendChild(s);
  }

  function init() {
    css();
    var audio = new Audio();
    audio.preload = "none";
    var chapters = [];
    var book = -1, current = -1;
    var heads = document.querySelectorAll("h2, h4");
    for (var i = 0; i < heads.length; i++) {
      var el = heads[i];
      if (el.tagName === "H2") { book++; continue; }
      var m = /Chapter\s+(\d+)/.exec(el.textContent || "");
      if (!m || book < 0 || book >= SLUGS.length) continue;
      var idx = chapters.length;
      var url = BASE + "/" + SLUGS[book] + "/" + m[1] + ".mp3";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kjv-play";
      btn.textContent = PLAY;
      btn.setAttribute("aria-label", "Play this chapter aloud");
      btn.setAttribute("data-audio", url);
      (function (j) { btn.addEventListener("click", function () { toggle(j); }); })(idx);
      el.insertBefore(btn, el.firstChild);
      chapters.push({ url: url, el: el, btn: btn });
    }
    if (!chapters.length) return;

    function mark(i, on) {
      if (i < 0) return;
      chapters[i].btn.textContent = on ? PAUSE : PLAY;
      chapters[i].el.classList.toggle("kjv-playing", on);
    }
    function play(i) {
      if (current !== i) { mark(current, false); current = i; audio.src = chapters[i].url; }
      audio.play().catch(function () {});
    }
    function toggle(i) {
      if (current === i && !audio.paused) { audio.pause(); return; }
      play(i);
    }
    audio.addEventListener("play", function () { mark(current, true); });
    audio.addEventListener("pause", function () { mark(current, false); });
    audio.addEventListener("ended", function () {
      mark(current, false);
      if (current + 1 < chapters.length) play(current + 1);
      else current = -1;
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
