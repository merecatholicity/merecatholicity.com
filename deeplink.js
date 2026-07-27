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
   id as `<heading-id>__p<n>`. All DOM, never innerHTML. */
(function () {
  "use strict";
  if (!document.querySelector(".unnumbered")) return;  // hand-authored page

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
  var isKJV = /(^|\/)kjv\.html$/.test(location.pathname);

  function inChrome(el) {          // skip site nav, the pandoc TOC, the footer
    return el.closest("nav, header, footer, #TOC");
  }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  // --- assign ids and collect anchorable elements ----------------------
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

  var curHeadId = null, paraN = 0;         // for Fathers-style paragraph ids
  var bookIdx = -1;                        // for KJV verse ids (h2 order)
  var anchorables = [];
  for (var k = 0; k < nodes.length; k++) {
    var node = nodes[k];
    if (inChrome(node)) continue;
    var tag = node.tagName;
    if (tag !== "P") {                      // a heading
      if (isKJV && tag === "H2") bookIdx++;
      if (node.id) used[node.id] = true;    // keep pandoc's slug (TOC needs it)
      else node.id = unique(slugify(node.textContent));
      curHeadId = node.id; paraN = 0;
      anchorables.push({ el: node, id: node.id });
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

  function verseId(p) {                     // <strong>C:V</strong> at start
    var s = p.firstElementChild;
    if (!s || s.tagName !== "STRONG") return null;
    var m = /^(\d+):(\d+)\.?$/.exec((s.textContent || "").trim());
    if (!m || bookIdx < 0 || bookIdx >= SLUGS.length) return null;
    return SLUGS[bookIdx] + "-" + m[1] + "-" + m[2];
  }
  function slugify(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 60);
  }

  // --- the ¶ markers (hover on desktop, tap-visible on touch) -----------
  // One delegated click handler for all of them, not thousands of listeners.
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
  // ids were just assigned, so the browser hasn't scrolled — do it now.
  if (location.hash) setTimeout(reveal, 0);
  window.addEventListener("hashchange", reveal);
})();
