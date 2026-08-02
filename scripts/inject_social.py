#!/usr/bin/env python3
"""Give every docs/*.html a social-share card, derived from its own <title>.

The primary-source Library pages (Schaff, Newman, the Fathers, the Bibles, the
Summa, the Catena, the classics) are pandoc-built with no Open Graph tags; this
injects a title-specific card into each without editing the dozens of build
stanzas (and the generated *.mk files) that produce them. Pages that ALREADY
carry an og:title — the hand pages and the content.py pages, which have curated
per-page cards — are skipped untouched.

Idempotent (the og:title guard) and deterministic (fixed tags from the title).
Wired into `make html` after the resources build so a corpus rebuild re-injects;
also runnable standalone over the committed docs/ tree."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SITE = 'https://merecatholicity.com'
IMAGE = SITE + '/cover.jpg'
DESC = 'A primary source in the Mere Catholicity Library.'

TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)

# A tiny SYNCHRONOUS head script that kills the two load flashes:
#  1) Theme: set data-theme (+ palette) from the cookie BEFORE first paint, so a
#     page never renders in the wrong theme and then flip (the "dark flash").
#     Default dark, matching nav.js's effective() — nav.js re-applies it later.
#  2) Home: on index.html (app mode), hide the static book-promo content until the
#     <mc-home> launcher mounts, so the home page doesn't flash its static markup
#     ("The Book" flash) first. A 4s safety reveals it if the launcher never mounts
#     (JS error / ?app=0 is handled by the localStorage check).
# Injected right after <head> so it runs before the stylesheet paints. Idempotent
# via the id, and re-applied on every `make html`.
FLASH_SCRIPT = (
    '<script id="mc-fout">(function(){var e=document.documentElement;'
    "function c(n){var m=document.cookie.match('(?:^|; )'+n+'=([^;]*)');return m?m[1]:''}"
    "try{var t=c('mc-theme')||'dark';e.setAttribute('data-theme',t);"
    "var d=c('mc-dark');if(t==='dark'&&(d==='slate'||d==='ink'))e.setAttribute('data-dark',d);"
    "var l=c('mc-light');if(t==='light'&&(l==='mist'||l==='sepia'))e.setAttribute('data-light',l)}catch(x){}"
    "try{var a=true;try{a=localStorage.getItem('mc-app')!=='0'}catch(z){a=false}"
    "var p=location.pathname;if(a&&(p==='/'||p===''||p.slice(-11)==='/index.html')){"
    "e.classList.add('mc-home-boot');"
    "setTimeout(function(){if(!document.querySelector('mc-home'))e.classList.remove('mc-home-boot')},4000)}}catch(x){}"
    '})();</script>'
)


def inject_flash(html):
    """Add the anti-flash head script right after <head>, unless already there."""
    if 'id="mc-fout"' in html:
        return html
    return re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + FLASH_SCRIPT, html, count=1)


def esc(s):
    return (s.replace('&', '&amp;').replace('"', '&quot;')
            .replace('<', '&lt;').replace('>', '&gt;'))


def card(title_html, url):
    # title_html is the already-HTML-escaped inner text of <title>; drop a
    # " | Mere Catholicity" suffix so og:title is the clean work title.
    t = re.sub(r'\s*\|\s*Mere Catholicity\s*$', '', title_html.strip())
    desc = esc(DESC)
    tags = [
        ('meta name="description"', t and desc or desc),
        ('meta property="og:type"', 'book'),
        ('meta property="og:site_name"', 'Mere Catholicity'),
        ('meta property="og:title"', t),
        ('meta property="og:description"', desc),
        ('meta property="og:url"', esc(url)),
        ('meta property="og:image"', esc(IMAGE)),
        ('meta name="twitter:card"', 'summary_large_image'),
        ('meta name="twitter:title"', t),
        ('meta name="twitter:description"', desc),
        ('meta name="twitter:image"', esc(IMAGE)),
    ]
    return '\n'.join('<' + a + ' content="' + v + '">' for a, v in tags)


def main():
    injected = skipped = flashed = 0
    for name in sorted(os.listdir(DOCS)):
        if not name.endswith('.html'):
            continue
        path = os.path.join(DOCS, name)
        with open(path, encoding='utf-8') as f:
            html = f.read()
        orig = html
        # (1) the anti-flash head script goes in EVERY page (hand + pandoc alike)
        html = inject_flash(html)
        if html != orig:
            flashed += 1
        # (2) the social card goes only in pandoc pages that lack a curated one
        if 'og:title' in html:      # already has a curated card — leave it
            skipped += 1
        else:
            m = TITLE_RE.search(html)
            if m and m.group(1).strip():
                block = card(m.group(1), SITE + '/' + name)
                html = html.replace(m.group(0), m.group(0) + '\n' + block, 1)
                injected += 1
        if html != orig:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(html)
    print('inject_social: injected', injected, 'cards;', flashed, 'flash scripts; skipped',
          skipped, '(already carded)')


if __name__ == '__main__':
    main()
