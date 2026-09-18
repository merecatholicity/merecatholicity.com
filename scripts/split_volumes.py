#!/usr/bin/env python3
"""Serve a five-megabyte volume as a volume index and one page per treatise.

Ninety-one served pages were over a megabyte. `anf03.html` transferred 1.56 MB
compressed and parsed into 56,425 elements — several seconds to first paint on a
phone on mobile data, and a DOM large enough to make scrolling itself janky. The
Summa was already the answer in miniature: `summa.html` is a 5 KB index over five
part pages. This applies that shape to every oversized volume.

WHAT IT DOES. Over the BUILT tree, after the resources build and before the card
and metadata sweeps (so a part is an ordinary page by the time they run, and gets
its own card, lang, canonical and skip link for nothing):

  * the volume page becomes an INDEX — its title block, its front matter, its
    whole table of contents with every href pointing into a part, and a hidden
    block of anchor stubs (see below);
  * each division becomes a page of its own, `<volume>-<slug>.html`, carrying
    the head of its volume, its own title block, a part navigation (the volume,
    the previous part, the next), the division's text, and the footnotes that
    text actually cites;
  * `docs/library-parts.json` records the whole arrangement, for the card
    formula (inject_social.py), the librarian's ingest, and anything else that
    needs to know a volume is now a shelf.

THE DEPTH is chosen per volume, not decreed: the shallowest heading level whose
largest part comes under PART_MAX, else whichever level makes the largest part
smallest. The corpus is not uniform — `plutarch.html` is 68 lives and no
subheadings at all, `npnf108.html` is one division and 153 subdivisions — and a
single rule would have cut one of them wrongly.

NOTHING THAT WAS EVER LINKED MAY BREAK. Three things make that true:

  1. Every heading id in the volume stays an id ON THE INDEX, as an empty stub
     in `#mc-parts` carrying the part it now lives in. A link to
     `anf03.html#apology.` therefore still resolves — for the link checker, for
     a reader with no JavaScript (who lands on the index), and for deeplink.js,
     which reads the stub and replaces the location with the part's own URL.
     Paragraph links (`#heading-id__p7`, deeplink's own scheme) resolve by their
     heading prefix.
  2. A cross-reference from one part into another is rewritten to the other
     part's URL. Within a part, every `#id` stays exactly as it was.
  3. The footnotes follow their references, keeping their ORIGINAL numbers
     (`<li value="…">`): the superscript in the text is literal, so a subset
     list renumbered from 1 would have silently misnumbered every note on the
     page.

IDEMPOTENT. An index carries `<!--mc-split-->` and a part carries
`<!--mc-part …-->`; a volume already split is left alone and its arrangement is
read back from the parts on disk. `make html` rebuilds a volume page from its
LaTeX only when the LaTeX changed, and a rebuilt (therefore unmarked) volume is
re-split, its stale parts deleted. To force it, delete the parts or bump the CI
cache generation.
"""
import html as htmllib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
MANIFEST = os.path.join(DOCS, 'library-parts.json')

# A page a phone should not be asked to swallow whole. The 91 pages the review
# measured are all over a megabyte; this reaches a little below them so that a
# volume which grows into the problem is taken before it arrives.
SPLIT_MIN = 600_000
# What a part should come under if a deeper cut can manage it. Not a promise:
# some divisions are simply long, and cutting mid-treatise to hit a number would
# serve the number rather than the reader.
PART_MAX = 400_000
# A part with no text of its own — a group heading standing alone above the
# division that follows it — is merged forward rather than served as a page
# that says one word.
EMPTY_PART = 400
# A division that is a whole book in itself — Against Marcion, the Stromata,
# Augustine's letters — is cut a SECOND time, at its own next heading level, but
# only where the text asks for it: cutting every volume that deep would serve
# anf03 as 774 chapter pages and make a shelf into a card catalogue.
HARD_MAX = 600_000
MIN_SUBPARTS = 4

