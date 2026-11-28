#!/usr/bin/env python3
"""Give every Library work, and every shelf's overview, its door to print.

The record is content/affiliate.json (the scraping-amazon-affiliate-link skill keeps it):

- books: Amazon affiliate boxes, each a SiteStripe link (its ASIN and linkId, tag
  lerinspress-20), marked "Affiliate link" with Amazon's disclosure, rel="sponsored";
- doors: boxes to the press's recommendation shelves (press.merecatholicity.com/bibles/,
  /catechisms/), not themselves affiliate links, saying the shelf's links are;
- shelves: each Library shelf's catch-all, the box its overview carries and every work on
  it without its own (a book, a door, or "lerins:<slug>" for our own edition);
- works: a page's own book or door, {"lerins": slug} for our own edition's card (the
  press's shield and name and a link to its title page, never affiliate words),
  {"miss": why, "date": …} for a search that found no good edition (the page takes the
  shelf's catch-all), {"hand": why} for a page whose box is written by hand.

A page takes its own entry, else the catch-all of the first shelf listing it that has one
(content/library.html, the catalog's source). The box goes after a pandoc page's title
block, or after a content.py page's <h1>; a split volume's index carries it, its parts
don't. The overviews go into the built docs/library.html after each shelf's list, where
app/views/library.ts keeps each box with its own category. Each box links
styles/support.css (docs/support.css) from inside itself, so style.css carries none of it.

Fenced and idempotent: a run rewrites every box in place, so a changed word reaches a
cached tree. Deterministic. Run at the end of `make html` and `make content`."""
import html as htmllib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
LEDGER = os.path.join(ROOT, 'content', 'affiliate.json')
LIBRARY_SRC = os.path.join(ROOT, 'content', 'library.html')
PRESS = 'https://press.merecatholicity.com'
PRESS_DIR = os.path.join(ROOT, 'press', 'content')

FENCE_OPEN = '<!--mc-door-->'
FENCE_CLOSE = '<!--/mc-door-->'
FENCE_RE = re.compile(r'\n?' + re.escape(FENCE_OPEN) + '.*?' + re.escape(FENCE_CLOSE) + r'\n?', re.S)
LINK = '<link rel="stylesheet" href="support.css">'
THANKS = ('<strong>at no extra cost to you, and it helps support the Mere Catholicity '
          'Project.</strong> We are grateful for every one.')
TAG = 'lerinspress-20'


def amazon_url(asin, link_id):
    return (f'https://www.amazon.com/dp/{asin}?linkCode=ll2&amp;tag={TAG}&amp;'
            f'linkId={link_id}&amp;language=en_US&amp;ref_=as_li_ss_tl')


def affiliate(book):
    """An Amazon affiliate box: the thanks, the edition, the marked link, the disclosure."""
    return f'''<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
{LINK}
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>{book["words"]} The link below is an Amazon affiliate link: when you buy through it,
Amazon pays a small commission, {THANKS}</p>
<p class="mc-support-go"><a href="{amazon_url(book["asin"], book["link_id"])}" rel="sponsored noopener">{book["label"]}</a></p>
<p class="mc-support-note">Affiliate link. As an Amazon Associate we earn from qualifying purchases.</p>
</aside>'''


def door(d):
    """A box to one of the press's recommendation shelves: not itself an affiliate link."""
    return f'''<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
{LINK}
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>{d["words"]} When you buy one through its links, Amazon pays a small commission,
{THANKS}</p>
<p class="mc-support-go"><a href="{d["href"]}">{d["button"]}</a></p>
<p class="mc-support-note">{d["note"]}</p>
</aside>'''


def press_catalogue():
    """The press's titles by slug, and its collections' names by slug."""
    with open(os.path.join(PRESS_DIR, 'titles.json'), encoding='utf-8') as f:
        titles = {t['slug']: t for t in json.load(f)}
    with open(os.path.join(PRESS_DIR, 'press.json'), encoding='utf-8') as f:
        shelves = {c['slug']: c['name'] for c in json.load(f)['collections']}
    return titles, shelves


def edition(slug, catalogue=None, own=True):
    """The card for a book Lérins Press prints: its shield, its name, the book's line, a way in.
    On the work's own page it reads "This work in print"; standing in for a shelf, "In print"."""
    titles, shelves = catalogue or press_catalogue()
    t = titles[slug]
    name = htmllib.escape(t['title'], quote=False)
    c = t.get('collection')
    line = (f'<em>{name}</em>, {shelves[c["slug"]]} No.&nbsp;{c["no"]}.' if c
            else f'<em>{name}</em>, from Lérins Press.')
    return f'''<aside class="mc-edition" aria-label="The Lérins Press edition">
{LINK}
<img src="theme/lerins-shield.webp" alt="" width="88" height="144">
<div class="mc-edition-txt">
<p class="mc-edition-press">Lérins Press</p>
<p class="mc-edition-line">{'This work in print' if own else 'In print'}: {line}</p>
<p class="mc-edition-go"><a href="{PRESS}/titles/{slug}/">See the Lérins Press edition &rsaquo;</a></p>
</div>
</aside>'''


