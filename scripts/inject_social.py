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
    "if(a&&home){e.classList.add('mc-home-boot');e.classList.add('mc-splash');"
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