SPLIT_MARK = '<!--mc-split-->'
PART_MARK_RE = re.compile(r'<!--mc-part volume="([^"]+)" n="(\d+)" of="(\d+)"-->')
MAIN_OPEN_RE = re.compile(r'<main class="prose[^"]*">')
PANDOC = '<meta name="generator" content="pandoc"'

HEADING_RE = re.compile(r'<h([1-6])\b([^>]*)>(.*?)</h\1>', re.S)
ID_RE = re.compile(r'\bid="([^"]*)"')
HREF_FRAG_RE = re.compile(r'href="#([^"]*)"')
FN_REF_RE = re.compile(r'href="#(fn\d+)"')
# `\s+` everywhere a tag meets its first attribute: pandoc wraps long tags
# across lines, so `<li\nid="fn3517">` and `<section\nid="footnotes">` are as
# ordinary as the unwrapped forms. A space-only pattern missed 15 footnotes and
# the link checker was the only thing that noticed.
FN_ITEM_RE = re.compile(r'<li\s+id="(fn\d+)">.*?</li>\n?', re.S)
LI_OPEN_RE = re.compile(r'^<li\s+id="')
TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)
TAG_RE = re.compile(r'<[^>]+>', re.S)
FENCE_RE = re.compile(r'\n?<!--mc-card-->.*?<!--/mc-card-->', re.S)
CANON_RE = re.compile(r'<link rel="canonical"[^>]*>\n?')


def text_of(inner):
    """A heading's plain text: no tags, no entities, one space between words."""
    return re.sub(r'\s+', ' ', htmllib.unescape(TAG_RE.sub('', inner))).strip()


def slugify(s, fallback):
    out = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    out = re.sub(r'-+', '-', out)[:48].strip('-')
    return out or fallback


def clip(text, n):
    """`text` at most n characters, cut at a word rather than mid-syllable."""
    text = text.strip()
    if len(text) <= n:
        return text
    return text[:n].rsplit(' ', 1)[0].rstrip(',;:.') + '…'


def short_title(title):
    """A volume's title for a part's <title> and part navigation: the head of
    it, so the app bar and a search result are not three-quarters series name."""
    head = title.split(':')[0].strip()
    if len(head) < 12:                      # a colon too early to be the title
        head = title
    return clip(head, 64).rstrip(',;:.')


class Page:
    """A built pandoc corpus page, taken apart at its seams."""

    def __init__(self, html):
        self.ok = False
        mo = MAIN_OPEN_RE.search(html)
        j = html.rfind('</main>')
        if PANDOC not in html or not mo or j < mo.end():
            return
        self.head = html[:mo.end()]
        self.tail = html[j:]
        inner = html[mo.end():j]
        m = re.search(r'<header\s+id="title-block-header">.*?</header>\n?', inner, re.S)
        if not m:
            return
        self.premain = inner[:m.start()]      # the skip link, on a swept tree
        self.header = m.group(0)
        rest = inner[m.end():]
        t = re.search(r'<nav\s+id="TOC"[^>]*>.*?</nav>\n?', rest, re.S)
        self.toc = t.group(0) if t else ''
        body = rest[t.end():] if t else rest
        f = re.search(r'<section\s+id="footnotes"[^>]*>.*?</section>\n?', body, re.S)
        self.notes = f.group(0) if f else ''
        self.body = body[:f.start()] if f else body
        ti = TITLE_RE.search(html)
        self.title = re.sub(r'\s+', ' ', ti.group(1)).strip() if ti else ''
        self.ok = True

    def toc_ids(self):
        """The ids the volume's own table of contents reaches — which IS the
        --toc-depth its build stanza chose, and so the right depth for a part's
        own contents list. Never recomputed from the headings: that would offer
        a 774-entry list of chapters the volume deliberately did not offer."""
        return set(HREF_FRAG_RE.findall(self.toc))


def headings(body):
    """(start, end, level, id, inner) for every heading in the body, in order.
    Pandoc wraps long tags across lines, so the attribute scan must cross a
    newline — 524 of anf03's 774 chapter headings are `<h4\\nid="…">`."""
    out = []
    for m in HEADING_RE.finditer(body):
        attrs, inner = m.group(2), m.group(3)
        idm = ID_RE.search(attrs)
        out.append((m.start(), m.end(), int(m.group(1)), idm.group(1) if idm else '', inner))
    return out


