#!/usr/bin/env python3
"""Build merecat's corpus from the repo and push it to the worker.

Reads works.yml (what the bot knows), persona.md (how it speaks), and
config.yml (its dials), turns every listed work into anchored chunks, and
pushes the lot to the admin-keyed /api/merecat endpoints. Incremental: a
work is re-pushed only when its source bytes, its manifest entry, or this
parser's version changed (the content hash on the server is the state, so
an interrupted push simply resumes on the next run). Works removed from
works.yml are pruned from the server.

  python ingest.py                  # dry run: parse, count, validate anchors
  python ingest.py --push           # push config + persona + changed works
  python ingest.py --push --tiers 1,2
  python ingest.py --push --only anf01,anf02
  python ingest.py --budget-rows 90000   # stop before D1's daily write cap

The admin key (the raw board key of an admin identity) comes from the
MC_ADMIN_KEY environment variable or the git-ignored file librarian/.key.

Anchors are the load-bearing part: every chunk carries the URL fragment a
citation lands on. Pandoc pages keep their static heading ids; paragraph
precision replays deeplink.js's id walk (h1.unnumbered + h2-h6 + p in
document order, paraN resetting at each heading -> <heading-id>__p<n>) —
THIS WALK MUST MIRROR deeplink.js; change them together. Bible anchors come
straight from kjv.json/dr.json the way bible-reader.js resolves them.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
PARSER_VERSION = "1"          # bump to force a full re-ingest
TARGET = 350                  # words a chunk aims for
HARD_MAX = 480                # words a chunk never exceeds
API_DEFAULT = "https://merecatholicity.com/api/merecat"
VEC_BUDGET = 4800             # free Vectorize: ~4,880 vectors at 1024 dims

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "source", "track", "wbr"}
ID_RE = re.compile(r'(?:id|name)\s*=\s*["\']([^"\']+)["\']')
SENT_RE = re.compile(r"(?<=[.!?])\s+")


def words(s):
    return len(s.split())


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


# --- the deeplink.js walk, replayed offline (see the module docstring) ------
class PandocWalk(HTMLParser):
    """Yields the same heading/paragraph stream deeplink.js walks, with the
    same ids: headings keep their static id (or get deeplink's slugify), and
    every <p> outside nav/header/footer/#TOC gets <heading-id>__p<n>."""

    def __init__(self, static_ids):
        super().__init__(convert_charrefs=True)
        self.static_ids = static_ids
        self.used = set()
        self.events = []          # ('h', level, id, text) | ('p', anchor, text)
        self.depth = 0
        self.skip_from = None     # depth at which a nav/header/footer/#TOC began
        self.cap = None           # ('h', level, id) | ('p',) while capturing
        self.buf = []
        self.cur_head = ""
        self.para_n = 0

    def taken(self, i):
        return i in self.used or i in self.static_ids or ("toc-" + i) in self.static_ids

    def unique(self, i):
        base = i or "sec"
        i, n = base, 2
        while self.taken(i):
            i = base + "-" + str(n)
            n += 1
            if n > 999:
                break
        self.used.add(i)
        return i

    @staticmethod
    def slugify(t):
        return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", t.lower()))[:60]

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag not in VOID:
            self.depth += 1
            if self.skip_from is None and (
                tag in ("nav", "header", "footer") or a.get("id") == "TOC"
            ):
                self.skip_from = self.depth
        if self.skip_from is not None:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            cls = a.get("class", "")
            if tag == "h1" and "unnumbered" not in cls.split():
                return                      # the doc-title h1, as in deeplink
            self._flush()
            hid = a.get("id", "")
            if hid:
                self.used.add(hid)          # keep the static slug verbatim
            self.cap = ("h", int(tag[1]), hid)
            self.buf = []
        elif tag == "p":
            self._flush()
            self.cap = ("p",)
            self.buf = []

    def handle_endtag(self, tag):
        if self.skip_from is not None:
            if tag not in VOID:
                self.depth -= 1
                if self.depth < self.skip_from:
                    self.skip_from = None
            return
        if tag not in VOID:
            self.depth -= 1
        if (tag.startswith("h") and self.cap and self.cap[0] == "h") or (
            tag == "p" and self.cap and self.cap[0] == "p"
        ):
            self._flush()

    def handle_data(self, data):
        if self.cap and self.skip_from is None:
            self.buf.append(data)

    def _flush(self):
        if not self.cap:
            return
        kind, text = self.cap[0], norm("".join(self.buf))
        if kind == "h":
            _, level, hid = self.cap
            if not hid:
                hid = self.unique(self.slugify(text))
            self.cur_head = hid
            self.para_n = 0
            if text:
                self.events.append(("h", level, hid, text))
        else:
            self.para_n += 1
            anchor = self.unique((self.cur_head or "p") + "__p" + str(self.para_n))
            if text:
                self.events.append(("p", anchor, text))
        self.cap, self.buf = None, []


# --- hand-authored pages: semantic-id sections ------------------------------
class HandWalk(HTMLParser):
    """Sections keyed by the page's own semantic ids (headings, and table
    rows like objections.html's <tr id="o1">). Table rows flatten to one
    line per row. nav/footer/scripts/the comments section are skipped."""

    SKIP_TAGS = ("nav", "header", "footer", "script", "style", "noscript")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sections = []        # [anchor, heading, [para, ...]]
        self.depth = 0
        self.skip_from = None
        self.buf = None           # active text buffer (paragraph-ish)
        self.cells = None         # cells of the open <tr>
        self.heading_cap = None
        self.row_strong = None    # first <strong> text in the row = its title
        self.strong_cap = None
        self.cur_heading = ""
        self._section("", "")

    def _section(self, anchor, heading):
        self.sections.append([anchor, heading, []])

    def _emit(self, text):
        text = norm(text)
        if text:
            self.sections[-1][2].append(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "")
        if tag not in VOID:
            self.depth += 1
            if self.skip_from is None and (
                tag in self.SKIP_TAGS
                or (tag == "section" and "comments" in cls)
                or (tag == "ul" and "credo-toc" in cls)
            ):
                self.skip_from = self.depth
        if self.skip_from is not None:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.heading_cap = a.get("id", "")
            self.buf = []
        elif tag == "tr":
            self.cells = []
            self.row_strong = None
            if a.get("id"):
                self._section(a["id"], "")   # heading filled from the row's <strong>
        elif tag in ("td", "th"):
            self.buf = []
        elif tag == "strong" and self.cells is not None and self.row_strong is None:
            self.strong_cap = []
        elif tag in ("p", "li", "dt", "dd", "figcaption") and self.cells is None:
            self.buf = []

    def handle_endtag(self, tag):
        if self.skip_from is not None:
            if tag not in VOID:
                self.depth -= 1
                if self.depth < self.skip_from:
                    self.skip_from = None
            return
        if tag not in VOID:
            self.depth -= 1
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self.buf is not None:
            text = norm("".join(self.buf))
            self.cur_heading = text
            self._section(self.heading_cap or "", text)
            self.heading_cap, self.buf = None, None
        elif tag == "strong" and self.strong_cap is not None:
            self.row_strong = norm("".join(self.strong_cap))
            self.strong_cap = None
        elif tag in ("td", "th") and self.buf is not None:
            t = norm("".join(self.buf))
            if self.cells is not None and t:
                self.cells.append(t)
            self.buf = None
        elif tag == "tr" and self.cells is not None:
            if self.sections[-1][1] == "" and self.row_strong:
                self.sections[-1][1] = self.row_strong
            self._emit(" — ".join(self.cells))
            self.cells = None
        elif tag in ("p", "li", "dt", "dd", "figcaption") and self.buf is not None:
            self._emit("".join(self.buf))
            self.buf = None

    def handle_data(self, data):
        if self.skip_from is not None:
            return
        if self.strong_cap is not None:
            self.strong_cap.append(data)
        if self.buf is not None:
            self.buf.append(data)


# --- chunking ---------------------------------------------------------------
def split_long(text):
    """Break one overlong paragraph at sentence borders into TARGET-ish runs."""
    parts, cur, n = [], [], 0
    for sent in SENT_RE.split(text):
        w = words(sent)
        if cur and n + w > TARGET:
            parts.append(" ".join(cur))
            cur, n = [], 0
        cur.append(sent)
        n += w
    if cur:
        parts.append(" ".join(cur))
    return parts


def pack(paras):
    """Greedy-pack (anchor, text) paragraphs into chunks under HARD_MAX words.
    Returns [(anchor_of_first_para, text)]."""
    out, cur, n = [], [], 0
    for anchor, text in paras:
        for piece in split_long(text) if words(text) > HARD_MAX else [text]:
            w = words(piece)
            if cur and n + w > TARGET and n >= TARGET // 2:
                out.append((cur[0][0], " ".join(t for _, t in cur)))
                cur, n = [], 0
            cur.append((anchor, piece))
            n += w
    if cur:
        out.append((cur[0][0], " ".join(t for _, t in cur)))
    return out


def crumb(stack):
    names = [t for _, t in sorted(stack.items())][-2:]
    return " > ".join(names)[:140]


def build_pandoc(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    static_ids = set(ID_RE.findall(src))
    w = PandocWalk(static_ids)
    w.feed(src)
    w._flush()
    chunks, stack, section, sec_head, first_anchor = [], {}, [], "", ""

    def close():
        for i, (anchor, text) in enumerate(pack(section)):
            a = first_anchor if i == 0 and first_anchor else anchor
            chunks.append({"heading": sec_head, "anchor": a, "text": text})
        section.clear()

    for ev in w.events:
        if ev[0] == "h":
            _, level, hid, text = ev
            close()
            for l in [l for l in stack if l >= level]:
                del stack[l]
            stack[level] = text
            sec_head, first_anchor = crumb(stack), hid
        else:
            _, anchor, text = ev
            section.append((anchor, text))
    close()
    valid = static_ids | w.used
    return chunks, valid


def build_hand(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    w = HandWalk()
    w.feed(src)
    chunks = []
    page_head = next((h for _, h, _ in w.sections if h), "")
    for anchor, heading, paras in w.sections:
        if not paras:
            continue
        head = heading if heading else page_head
        for a, text in pack([(anchor, p) for p in paras]):
            chunks.append({"heading": head[:140], "anchor": a, "text": text})
    return chunks, set(ID_RE.findall(src))


def build_bible(path):
    data = json.load(open(path, encoding="utf-8"))
    chunks = []
    for book in data["books"]:
        for ci, verses in enumerate(book["chapters"], 1):
            paras = []
            for vi, text in enumerate(verses, 1):
                if not text:
                    continue          # sparse Vulgate slots, as in bible-reader.js
                anchor = book["slug"] + "-" + str(ci) + ("-" + str(vi) if vi > 1 else "")
                paras.append((anchor, str(vi) + " " + text))
            for a, text in pack(paras):
                chunks.append({"heading": book["name"] + " " + str(ci),
                               "anchor": a, "text": text})
    return chunks, None                # anchors valid by construction


def build_text(path, title):
    src = open(path, encoding="utf-8", errors="replace").read()
    paras = [("", norm(p)) for p in re.split(r"\n\s*\n", src) if norm(p)]
    return [{"heading": title[:140], "anchor": a, "text": t}
            for a, t in pack(paras)], None


def build(entry):
    path = os.path.join(HERE, entry["src"])
    kind = entry["kind"]
    if kind == "pandoc":
        chunks, valid = build_pandoc(path)
    elif kind == "hand":
        chunks, valid = build_hand(path)
    elif kind == "bible":
        chunks, valid = build_bible(path)
    elif kind == "text":
        chunks, valid = build_text(path, entry["title"])
    else:
        sys.exit(f"unknown kind {kind!r}")
    bad = []
    if valid is not None:
        for c in chunks:
            a = c["anchor"]
            base = a.split("__p")[0]
            # a heading anchor must be a static id; a __pN anchor must have
            # come through the replayed walk (valid covers both sets)
            if a and a not in valid and base not in valid:
                bad.append(a)
    return chunks, bad


def audit_library(manifest):
    """The shelf audit: warn when library.html offers a work this manifest
    lacks, so the daily push always names what the bot is still missing."""
    try:
        src = open(os.path.join(HERE, "..", "library.html"), encoding="utf-8").read()
    except OSError:
        return
    hrefs = set(re.findall(r'<a href="([a-z0-9-]+\.html)">Read online', src))
    # a work may ingest from a different source than the page it cites
    # (the KJV chunks from kjv.json but the shelf links kjv.html), so both count
    have = {os.path.basename(e["src"]) for e in manifest.values()}
    have |= {os.path.basename(e["url"]) for e in manifest.values()}
    ignored = {"douay-rheims.html"}   # deliberately excluded: the KJV serves
    missing = sorted(hrefs - have - ignored)
    if missing:
        print(f"\nNOTE: library.html lists {len(missing)} work(s) absent from works.yml:")
        for h in missing:
            print("  " + h)
        print("Add an entry for each (or exclude deliberately) so the shelf and the bot stay in step.")


def content_hash(entry):
    h = hashlib.sha256()
    h.update(PARSER_VERSION.encode())
    h.update(json.dumps(entry, sort_keys=True).encode())
    with open(os.path.join(HERE, entry["src"]), "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# --- push -------------------------------------------------------------------
def admin_key():
    key = os.environ.get("MC_ADMIN_KEY", "")
    keyfile = os.path.join(HERE, ".key")
    if not key and os.path.exists(keyfile):
        key = open(keyfile).read().strip()
    if not key:
        sys.exit("no admin key: set MC_ADMIN_KEY or write librarian/.key "
                 "(your board key, Show my key on the Community page)")
    return key


def post(api, path, body, tries=6):
    # the zone's bot protection challenges the default python-urllib agent
    # (curl passes), so wear a plain tool UA. Ask nicely: on any refusal or
    # hiccup, back off with growing patience (up to two minutes) before
    # giving up — transient throttles pass if we stop knocking for a while,
    # and a genuinely failed run just resumes on the next invocation.
    req = urllib.request.Request(api + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "curl/8.14.1"})
    waits = [3, 9, 27, 60, 120]
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                out = json.loads(r.read())
            if not out.get("ok"):
                raise RuntimeError(out.get("error", "server said no"))
            return out
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"    retry {i + 1} in {waits[i]}s: {e}", flush=True)
            time.sleep(waits[i])


def push_work(api, key, wid, entry, chunks, chash):
    vec = bool(entry.get("vectorize"))
    workmeta = {"id": wid, "title": entry["title"], "url": entry["url"],
                "tier": entry["tier"], "kind": entry["kind"]}
    post(api, "/ingest", {"key": key, "mode": "begin", "work": workmeta})
    # modest bodies: the free plan's per-request CPU allowance is small, and
    # JSON parsing is the ingest endpoint's main CPU cost
    batch = 100 if vec else 250
    for i in range(0, len(chunks), batch):
        rows = [{"cid": f"{wid}#{i + j}", "seq": i + j, **c}
                for j, c in enumerate(chunks[i:i + batch])]
        post(api, "/ingest", {"key": key, "mode": "append", "work": workmeta,
                              "chunks": rows, "vectorize": vec})
        print(f"    {min(i + batch, len(chunks))}/{len(chunks)}", flush=True)
        time.sleep(0.3)
    post(api, "/ingest", {"key": key, "mode": "end",
                          "work": {"id": wid, "hash": chash, "chunks": len(chunks)}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="push to the worker")
    ap.add_argument("--only", default="", help="comma list of work ids")
    ap.add_argument("--tiers", default="", help="comma list of tiers, e.g. 1,2")
    ap.add_argument("--budget-rows", type=int, default=90000,
                    help="stop before this many estimated D1 row writes")
    ap.add_argument("--api", default=API_DEFAULT)
    args = ap.parse_args()

    manifest = yaml.safe_load(open(os.path.join(HERE, "works.yml")))["works"]
    only = set(x for x in args.only.split(",") if x)
    tiers = set(int(x) for x in args.tiers.split(",") if x)
    picked = {wid: e for wid, e in manifest.items()
              if (not only or wid in only) and (not tiers or e["tier"] in tiers)}

    if not args.push:
        total, vec_total, waiting = 0, 0, 0
        for wid, entry in picked.items():
            if not os.path.exists(os.path.join(HERE, entry["src"])):
                waiting += 1
                print(f"{wid:22} t{entry['tier']} waiting (source not yet built)")
                continue
            chunks, bad = build(entry)
            total += len(chunks)
            if entry.get("vectorize"):
                vec_total += len(chunks)
            flag = f"  BAD ANCHORS: {bad[:3]}" if bad else ""
            print(f"{wid:22} t{entry['tier']} {entry['kind']:6} "
                  f"{len(chunks):6} chunks{flag}")
        print(f"\n{total} chunks total, {vec_total} vectorized "
              f"(budget {VEC_BUDGET})"
              + (f", {waiting} work(s) waiting on their build" if waiting else ""))
        if vec_total > VEC_BUDGET:
            print("WARNING: over the free Vectorize budget")
        audit_library(manifest)
        return

    key = admin_key()
    # Config + persona ride every push (idempotent, cheap).
    persona = open(os.path.join(HERE, "persona.md"), encoding="utf-8").read()
    cfg = yaml.safe_load(open(os.path.join(HERE, "config.yml")))
    post(args.api, "/config", {"key": key, "persona": persona, "config": cfg})
    print("config + persona pushed")

    roster = post(args.api, "/works", {"key": key})
    server = {w["id"]: w for w in roster["works"]}
    # early warning on D1's 500 MB per-database cap: the database runs about
    # 2.1x the stored text (search index and btrees); past ~450 MB projected,
    # split bands 5-6 into a second database (the designed relief valve)
    db_mb = roster.get("text_bytes", 0) * 2.09 / 1e6
    print(f"database projection: ~{db_mb:.0f} MB of 500"
          + ("  << NEARING THE CAP: time to split the deep shelf" if db_mb > 450 else ""))

    # Prune works that left the manifest (only on unfiltered runs, so a
    # --only/--tiers pass never mistakes filtering for removal).
    if not only and not tiers:
        for wid in [w for w in server if w not in manifest]:
            print(f"pruning {wid} (no longer in works.yml)")
            post(args.api, "/ingest", {"key": key, "mode": "delete",
                                       "work": {"id": wid}})

    vec_total = sum(server[w]["chunks"] for w in server
                    if w in manifest and manifest[w].get("vectorize"))
    spent = 0
    waiting = 0
    for wid, entry in picked.items():
        if not os.path.exists(os.path.join(HERE, entry["src"])):
            waiting += 1
            continue          # not built yet: a later daily run picks it up
        chash = content_hash(entry)
        if server.get(wid, {}).get("hash") == chash:
            continue
        print(f"{wid}: building...", flush=True)
        chunks, bad = build(entry)
        if bad:
            sys.exit(f"{wid}: {len(bad)} bad anchors, first: {bad[:5]}")
        est = len(chunks) * 5          # row + FTS shadow writes, roughly
        if spent + est > args.budget_rows:
            print(f"stopping before {wid}: {est} est. rows would pass the "
                  f"daily budget ({spent} spent). Re-run tomorrow to resume.")
            break
        push_work(args.api, key, wid, entry, chunks, chash)
        spent += est
        print(f"{wid}: pushed {len(chunks)} chunks")
    print(f"done ({spent} est. rows written"
          + (f", {waiting} work(s) waiting on their build" if waiting else "") + ")")
    audit_library(manifest)


if __name__ == "__main__":
    main()
