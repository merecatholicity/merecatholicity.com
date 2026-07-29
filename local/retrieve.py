"""The five-legged retrieval, ported from comments-worker/src/index.js.

Semantic (numpy cosine over the WHOLE corpus — the local upgrade), a
tier-weighted BM25 leg, a raw BM25 leg, a stride-1 five-gram phrase leg, and
a verse-seat leg, merged into one pool, reranked, with guaranteed phrase and
verse seats. The tokenizers, the Bible table, the DR slug map, the weight
ladder, and the tier labels are line-for-line the worker's.
"""
import os
import re

import numpy as np

import llm

# --- the weight ladder (index.js:2965) and labels (index.js:2603) ----------
WEIGHT = {1: 1.6, 2: 1.45, 6: 1.4, 3: 1.35, 4: 1.25, 9: 1.3,
          8: 1.55, 7: 0.9, 5: 1.0}
TIER_LABEL = {
    1: "site position", 2: "scripture", 3: "the Fathers",
    4: "councils, confessions, and the schism", 5: "deep shelf", 6: "Newman",
    7: "the Roman world", 8: "the worldview shelf", 9: "the scholars' shelf",
}

MERECAT_STOP = set((
    "a about all an and any are as at be been but by can could did do does for from had has have "
    "he her his how i if in into is it its just like me my no not of on one or our out over say says said she should so some "
    "than that the their them then there these they this to under up us was we were what when where which who why will with "
    "would you your").split(" "))

_TOKEN = re.compile(r'"([^"]*)"|([A-Za-z0-9À-ɏ’\']+)')
_WORD = re.compile(r"[A-Za-z0-9À-ɏ’']+")


def merecat_match(q):
    """Question -> safe FTS5 MATCH: user-quoted phrases kept whole, stopwords
    dropped, <=16 informative tokens, OR-joined (index.js:2710)."""
    out, seen = [], set()
    for m in _TOKEN.finditer(q or ""):
        if len(out) >= 16:
            break
        if m.group(1) is not None:
            p = m.group(1).strip()
            if p:
                out.append('"' + p.replace('"', '""') + '"')
            continue
        w = m.group(2).lower().replace("’", "").replace("'", "")
        if len(w) < 2 or w in MERECAT_STOP or w in seen:
            continue
        seen.add(w)
        out.append('"' + w.replace('"', '""') + '"')
    return " OR ".join(out)


def merecat_phrases(q):
    """Every contiguous stride-1 five-gram of the question (index.js:2734)."""
    words = _WORD.findall(q or "")
    if len(words) < 5:
        return ""
    phrases = []
    i = 0
    while i + 5 <= len(words) and len(phrases) < 20:
        phrases.append('"' + " ".join(words[i:i + 5]).replace('"', '""') + '"')
        i += 1
    return " OR ".join(phrases)