def cuts(body, heads, level):
    """Where a split at `level` puts its boundaries: every heading at that level
    or shallower. A shallower heading is a group name ('Apologetic.') and must
    start a part rather than trail the previous one."""
    return [h for h in heads if h[2] <= level]


def slice_parts(marks, stop):
    """[(start, end)] over the body, one span per boundary; what precedes the
    first boundary is the volume's front matter and stays on the index."""
    spans = []
    for k, h in enumerate(marks):
        spans.append((h[0], marks[k + 1][0] if k + 1 < len(marks) else stop))
    return spans


def merge_empty(body, marks, spans):
    """Fold a boundary whose own text is empty into the one after it, so a
    group heading is the head of the first real page of its group rather than a
    page that says 'Apologetic.' and nothing else. The merged part keeps the
    FIRST heading as its title — the group's name is the honest name for the
    page its group opens with."""
    out_marks, out_spans = [], []
    k = 0
    while k < len(spans):
        start, end = spans[k]
        while k + 1 < len(spans) and len(body[marks[k][1]:end].strip()) < EMPTY_PART:
            k += 1
            end = spans[k][1]
        out_marks.append(next(h for h in marks if h[0] == start))
        out_spans.append((start, end))
        k += 1
    return out_marks, out_spans


def plan(page):
    """(level, marks, spans) for the volume, or None if it should stay whole."""
    heads = headings(page.body)
    best = None
    for level in (1, 2, 3):
        marks = cuts(page.body, heads, level)
        if len(marks) < 2:
            continue
        spans = slice_parts(marks, len(page.body))
        marks, spans = merge_empty(page.body, marks, spans)
        if len(spans) < 2:
            continue
        biggest = max(e - s for s, e in spans)
        if best is None or biggest < best[0]:
            best = (biggest, level, marks, spans)
        if biggest <= PART_MAX:
            break
    if not best:
        return None
    return best[1], best[2], best[3]


def second_cut(body, heads, mark, start, end):
    """A division too long to serve whole, cut at its own next heading level.
    Returns (marks, spans) — the first of which keeps the division's own
    heading, so the treatise still has a page that is the treatise."""
    inside = [h for h in heads if start < h[0] < end and h[2] > mark[2]]
    if not inside:
        return None
    deeper = min(h[2] for h in inside)
    marks = [mark] + [h for h in inside if h[2] == deeper]
    if len(marks) - 1 < MIN_SUBPARTS:
        return None
    return merge_empty(body, marks, slice_parts(marks, end))


def notes_for(fragment, notes_by_id):
    """The footnotes this fragment actually cites, in their original order and
    KEEPING THEIR NUMBERS: the superscript in the text is literal, so a subset
    renumbered from 1 would misnumber every note on the page."""
    want = []
    seen = set()
    for fid in FN_REF_RE.findall(fragment):
        if fid in notes_by_id and fid not in seen:
            seen.add(fid)
            want.append(fid)
    if not want:
        return ''
    want.sort(key=lambda f: int(f[2:]))
    items = []
    for fid in want:
        items.append(LI_OPEN_RE.sub('<li value="' + fid[2:] + '" id="', notes_by_id[fid], count=1))
    return ('<section id="footnotes" class="footnotes footnotes-end-of-document"\n'
            'role="doc-endnotes">\n<hr />\n<ol>\n' + ''.join(items) + '</ol>\n</section>\n')


def retarget(fragment, home, owner):
    """Point every cross-reference out of this page at the page it now lives on.
    A reference INSIDE the fragment is left exactly as it was."""
    mine = set(ID_RE.findall(fragment))

    def fix(m):
        frag = m.group(1)
        if frag in mine:
            return m.group(0)
        base = re.sub(r'__p\d+$', '', frag)
        where = owner.get(frag) or owner.get(base)
        if not where or where == home:
            return m.group(0)
        return 'href="' + where + '#' + frag + '"'
    return HREF_FRAG_RE.sub(fix, fragment)