def load(path=LEDGER):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def library_shelves(path=LIBRARY_SRC):
    """Every Library shelf (its <h2 id>) and the pages it reads online, in order."""
    with open(path, encoding='utf-8') as f:
        s = f.read()
    heads = list(re.finditer(r'<h2 id="([^"]+)">', s))
    out = {}
    for k, h in enumerate(heads):
        end = heads[k + 1].start() if k + 1 < len(heads) else len(s)
        out[h.group(1)] = re.findall(r'<a href="([^"/]+\.html)">Read online', s[h.end():end])
    return out


def box_for(key, ledger, catalogue=None):
    if key.startswith('lerins:'):
        return edition(key[len('lerins:'):], catalogue, own=False)
    if key in ledger['books']:
        return affiliate(ledger['books'][key])
    if key in ledger['doors']:
        return door(ledger['doors'][key])
    raise KeyError(f'content/affiliate.json names no book or door "{key}"')


def resolve(ledger, shelves=None, catalogue=None):
    """{page: box html} for every Library page that carries one; hand pages are left out."""
    shelves = shelves if shelves is not None else library_shelves()
    catalogue = catalogue or press_catalogue()
    home = {}  # a page on two shelves takes the first one with a catch-all
    for shelf, pages in shelves.items():
        for page in pages:
            if page not in home or (home[page] not in ledger['shelves'] and shelf in ledger['shelves']):
                home[page] = shelf
    out = {}
    for page, shelf in home.items():
        own = ledger['works'].get(page)
        if isinstance(own, str):
            out[page] = box_for(own, ledger)
        elif isinstance(own, dict) and 'hand' in own:
            continue
        elif isinstance(own, dict) and 'lerins' in own:
            out[page] = edition(own['lerins'], catalogue)
        elif shelf in ledger['shelves']:
            out[page] = box_for(ledger['shelves'][shelf], ledger, catalogue)
    return out


def overviews(ledger):
    """{shelf: box html} for every shelf with a catch-all."""
    catalogue = press_catalogue()
    return {shelf: box_for(key, ledger, catalogue) for shelf, key in ledger['shelves'].items()}


def fenced(box):
    return '\n' + FENCE_OPEN + '\n' + box + '\n' + FENCE_CLOSE + '\n'


def inject(page, box):
    """The page with exactly one box: after a pandoc title block, else after the first <h1>
    of its <main>; unchanged if it has neither."""
    page = FENCE_RE.sub('\n', page)
    i = page.find('<header id="title-block-header">')
    if i >= 0:
        j = page.find('</header>', i) + len('</header>')
    else:
        m = page.find('<main')
        h = page.find('</h1>', m) if m >= 0 else -1
        if h < 0:
            return page
        j = h + len('</h1>')
    return page[:j] + fenced(box) + page[j:].lstrip('\n')


def inject_library(page, boxes):
    """The built Library page with each shelf's catch-all after its last list."""
    page = FENCE_RE.sub('\n', page)
    heads = list(re.finditer(r'<h2 id="([^"]+)">', page))
    for k in reversed(range(len(heads))):
        shelf = heads[k].group(1)
        if shelf not in boxes:
            continue
        end = heads[k + 1].start() if k + 1 < len(heads) else page.find('</main>', heads[k].end())
        j = page.rfind('</ul>', heads[k].end(), end)
        if j < 0:
            continue
        j += len('</ul>')
        page = page[:j] + fenced(boxes[shelf]) + page[j:].lstrip('\n')
    return page


def rewrite(path, fn):
    if not os.path.exists(path):
        return False
    with open(path, encoding='utf-8') as f:
        old = f.read()
    new = fn(old)
    if new != old:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new)
    return FENCE_OPEN in new


def main():
    ledger = load()
    pages = resolve(ledger)
    done = sum(rewrite(os.path.join(DOCS, page), lambda s, b=box: inject(s, b))
               for page, box in pages.items())
    lib = rewrite(os.path.join(DOCS, 'library.html'), lambda s: inject_library(s, overviews(ledger)))
    print(f'inject_support: a door to print on {done} of {len(pages)} pages'
          + (', and the Library overviews' if lib else ''))


if __name__ == '__main__':
    main()