# --- the Bible table (index.js:2756) and DR slug map (index.js:2829) --------
_BIBLE_SPEC = [
    ("genesis", "genesis|gen|ge|gn"), ("exodus", "exodus|exod|exo|ex"),
    ("leviticus", "leviticus|lev|lv"), ("numbers", "numbers|num|nm|nb"),
    ("deuteronomy", "deuteronomy|deut|deu|dt"), ("joshua", "joshua|josh|jos|jsh"),
    ("judges", "judges|judg|jdg|jg"), ("ruth", "ruth|rth|ru"),
    ("1-samuel", "1 samuel|1samuel|1 sam|1sam|1 sa|i samuel|i sam|first samuel"),
    ("2-samuel", "2 samuel|2samuel|2 sam|2sam|2 sa|ii samuel|ii sam|second samuel"),
    ("1-kings", "1 kings|1kings|1 kgs|1kgs|1 ki|i kings|i kgs|first kings"),
    ("2-kings", "2 kings|2kings|2 kgs|2kgs|2 ki|ii kings|ii kgs|second kings"),
    ("1-chronicles", "1 chronicles|1 chron|1 chr|1chr|1 ch|i chronicles|i chron|first chronicles"),
    ("2-chronicles", "2 chronicles|2 chron|2 chr|2chr|2 ch|ii chronicles|ii chron|second chronicles"),
    ("ezra", "ezra|ezr|ez"), ("nehemiah", "nehemiah|neh|ne"),
    ("esther", "esther|esth|est|es"), ("job", "job|jb"),
    ("psalms", "psalms|psalm|pslm|psa|ps|pss|psm"), ("proverbs", "proverbs|prov|pro|prv|pr"),
    ("ecclesiastes", "ecclesiastes|eccles|eccl|ecc|ec|qoh"),
    ("song-of-solomon", "song of solomon|song of songs|song|sos|canticles|cant"),
    ("isaiah", "isaiah|isa|isai"), ("jeremiah", "jeremiah|jer|je|jr"),
    ("lamentations", "lamentations|lam|la"), ("ezekiel", "ezekiel|ezek|eze|ezk"),
    ("daniel", "daniel|dan|da|dn"), ("hosea", "hosea|hos|ho"),
    ("joel", "joel|joe|jl"), ("amos", "amos|amo"), ("obadiah", "obadiah|obad|oba|ob"),
    ("jonah", "jonah|jon|jnh"), ("micah", "micah|mic|mc"), ("nahum", "nahum|nah|na"),
    ("habakkuk", "habakkuk|hab|hb"), ("zephaniah", "zephaniah|zeph|zep|zp"),
    ("haggai", "haggai|hag|hg"), ("zechariah", "zechariah|zech|zec|zc"),
    ("malachi", "malachi|mal|ml"), ("matthew", "matthew|matt|mat|mt"),
    ("mark", "mark|mrk|mar|mk|mr"), ("luke", "luke|luk|lk"),
    ("john", "john|jhn|joh|jn"), ("acts", "acts|act|ac"),
    ("romans", "romans|rom|ro|rm"),
    ("1-corinthians", "1 corinthians|1 cor|1cor|1 co|i corinthians|i cor|first corinthians"),
    ("2-corinthians", "2 corinthians|2 cor|2cor|2 co|ii corinthians|ii cor|second corinthians"),
    ("galatians", "galatians|gal|ga"), ("ephesians", "ephesians|ephes|eph"),
    ("philippians", "philippians|phil|php|pp"), ("colossians", "colossians|col"),
    ("1-thessalonians", "1 thessalonians|1 thess|1thess|1 thes|1 th|i thessalonians|i thess|first thessalonians"),
    ("2-thessalonians", "2 thessalonians|2 thess|2thess|2 thes|2 th|ii thessalonians|ii thess|second thessalonians"),
    ("1-timothy", "1 timothy|1 tim|1tim|1 ti|i timothy|i tim|first timothy"),
    ("2-timothy", "2 timothy|2 tim|2tim|2 ti|ii timothy|ii tim|second timothy"),
    ("titus", "titus|tit|ti"), ("philemon", "philemon|philem|phlm|phm|pm"),
    ("hebrews", "hebrews|heb|hb"), ("james", "james|jas|jm"),
    ("1-peter", "1 peter|1 pet|1pet|1 pe|1 pt|i peter|i pet|first peter"),
    ("2-peter", "2 peter|2 pet|2pet|2 pe|2 pt|ii peter|ii pet|second peter"),
    ("1-john", "1 john|1 jhn|1 jn|1jn|i john|i jn|first john"),
    ("2-john", "2 john|2 jhn|2 jn|2jn|ii john|ii jn|second john"),
    ("3-john", "3 john|3 jhn|3 jn|3jn|iii john|iii jn|third john"),
    ("jude", "jude|jud|jd"), ("revelation", "revelation|revelations|rev|apocalypse|apoc"),
    ("joshua", "josue"), ("ezra", "1 esdras"), ("nehemiah", "2 esdras"),
    ("1-chronicles", "1 paralipomenon|i paralipomenon"),
    ("2-chronicles", "2 paralipomenon|ii paralipomenon"),
    ("song-of-solomon", "canticle of canticles"), ("isaiah", "isaias"),
    ("jeremiah", "jeremias"), ("ezekiel", "ezechiel"), ("hosea", "osee"),
    ("jonah", "jonas"), ("micah", "micheas"), ("habakkuk", "habacuc"),
    ("zephaniah", "sophonias"), ("haggai", "aggeus"), ("zechariah", "zacharias"),
    ("malachi", "malachias"), ("obadiah", "abdias"),
    ("tobias", "tobias|tobit|tob|tb"), ("judith", "judith|jdt"),
    ("wisdom", "wisdom|wisdom of solomon|wis|wisd"),
    ("ecclesiasticus", "ecclesiasticus|sirach|sir|ecclus"),
    ("baruch", "baruch|bar"),
    ("1-machabees", "1 machabees|1 maccabees|1 macc|1 mac|i machabees|i maccabees|first machabees"),
    ("2-machabees", "2 machabees|2 maccabees|2 macc|2 mac|ii machabees|ii maccabees|second machabees"),
]
KJV2DR = {
    "joshua": "josue", "1-samuel": "1-kings", "2-samuel": "2-kings",
    "1-kings": "3-kings", "2-kings": "4-kings",
    "1-chronicles": "1-paralipomenon", "2-chronicles": "2-paralipomenon",
    "ezra": "1-esdras", "nehemiah": "2-esdras",
    "song-of-solomon": "canticle-of-canticles", "isaiah": "isaias",
    "jeremiah": "jeremias", "ezekiel": "ezechiel", "hosea": "osee",
    "jonah": "jonas", "micah": "micheas", "habakkuk": "habacuc",
    "zephaniah": "sophonias", "haggai": "aggeus", "zechariah": "zacharias",
    "malachi": "malachias", "obadiah": "abdias", "revelation": "apocalypse",
}