def subtoc(fragment, keep_ids, skip_id):
    """A part's own contents, at the depth its volume's TOC chose."""
    rows = [(lv, i, inner) for _, _, lv, i, inner in headings(fragment)
            if i and i in keep_ids and i != skip_id]
    if len(rows) < 2:
        return ''
    base = min(r[0] for r in rows)
    out, depth = [], 0
    for lv, i, inner in rows:
        want = lv - base
        while depth < want:
            out.append('<ul>')
            depth += 1
        while depth > want:
            out.append('</ul></li>')
            depth -= 1
        out.append('<li><a href="#' + i + '">' + text_of(inner) + '</a></li>')
    while depth > 0:
        out.append('</ul></li>')
        depth -= 1
    return ('<nav class="mc-subtoc" role="doc-toc" aria-label="Contents of this part">\n<ul>\n'
            + '\n'.join(out) + '\n</ul>\n</nav>\n')


def partnav(volume, vtitle, parts, k, foot=False):
    """The volume, the division it belongs to, the part before, the part after —
    at the head and the foot of every part, OUTSIDE the title block, which the
    app shell hides on a phone (a reader there would have no way back)."""
    bits = ['<a href="' + volume + '">' + htmllib.escape(short_title(vtitle)) + '</a>']
    group = parts[k].get('group')
    if group:
        bits.append('<a href="' + group['file'] + '">'
                    + htmllib.escape(clip(group['title'], 48)) + '</a>')
    if k > 0:
        p = parts[k - 1]
        bits.append('<a href="' + p['file'] + '" rel="prev">← '
                    + htmllib.escape(clip(p['title'], 48)) + '</a>')
    if k + 1 < len(parts):
        p = parts[k + 1]
        bits.append('<a href="' + p['file'] + '" rel="next">'
                    + htmllib.escape(clip(p['title'], 48)) + ' →</a>')
    return ('<nav class="mc-partnav' + (' foot' if foot else '')
            + '" aria-label="This volume">\n' + ' · '.join(bits) + '\n</nav>\n')


def head_for(page, title):
    """The volume's own head, wearing the part's title.

    Two things of the volume's are taken OUT rather than inherited, because both
    name the volume itself: its share card (inject_social.py writes each part
    one of its own from this title) and its rel=canonical — a part that kept the
    volume's canonical would tell every search engine it is a copy of a page it
    is not, and hand its own standing away."""
    head = TITLE_RE.sub(lambda _: '<title>' + htmllib.escape(title) + '</title>',
                        page.head, count=1)
    head = FENCE_RE.sub('', head, count=1)
    return CANON_RE.sub('', head, count=1)


def render_part(page, volume, parts, k, body, keep_ids, owner, notes_by_id):
    """One part page: head, title block, part navigation, contents, text,
    the footnotes it cites, part navigation again."""
    p = parts[k]
    heads = headings(body)
    first = heads[0] if heads else None
    rest = body[first[1]:] if first else body
    title_id = ' id="' + p['id'] + '"' if p['id'] else ''
    # the heading travels into the title block, so its own cross-references and
    # its own footnote marks travel with it: a division whose title carries a
    # note (Athanasius' tracts, Chrysostom's homilies) left the note behind and
    # the mark pointed at nothing.
    inner = retarget(first[4], p['file'], owner) if first else htmllib.escape(p['title'])
    fragment = retarget(rest, p['file'], owner)
    # the <title> says where the page is: its division if it has one, else its
    # volume — 'Chapter I.' alone is no use in a search result or an app bar
    context = short_title(p['group']['title'] if p.get('group') else page.title)
    out = [head_for(page, p['title'] + ' — ' + context),
           '\n<!--mc-part volume="' + volume + '" n="' + str(k + 1) + '" of="'
           + str(len(parts)) + '"-->\n',
           '<header id="title-block-header">\n<h1 class="title"' + title_id + '>'
           + inner + '</h1>\n</header>\n',
           partnav(volume, page.title, parts, k),
           subtoc(rest, keep_ids, p['id']),
           fragment,
           notes_for(body, notes_by_id),
           partnav(volume, page.title, parts, k, foot=True),
           page.tail]
    return ''.join(out)


