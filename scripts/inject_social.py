#!/usr/bin/env python3
"""Give every docs/*.html a social-share card, derived from its own title and shelf.

The primary-source Library pages (Schaff, Newman, the Fathers, the Bibles, the
Summa, the Catena, the classics) are pandoc-built with no Open Graph tags; this
injects a page-specific card into each without editing the dozens of build
stanzas (and the generated *.mk files) that produce them. The description is the
work's own title on its own shelf, read from docs/library.html — the page that
IS the catalog — so a shared link says WHICH work it is, not merely that the site
has a library (until 2026-09-17, 234 of 274 pages shared one sentence).

This is the ONE owner of a card for every page content.py does not build: the
two works pandoc builds --standalone from LaTeX carry theirs in OVERRIDES, not
in a head partial of their own. Pages that already carry an og:title and no fence
of ours — the hand pages and the content.py pages, with their curated cards
— are skipped untouched; a noindex page is never given a card at all.

Idempotent (the fenced block is rewritten in place, so a changed formula
reaches a cached tree) and deterministic. Wired into `make html` after the
resources build, and after `make content` has written docs/library.html; also
runnable standalone over the committed docs/ tree."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from library_order import Catalog  # noqa: E402  (the Library catalog's one parser)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SITE = 'https://merecatholicity.com'
IMAGE = SITE + '/cover.jpg'
# The fallback description, for a page the catalog does not name (and for a tree
# with no docs/library.html yet). Every Library work gets its own line instead —
# see describe(). Kept as the honest generic: it says what the page is.
DESC = 'A primary source in the Mere Catholicity Library.'
LIBRARY = os.path.join(DOCS, 'library.html')
PARTS = os.path.join(DOCS, 'library-parts.json')

# Our card is fenced, so a later run REWRITES it rather than skipping the page:
# without this, a pages tree restored from the build cache (CI, and any local
# incremental build) would keep the card its previous formula wrote for ever.
# A page carrying an og:title and NO fence is somebody else's curated card.
FENCE_OPEN = '<!--mc-card-->'
FENCE_CLOSE = '<!--/mc-card-->'
FENCE_RE = re.compile(re.escape(FENCE_OPEN) + '.*?' + re.escape(FENCE_CLOSE), re.S)
# the same block with the newline that precedes it, for taking a card away
UNCARD_RE = re.compile(r'\n?' + re.escape(FENCE_OPEN) + '.*?' + re.escape(FENCE_CLOSE), re.S)

# The two works pandoc builds --standalone from LaTeX (Makefile's `html` target)
# had their card in a -H head partial each — partials/social.html and
# partials/social-bishop.html — which is the whole reason the bishop paper looked
# like the one page with "its own social partial": -H is pandoc's only door into
# a head it writes itself, and a curated card had nowhere else to live. They live
# here now, beside every other page's (2026-09-17); partials/head.html carries
# what is not a card (the favicon) for both.
OVERRIDES = {
    'book.html': {
        'title': 'Mere Catholicity',
        'desc': 'What has been believed everywhere, always, and by all.',
        'og_type': 'book',
        # the cover's true pixels, so a card renders it large rather than cropped
        'extra': [('meta property="og:image:width"', '1300'),
                  ('meta property="og:image:height"', '1625'),
                  ('meta property="og:image:alt"', 'Mere Catholicity')],
    },
    'bishop-presbyter.html': {
        'title': 'The bishop and the presbyter',
        'desc': ('A companion paper on the question of bishop and presbyter in '
                 'the early Church, recorded.'),
        'og_type': 'article',
    },
}

TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)
NOINDEX_RE = re.compile(r'<meta name="robots" content="[^"]*noindex', re.I)

# A tiny SYNCHRONOUS head script that kills the load flashes:
#  1) Theme: set data-theme (+ palette) from the cookie BEFORE first paint, so a
#     page never renders in the wrong theme and then flip (the "dark flash").
#     Default dark, matching nav.js's effective() — nav.js re-applies it later.
#     The theme background is ALSO painted inline on <html> so no paintable
#     moment is ever white (an installed-app cold start once showed seconds of
#     white between the splash and the stylesheet).
#  2) Home: on index.html (app mode), hide the static book-promo content until the
#     <mc-home> launcher mounts, so the home page doesn't flash its static markup
#     ("The Book" flash) first. A 2.5s safety reveals it if the launcher never
#     mounts OR mounted empty (a broken bundle must never hold the page blank —
#     the flash-guard is cosmetic, the content is the point; the old 4s absent-only
#     check once left a cold PWA start on a white screen).
#  3) A LAUNCH SPLASH (2026-09-06, replacing the 2026-08-02 wordmark+spinner):
#     a real launch screen — the cross rising into a soft maroon glow with the
#     wordmark settling out of a wide letter-spacing beneath it. Drawn entirely
#     with the ROOT element's own ::before/::after, so it needs no DOM (this
#     script runs before <body> exists) and no <main> swap can disturb it.
#     Colours are hardcoded because style.css may not have arrived.
#     WHERE: Home, and only Home. That is the installed app's start_url, so it
#     is every launch; landing anywhere else is a RESUME, where a splash would
#     be wrong. It also never covers a reading page — those paint their own text
#     at once, and a splash over ready content is just a delay. (A standalone-
#     only branch for the platform pages was written and then cut: it could not
#     be verified here — Chrome does not honour Emulation.setEmulatedMedia for
#     display-mode — and it bought nothing start_url did not already cover.)
#     NEVER ON A RELOAD (2026-09-17): a reload is not a launch. The owner saw
#     the splash replay mid-session — a service-worker heal-reload, fired
#     because the edge's per-response JSD line made every page look changed
#     (docs/sw.js siteBytes, which is the cure) — and a launch screen over a
#     session already in progress reads as the app restarting itself. Only the
#     RELOAD case is spared, the one no engine can disagree about; a resume or
#     a relaunch still gets its launch screen. The FOUT gate below is NOT
#     spared: a reload paints Home's static markup exactly as a launch does.
#     LIFECYCLE (small and bounded): fade out once the app has actually
#     rendered, never before ~500ms so a fast launch cannot flash, and
#     unconditionally by 2.2s. The pseudo-elements are pointer-events:none, so
#     even a splash that somehow failed to clear could not trap the reader, and
#     the interval clears itself on any throw.
# Injected right after <head> so it runs before the stylesheet paints. Replaced
# in place when the template changes, and re-applied on every `make html`.

SPLASH_CSS = (
    # the ground, the glow and the cross, all in one element
    'html.mc-splash::before{content:"\\271D";position:fixed;inset:0;z-index:9995;'
    'display:flex;align-items:center;justify-content:center;padding-bottom:3.4rem;'
    'pointer-events:none;'
    'background:#0f1113 radial-gradient(58% 42% at 50% 43%,rgba(160,53,53,.22),transparent 70%);'
    'font:400 4.4rem/1 Georgia,"Times New Roman",serif;color:#a03535;'
    'text-shadow:0 0 30px rgba(160,53,53,.45);'
    'animation:mc-sp-rise .85s cubic-bezier(.2,.75,.25,1) both}'
    # the wordmark, settling out of a wide letter-spacing
    'html.mc-splash::after{content:"Mere Catholicity";position:fixed;left:0;right:0;'
    'top:calc(50% + 1.9rem);z-index:9996;text-align:center;pointer-events:none;'
    'font:1.05rem/1.5 Georgia,"Times New Roman",serif;color:#e8e2d5;'
    'animation:mc-sp-word .9s ease .18s both}'
    '@keyframes mc-sp-rise{0%{opacity:0;transform:translateY(14px) scale(.82)}'
    '55%{opacity:1}100%{opacity:1;transform:none}}'
    '@keyframes mc-sp-word{0%{opacity:0;letter-spacing:.5em}'
    '100%{opacity:.9;letter-spacing:.24em}}'
    # light theme
    'html.mc-splash[data-theme=light]::before{'
    'background:#fffdf7 radial-gradient(58% 42% at 50% 43%,rgba(139,26,26,.14),transparent 70%);'
    'color:#8b1a1a;text-shadow:0 0 24px rgba(139,26,26,.22)}'
    'html.mc-splash[data-theme=light]::after{color:#3a3226}'
    # the exit
    'html.mc-splash-out::before,html.mc-splash-out::after{animation:mc-sp-out .34s ease both}'
    '@keyframes mc-sp-out{to{opacity:0}}'
    # style.css carries the global reduced-motion guard, but it may not have
    # arrived yet, so this block carries its own.
    '@media (prefers-reduced-motion:reduce){html.mc-splash::before,html.mc-splash::after,'
    'html.mc-splash-out::before,html.mc-splash-out::after{animation-duration:.01ms}}'
)

FLASH_SCRIPT = (
    '<script id="mc-fout">(function(){var e=document.documentElement;'
    "function c(n){var m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?m[1]:''}"
    "try{var t=c('mc-theme')||'dark';e.setAttribute('data-theme',t);"
    "e.style.background=t==='light'?'#fffdf7':'#0f1113';"
    "var d=c('mc-dark');if(t==='dark'&&(d==='slate'||d==='ink'))e.setAttribute('data-dark',d);"
    "var l=c('mc-light');if(t==='light'&&(l==='mist'||l==='sepia'))e.setAttribute('data-light',l)}catch(x){}"
    "try{var a=true;try{a=localStorage.getItem('mc-app')!=='0'}catch(z){a=false}"
    "var p=location.pathname;var home=(p==='/'||p===''||p.slice(-11)==='/index.html');"
    "var rl=false;try{var nv=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];"
    "rl=nv?nv.type==='reload':!!(performance.navigation&&performance.navigation.type===1)}catch(z0){}"
    "if(a&&home)e.classList.add('mc-home-boot');"
    "if(a&&home&&!rl){e.classList.add('mc-splash');"
    "var s=document.createElement('style');s.id='mc-boot-css';s.textContent=" + repr(SPLASH_CSS) + ";"
    "document.head.appendChild(s);"
    "var t0=Date.now();var iv=setInterval(function(){try{"
    "var h=document.querySelector('mc-home');var m=document.querySelector('main');"
    "var ready=(h&&h.firstChild)||(m&&m.querySelector('section.comments > *,.mc-load'));"
    "var age=Date.now()-t0;if(age<500||(!ready&&age<2200))return;"
    "clearInterval(iv);e.classList.add('mc-splash-out');"
    "setTimeout(function(){e.classList.remove('mc-splash','mc-splash-out')},360)"
    "}catch(z3){clearInterval(iv);e.classList.remove('mc-splash','mc-splash-out')}},80)}"
    "if(a&&home){setTimeout(function(){var h2=document.querySelector('mc-home');"
    "if(!h2||!h2.firstChild)e.classList.remove('mc-home-boot')},2500)}}catch(x){}"
    '})();</script>'
)

FLASH_RE = re.compile(r'<script id="mc-fout">.*?</script>', re.S)


def inject_flash(html):
    """Add the anti-flash head script right after <head>; replace a stale copy."""
    m = FLASH_RE.search(html)
    if m:
        return html if m.group(0) == FLASH_SCRIPT else FLASH_RE.sub(
            lambda _: FLASH_SCRIPT, html, count=1)
    return re.sub(r'(<head[^>]*>)', lambda m2: m2.group(1) + '\n' + FLASH_SCRIPT, html, count=1)


def clean_title(title_html):
    """The page <title>'s inner text without the brand suffix, so og:title is the
    clean work title (the brand lives in og:site_name). Already HTML-escaped —
    it came out of the document — so it is never escaped again."""
    return re.sub(r'\s*\|\s*Mere Catholicity\s*$', '', title_html.strip())


def catalog():
    """{'anf01.html': ('Vol. I. The Apostolic Fathers…', 'Ante-Nicene Fathers')},
    parsed from docs/library.html by the Library's one catalog parser. That page
    IS the shelf list a reader browses, so the card and the shelf cannot
    disagree. Absent (a tree where `make content` has not run) → {}, and every
    page falls back to DESC rather than the build failing over a share card."""
    try:
        with open(LIBRARY, encoding='utf-8') as f:
            html = f.read()
    except FileNotFoundError:
        return {}
    cat = Catalog()
    cat.feed(html)
    return {w['href']: (w['title'], w['shelf']) for w in cat.works if w['shelf']}


def parts_index():
    """{'anf03-apology.html': {volume, title, group, n, of}}, with the volumes —
    docs/library-parts.json, written by scripts/split_volumes.py. A part page is
    not in the Library catalog (the shelf lists the VOLUME), so without this
    every one of the ten thousand parts would wear the one generic sentence —
    which is the defect this file was written to end, at a new scale."""
    try:
        with open(PARTS, encoding='utf-8') as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return {}
    volumes = manifest.get('volumes', {})
    out = {}
    for name, part in manifest.get('parts', {}).items():
        vol = volumes.get(part.get('volume'), {})
        out[name] = dict(part, volume_short=vol.get('short') or vol.get('title', ''))
    return out


def describe_part(part):
    """A part's own description: what it is, what it belongs to, and where in
    the volume it stands — which is what makes it unlike its 175 neighbours."""
    where = part.get('group') or part.get('volume_short') or part.get('volume_title', '')
    # the corpus titles carry their own full stops ('Apology.', 'The Five Books
    # Against Marcion.'), and a sentence built on one reads 'Marcion., part 142'
    return ('%s — %s, part %d of %d, in the Mere Catholicity Library.'
            % (part.get('title', '').rstrip(), where.rstrip().rstrip('.'),
               part.get('n', 1), part.get('of', 1)))


def describe(name, works):
    """A Library page's own description: the work, then the shelf it stands on.
    Mechanical on purpose — 233 works, one formula, no prose to drift — and the
    shelf is what a title alone does not say ("The Aeneid of Virgil" tells a
    reader nothing about why this site hosts Virgil; "from The philosophers, and
    the religion of Rome" does)."""
    work = works.get(name)
    if not work:
        return DESC
    return work[0] + ' — from ' + work[1] + ', in the Mere Catholicity Library.'


def esc(s):
    return (s.replace('&', '&amp;').replace('"', '&quot;')
            .replace('<', '&lt;').replace('>', '&gt;'))


def card(title, url, desc, og_type='book', extra=()):
    """One page's fenced card. `title` arrives already HTML-escaped (it is the
    document's own <title> text); everything else is plain text and escaped."""
    tags = [
        ('meta name="description"', esc(desc)),
        ('meta property="og:type"', og_type),
        ('meta property="og:site_name"', 'Mere Catholicity'),
        ('meta property="og:title"', title),
        ('meta property="og:description"', esc(desc)),
        ('meta property="og:url"', esc(url)),
        ('meta property="og:image"', esc(IMAGE)),
        ('meta name="twitter:card"', 'summary_large_image'),
        ('meta name="twitter:title"', title),
        ('meta name="twitter:description"', esc(desc)),
        ('meta name="twitter:image"', esc(IMAGE)),
    ] + [(a, esc(v)) for a, v in extra]
    body = '\n'.join('<' + a + ' content="' + v + '">' for a, v in tags)
    return FENCE_OPEN + '\n' + body + '\n' + FENCE_CLOSE


def legacy_card(title, url):
    """The unfenced block this script wrote before 2026-09-17 — the generic
    "A primary source…" card, byte for byte, so a pages tree restored from the
    build cache can have it REMOVED by exact match and the real card put in its
    place. A shim: see tests/_support/retirements.json. Once every cached tree
    has turned over, this and its caller go, and the fence is the only road."""
    tags = [
        ('meta name="description"', esc(DESC)),
        ('meta property="og:type"', 'book'),
        ('meta property="og:site_name"', 'Mere Catholicity'),
        ('meta property="og:title"', title),
        ('meta property="og:description"', esc(DESC)),
        ('meta property="og:url"', esc(url)),
        ('meta property="og:image"', esc(IMAGE)),
        ('meta name="twitter:card"', 'summary_large_image'),
        ('meta name="twitter:title"', title),
        ('meta name="twitter:description"', esc(DESC)),
        ('meta name="twitter:image"', esc(IMAGE)),
    ]
    return '\n'.join('<' + a + ' content="' + v + '">' for a, v in tags)


def place_card(html, block, title_tag):
    """Rewrite the fenced card in place, or put a new one after <title>."""
    if FENCE_RE.search(html):
        return FENCE_RE.sub(lambda _: block, html, count=1)
    return html.replace(title_tag, title_tag + '\n' + block, 1)


def uncard(html):
    """Take our card away — for a page that has become noindex since it was
    given one. Keeping such a card current is worse than never writing it."""
    return UNCARD_RE.sub('', html)


def main():
    works = catalog()
    parts = parts_index()
    written = skipped = flashed = shimmed = 0
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        # turnstile.html is not a page of the site: it is a 300x65 same-origin
        # iframe holding nothing but the Cloudflare challenge widget, kept
        # deliberately free of nav.js, the app shell and the service worker so
        # that nothing can make it heavier than its one job. A theme-flash
        # script and a set of Open Graph cards on an invisible iframe are noise
        # at best, and the whole point of that page is that it stays minimal.
        if name == 'turnstile.html':
            continue
        path = os.path.join(DOCS, name)
        with open(path, encoding='utf-8') as f:
            html = f.read()
        orig = html
        # (1) the anti-flash head script goes in EVERY page (hand + pandoc alike)
        html = inject_flash(html)
        if html != orig:
            flashed += 1
        # (2) the card. A title is the one thing a card cannot be built without.
        m = TITLE_RE.search(html)
        title = clean_title(m.group(1)) if m and m.group(1).strip() else ''
        url = SITE + '/' + name
        if title and FENCE_OPEN not in html:
            # the shim: an old unfenced card of ours is removed, not curated
            without = html.replace('\n' + legacy_card(title, url), '', 1)
            if without != html:
                html = without
                shimmed += 1
        if not title:
            skipped += 1
        elif NOINDEX_RE.search(html):
            # a page kept out of every index (away.html, admin.html) has
            # nothing to share: it is a door, not a reading. No card is the
            # right card — and one written before the page went noindex is
            # taken away rather than kept current.
            html = uncard(html)
            skipped += 1
        elif FENCE_OPEN not in html and 'og:title' in html:
            skipped += 1          # somebody's curated card — leave it untouched
        else:
            over = OVERRIDES.get(name, {})
            desc = (describe_part(parts[name]) if name in parts
                    else describe(name, works))
            block = card(over.get('title', title), url,
                         over.get('desc') or desc,
                         over.get('og_type', 'book'), over.get('extra', ()))
            html = place_card(html, block, m.group(0))
            written += 1
        if html != orig:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(html)
    # `asserted` is every page whose card this run wrote or re-wrote from the
    # catalog; a page whose bytes already said exactly that is not touched.
    print('inject_social: asserted', written, 'cards from', len(works),
          'works on the shelves;', flashed, 'flash scripts;', shimmed,
          'legacy cards replaced; skipped', skipped)


if __name__ == '__main__':
    main()
