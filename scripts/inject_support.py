#!/usr/bin/env python3
"""Put a door to Lérins Press on the corpus pages that have one.

Two kinds of box, both after the page's title block:

- THE CATECHISMS BOX on the creeds and confessions (Schaff's three volumes, Trent,
  the Thirty-Nine Articles, the Book of Concord, Westminster): the press's thanks box
  (styles/main.css .mc-support), its heart, "With our thanks" in Pinyon Script, the
  words that help the project in bold, and a button to press.merecatholicity.com/
  catechisms/. Not itself an affiliate link; the press's page, whose Amazon links
  are, says so. The Bible pages and the Library's shelves carry the same box by hand
  (docs/kjv.html, docs/douay-rheims.html, content/library.html).
- THE SUMMA BOX on the Summa's five parts: the same thanks box, but its button is the
  Amazon affiliate link itself (a SiteStripe link, tag lerinspress-20, rel="sponsored")
  to the English Dominican translation's five-volume hardcover, so it is marked an
  affiliate link and carries Amazon's disclosure. The Library's Aquinas shelf carries
  the same box by hand (content/library.html).
- THE NEWMAN BOX on every work the Library's Newman shelf links (read from
  content/library.html's #newman section, so a new work joins by being shelved): the
  same affiliate box, its button the Essay on the Development of Christian Doctrine.
  The Library's Newman view carries it by hand.
- THE EDITION CARD on a work the press prints (the Catena Aurea): the press's shield,
  its name in Cinzel, the work's own line, and a link to its page on the press's site
  (.mc-edition). Our own book, so no affiliate words at all.

These pages are pandoc's, so the boxes cannot be written into them by hand. Fenced,
so a later run rewrites a box in place (a changed word reaches a cached tree); a page
with no title block is left alone. A split volume's own page is the index over its
parts, and the box stands on that index only. Deterministic. Wired into `make html`
after the resources build and the volume split; runnable over the built docs/ tree."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
PRESS = 'https://press.merecatholicity.com'

FENCE_OPEN = '<!--mc-door-->'
FENCE_CLOSE = '<!--/mc-door-->'
FENCE_RE = re.compile(re.escape(FENCE_OPEN) + '.*?' + re.escape(FENCE_CLOSE) + r'\n?', re.S)

CATECHISMS = '''<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>Would you like a catechism in print? Lérins Press keeps a shelf of catechisms
and confessions we recommend for learning the faith. When you buy one through its
links, Amazon pays a small commission, <strong>at no extra cost to you, and it
helps support the Mere Catholicity Project.</strong> We are grateful for every
one.</p>
<p class="mc-support-go"><a href="''' + PRESS + '''/catechisms/">See the recommended catechisms</a></p>
<p class="mc-support-note">The Catechisms page&rsquo;s Amazon links are affiliate links.</p>
</aside>'''


SUMMA = '''<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>Would you like the Summa in print? The English Dominican translation read
here comes as a five-volume hardcover set. The link below is an Amazon affiliate
link: when you buy through it, Amazon pays a small commission, <strong>at no
extra cost to you, and it helps support the Mere Catholicity Project.</strong>
We are grateful for every one.</p>
<p class="mc-support-go"><a href="https://www.amazon.com/dp/0870610635?linkCode=ll2&amp;tag=lerinspress-20&amp;linkId=d6f69fb52e1f737aef389e1afe9b1cea&amp;language=en_US&amp;ref_=as_li_ss_tl" rel="sponsored noopener">Buy on Amazon (Hardcover, 5 volumes)</a></p>
<p class="mc-support-note">Affiliate link. As an Amazon Associate we earn from qualifying purchases.</p>
</aside>'''


NEWMAN = '''<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>Would you like Newman in print? His <em>Essay on the Development of Christian
Doctrine</em>, the 1878 edition with a foreword by Ian Ker, is still the classic
text on how doctrine grows, in paperback from the University of Notre Dame Press. The link below is an Amazon affiliate link: when you
buy through it, Amazon pays a small commission, <strong>at no extra cost to you,
and it helps support the Mere Catholicity Project.</strong> We are grateful for
every one.</p>
<p class="mc-support-go"><a href="https://www.amazon.com/dp/026800921X?linkCode=ll2&amp;tag=lerinspress-20&amp;linkId=20e6b7a13c0b8b1184c44bada0cf3329&amp;language=en_US&amp;ref_=as_li_ss_tl" rel="sponsored noopener">Buy the Essay on Amazon (Paperback)</a></p>
<p class="mc-support-note">Affiliate link. As an Amazon Associate we earn from qualifying purchases.</p>
</aside>'''


def edition(title, shelf, no, slug):
    """The card for a work the press prints: its shield, its name, the work's line, a way in."""
    return f'''<aside class="mc-edition" aria-label="The Lérins Press edition">
<img src="theme/lerins-shield.webp" alt="" width="88" height="144">
<div class="mc-edition-txt">
<p class="mc-edition-press">Lérins Press</p>
<p class="mc-edition-line">This work in print: <em>{title}</em>, {shelf} No.&nbsp;{no}.</p>
<p class="mc-edition-go"><a href="{PRESS}/titles/{slug}/">See the Lérins Press edition &rsaquo;</a></p>
</div>
</aside>'''


PAGES = {
    'creeds1.html': CATECHISMS, 'creeds2.html': CATECHISMS, 'creeds3.html': CATECHISMS,
    'trent.html': CATECHISMS, 'articles1571.html': CATECHISMS, 'concord.html': CATECHISMS,
    'westminster.html': CATECHISMS,
    'summa-fp.html': SUMMA, 'summa-fs.html': SUMMA, 'summa-ss.html': SUMMA,
    'summa-tp.html': SUMMA, 'summa-xp.html': SUMMA,
    'catena-matthew.html': edition('Catena Aurea on St. Matthew', 'Lérins Fathers', 19, 'catena-aurea-on-st-matthew'),
    'catena-mark.html': edition('Catena Aurea on St. Mark', 'Lérins Fathers', 20, 'catena-aurea-on-st-mark'),
    'catena-luke.html': edition('Catena Aurea on St. Luke', 'Lérins Fathers', 21, 'catena-aurea-on-st-luke'),
    'catena-john.html': edition('Catena Aurea on St. John', 'Lérins Fathers', 22, 'catena-aurea-on-st-john'),
}


def newman_pages(library=os.path.join(ROOT, 'content', 'library.html')):
    """Every page the Library's Newman shelf reads online, in its order."""
    with open(library, encoding='utf-8') as f:
        s = f.read()
    i = s.index('<h2 id="newman">')
    j = s.find('<h2 ', i + 1)
    return re.findall(r'<a href="([^"/]+\.html)">Read online', s[i:j if j > 0 else len(s)])


for _page in newman_pages():
    PAGES.setdefault(_page, NEWMAN)


def inject(html, box):
    """The page with exactly one box after its title block, or unchanged without one."""
    html = FENCE_RE.sub('', html)
    i = html.find('<header id="title-block-header">')
    if i < 0:
        return html
    j = html.find('</header>', i) + len('</header>')
    rest = html[j:].lstrip('\n')
    return html[:j] + '\n' + FENCE_OPEN + '\n' + box + '\n' + FENCE_CLOSE + '\n' + rest


def main():
    done = 0
    for name, box in PAGES.items():
        path = os.path.join(DOCS, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            old = f.read()
        new = inject(old, box)
        if new != old:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
        done += FENCE_OPEN in new
    print(f'inject_support: a door to the press on {done} of {len(PAGES)} pages')


if __name__ == '__main__':
    main()