def render_index(page, volume, parts, front, owner, notes_by_id):
    """The volume page, now a way in: its front matter and its whole table of
    contents, every entry pointing into the part that holds it.

    Two things keep the old addresses alive. Each contents entry WEARS THE ID IT
    LINKS TO (pandoc's own `toc-` prefix is dropped), so `anf03.html#apology.`
    still resolves — a reader with no JavaScript lands on the contents at the
    right line, and the link checker is satisfied, at no cost in bytes. And
    `#mc-parts` names the anchor map for deeplink.js, which hops a reader on to
    the part itself; the map is a FILE rather than a block of stubs because the
    stubs were 124 KB of a 134 KB index — the ids of a Father's chapters are
    whole sentences, and an index page that carries them all is the megabyte
    page again under another name."""
    toc = page.toc
    for frag, where in owner.items():
        toc = toc.replace('href="#' + frag + '"',
                          'href="' + where + ('' if _is_root(frag, parts) else '#' + frag) + '"')
        toc = toc.replace('id="toc-' + frag + '"', 'id="' + frag + '"')
    first = htmllib.escape(clip(parts[0]['title'], 60))
    lead = ('<p class="mc-parts-lead">Served in ' + str(len(parts))
            + ' parts, for reading on a telephone. The first is <a href="'
            + parts[0]['file'] + '">' + first + '</a></p>\n')
    return ''.join([
        page.head, page.premain, '\n' + SPLIT_MARK + '\n', page.header, lead, toc,
        retarget(front, volume, owner),
        notes_for(front, notes_by_id),
        '<div id="mc-parts" hidden data-anchors="' + anchors_name(volume) + '"></div>\n',
        page.tail])


def anchors_name(volume):
    return volume[:-5] + '-anchors.json'


def _is_root(frag, parts):
    return any(p['id'] == frag for p in parts)


def anchor_map(parts, owner):
    """{"files": [...], "ids": {"chapter-i.": 4, …}} — every heading id in the
    volume and the part it now lives on, fetched by deeplink.js only when a
    hash does not resolve on the index itself."""
    files = [p['file'] for p in parts]
    where = {f: n for n, f in enumerate(files)}
    return {'files': files, 'ids': {i: where[f] for i, f in sorted(owner.items())}}