def _build_bible():
    m, forms = {}, []
    for slug, alts in _BIBLE_SPEC:
        for f in alts.split("|"):
            f = f.strip()
            if f:
                m[f] = slug
                forms.append(f)
    forms.sort(key=len, reverse=True)
    # re.escape leaves spaces alone on Py3.7+; turn every space (escaped or
    # not) into \s+ so "1 samuel"/"song of solomon" match like the worker.
    alt = "|".join(re.escape(f).replace("\\ ", r"\s+").replace(" ", r"\s+")
                   for f in forms)
    return m, re.compile(r"\b(" + alt + r")\.?[ \t]+(\d{1,3}):(\d{1,3})", re.I)


BIBLE_MAP, BIBLE_RE = _build_bible()

_COLS = "c.rowid,c.cid,c.work_id,c.tier,c.url,c.kind,c.heading,c.anchor,c.text,c.title"


def _row(r):
    return {"rowid": r[0], "cid": r[1], "work_id": r[2], "tier": r[3],
            "url": r[4], "kind": r[5], "heading": r[6], "anchor": r[7],
            "text": r[8], "title": r[9], "sem": 0.0, "phr": False}


def verse_seats(db, q):
    """A chapter:verse in the question -> that verse's chunk by anchor from
    every Bible on the shelf, seated with phrase strength (index.js:2841)."""
    jobs, seen = [], set()
    for m in BIBLE_RE.finditer(q or ""):
        if len(jobs) >= 4:
            break
        slug = BIBLE_MAP.get(re.sub(r"\s+", " ", m.group(1).lower()))
        if not slug:
            continue
        key = f"{slug}-{m.group(2)}"
        if key in seen:
            continue
        seen.add(key)
        jobs.append((slug, int(m.group(2)), int(m.group(3))))
    hits = []
    for slug, ch, v in jobs:
        for s in {slug, KJV2DR.get(slug, slug)}:
            base = f"{s}-{ch}"
            rows = db.execute(
                f"SELECT {_COLS} FROM chunks c WHERE c.kind LIKE 'bible%' "
                "AND (c.anchor = ? OR c.anchor LIKE ?) LIMIT 12",
                (base, base + "-%")).fetchall()
            by_work = {}
            for r in rows:
                tail = r[7][len(base):]
                mm = re.search(r"-(\d+)$", tail)
                start = int(mm.group(1)) if mm else 1
                if start > v:
                    continue
                if r[2] not in by_work or start > by_work[r[2]][1]:
                    by_work[r[2]] = (r, start)
            for r, _ in by_work.values():
                hits.append(r)
    return hits