def split(name, html):
    """(index html, [(file, html)], manifest entry) for one volume, or None."""
    page = Page(html)
    if not page.ok or not page.body.strip():
        return None
    got = plan(page)
    if not got:
        return None
    level, marks, spans = got
    volume = name
    stem = name[:-5]
    heads = headings(page.body)
    # the second cut: a division longer than HARD_MAX becomes a little shelf of
    # its own, its first page the division's own opening
    flat = []
    for (s, e), h in zip(spans, marks):
        sub = second_cut(page.body, heads, h, s, e) if e - s > HARD_MAX else None
        if not sub:
            flat.append((s, e, h, None))
            continue
        root = len(flat)
        for k, ((ss, se), sh) in enumerate(zip(sub[1], sub[0])):
            flat.append((ss, se, sh, None if k == 0 else root))
    parts, used = [], set()
    for k, (s, e, h, group) in enumerate(flat):
        title = text_of(h[4]) or 'Part ' + str(k + 1)
        base = slugify(h[3] or title, 'part-' + str(k + 1))
        if group is not None:
            base = (parts[group]['slug'][:30] + '-' + base)[:60].strip('-')
        slug, n = base, 1
        while slug in used:
            n += 1
            slug = base + '-' + str(n)
        used.add(slug)
        parts.append({'file': stem + '-' + slug + '.html', 'title': title,
                      'id': h[3], 'slug': slug, 'group': group})
    for p in parts:
        g = p.pop('group')
        if g is not None:
            p['group'] = {'file': parts[g]['file'], 'title': parts[g]['title']}
    spans = [(s, e) for s, e, _, _ in flat]
    # every heading id in the volume, and the part it now lives on
    owner = {}
    for k, (s, e) in enumerate(spans):
        for _, _, _, i, _ in headings(page.body[s:e]):
            if i:
                owner[i] = parts[k]['file']
    notes_by_id = {m.group(1): m.group(0) for m in FN_ITEM_RE.finditer(page.notes)}
    keep = page.toc_ids()
    front = page.body[:spans[0][0]]
    out = []
    for k, (s, e) in enumerate(spans):
        out.append((parts[k]['file'],
                    render_part(page, volume, parts, k, page.body[s:e], keep, owner, notes_by_id)))
    index = render_index(page, volume, parts, front, owner, notes_by_id)
    amap = anchor_map(parts, owner)
    entry = {'title': page.title, 'short': short_title(page.title), 'level': level,
             'parts': [{'file': p['file'], 'title': p['title'],
                        'group': (p['group']['title'] if p.get('group') else '')}
                       for p in parts]}
    return index, out, entry, amap


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def existing_parts(volume):
    """What a previous run made for this volume, read back from the pages
    themselves — so a lost manifest is rebuilt rather than believed."""
    found = []
    stem = volume[:-5] + '-'
    for name in os.listdir(DOCS):
        if not name.startswith(stem) or not name.endswith('.html'):
            continue
        text = read(os.path.join(DOCS, name))
        # the WHOLE file, never a sniff of its head: the anti-flash script and
        # the card put the mark several kilobytes down, and a 4 KB sniff found
        # no part anywhere — stale parts were never swept and an oversized part
        # was a volume to the next run.
        m = PART_MARK_RE.search(text)
        if m and m.group(1) == volume:
            t = TITLE_RE.search(text)
            found.append((int(m.group(2)), name,
                          re.sub(r'\s+—\s+.*$', '', t.group(1).strip()) if t else name))
    found.sort()
    return [{'file': n, 'title': t} for _, n, t in found]


def main(argv):
    dry = '--dry-run' in argv
    volumes = {}
    split_now = []
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        path = os.path.join(DOCS, name)
        if os.path.getsize(path) < SPLIT_MIN:
            continue
        html = read(path)
        if PART_MARK_RE.search(html):
            continue                       # a part of somebody (an oversized one)
        if SPLIT_MARK in html:
            parts = existing_parts(name)   # already a shelf; leave it as it is
            if parts:
                t = TITLE_RE.search(html)
                title = t.group(1).strip() if t else name
                volumes[name] = {'title': title, 'short': short_title(title),
                                 'level': 0, 'parts': parts}
            continue
        got = split(name, html)
        if got:
            split_now.append((name, got))
    for name, (index, parts, entry, amap) in split_now:
        volumes[name] = entry
        if dry:
            print('%-22s %2d parts, level %d, biggest %8d' % (
                name, len(parts), entry['level'], max(len(h) for _, h in parts)))
            continue
        stale = {p['file'] for p in existing_parts(name)} - {f for f, _ in parts}
        for f in sorted(stale):
            os.remove(os.path.join(DOCS, f))
        for f, text in parts:
            write(os.path.join(DOCS, f), text)
        write(os.path.join(DOCS, name), index)
        with open(os.path.join(DOCS, anchors_name(name)), 'w', encoding='utf-8') as f:
            json.dump(amap, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
    if dry:
        print('split_volumes: would split', len(split_now), 'volumes')
        return 0
    index = {'volumes': volumes, 'parts': {}}
    for vol, entry in volumes.items():
        for n, p in enumerate(entry['parts']):
            index['parts'][p['file']] = {'volume': vol, 'volume_title': entry['title'],
                                         'volume_short': entry.get('short', entry['title']),
                                         'title': p['title'], 'group': p.get('group', ''),
                                         'n': n + 1, 'of': len(entry['parts'])}
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('split_volumes:', len(split_now), 'volumes split now,', len(volumes),
          'served as parts,', len(index['parts']), 'part pages')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