def retrieve(db, vectors, cfg, q):
    pool, order = {}, []  # rowid -> chunk ; order = per-leg rowid ranking lists

    def add(r, sem=0.0, phr=False):
        c = pool.get(r[0])
        if c is None:
            c = _row(r)
            pool[r[0]] = c
        if sem:
            c["sem"] = max(c["sem"], sem)
        if phr:
            c["phr"] = True
        return c

    # 1. Semantic leg — cosine over the WHOLE corpus.
    qv = np.asarray(llm.embed(cfg, [q])[0], dtype=np.float32)
    qv /= (np.linalg.norm(qv) or 1.0)
    scores = vectors @ qv
    ktop = min(int(cfg["vector_topk"]), scores.shape[0])
    idx = np.argpartition(scores, -ktop)[-ktop:]
    idx = idx[np.argsort(scores[idx])[::-1]]
    sem_rank = []
    for i in idx:
        r = db.execute(f"SELECT {_COLS} FROM chunks c WHERE c.rowid=?",
                       (int(i) + 1,)).fetchone()
        if r:
            add(r, sem=float(scores[i]))
            sem_rank.append(r[0])
    order.append(sem_rank)

    # 2/3/4. BM25 legs over FTS5.
    match = merecat_match(q)
    if match:
        weighted = db.execute(
            f"SELECT {_COLS} FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid "
            "WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) * "
            "CASE c.tier WHEN 1 THEN 1.6 WHEN 2 THEN 1.45 WHEN 6 THEN 1.4 "
            "WHEN 3 THEN 1.35 WHEN 4 THEN 1.25 WHEN 9 THEN 1.3 WHEN 8 THEN 1.55 "
            "WHEN 7 THEN 0.9 ELSE 1.0 END LIMIT 18", (match,)).fetchall()
        order.append([add(r)["rowid"] for r in weighted])
        raw = db.execute(
            f"SELECT {_COLS} FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid "
            "WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 12",
            (match,)).fetchall()
        order.append([add(r)["rowid"] for r in raw])
    phr = merecat_phrases(q)
    if phr:
        hits = db.execute(
            f"SELECT {_COLS} FROM chunks_fts JOIN chunks c ON c.rowid=chunks_fts.rowid "
            "WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 20",
            (phr,)).fetchall()
        order.append([add(r, phr=True)["rowid"] for r in hits])

    # 5. Verse seats (phrase strength).
    for r in verse_seats(db, q):
        add(r, phr=True)

    cand = list(pool.values())
    if not cand:
        return []

    # Rerank the merged pool; fall back to reciprocal-rank fusion if the
    # rerank server is down.
    topk = int(cfg["topk"])
    if len(cand) > topk and cfg.get("rerank", True):
        ctx = [((c["heading"] + ": ") if c["heading"] else "") + c["text"][:1500]
               for c in cand]
        scores = llm.rerank(cfg, q, ctx)
        if scores is not None:
            ranked = sorted(range(len(cand)), key=lambda i: scores[i], reverse=True)
            cand = [cand[i] for i in ranked]
        else:
            cand = _fuse(cand, order, pool)
    else:
        cand = _fuse(cand, order, pool)

    chosen = cand[:topk]
    seated = {c["rowid"] for c in chosen}
    # Phrase/verse guarantee: verbatim hits outweigh a rerank window that can
    # miss the match — seat a couple that didn't make the cut.
    owed = [c for c in cand if c["phr"] and c["rowid"] not in seated][:int(cfg.get("phrase_seats", 3))]
    for p in owed:
        for i in range(len(chosen) - 1, -1, -1):
            if not chosen[i]["phr"]:
                chosen[i] = p
                break
    return chosen


def _fuse(cand, order, pool):
    """Reciprocal-rank fusion over the legs (fallback when no reranker)."""
    rrf = {c["rowid"]: 0.0 for c in cand}
    for leg in order:
        for rank, rid in enumerate(leg):
            if rid in rrf:
                rrf[rid] += 1.0 / (60 + rank)
    return sorted(cand, key=lambda c: (rrf[c["rowid"]], c["sem"]), reverse=True)


def source_url(cfg, c):
    """Deep-anchor URL, or '' for url-less private works (index.js:3103)."""
    u = c["url"]
    if not u:
        return ""
    if re.match(r"^https?://", u):
        return u
    return cfg["site"] + u + (("#" + c["anchor"]) if c["anchor"] else "")
