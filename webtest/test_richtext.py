#!/usr/bin/env python3
"""Wave B3a feature test: the richtext module (app/richtext.js) as the one
living renderer. A fixture body exercises every rule — headings, emphasis,
custom emoji from the same-origin whitelist, named emoji, unknown codes
staying literal, blockquotes, Scripture autolinks with hover previews,
same-site links direct, off-site links routed through away.html — rendered
through window.mcRich on community.html, one of the app pages that always
carries the classic client (where the hover subsystem boots), with the
desktop pointer emulated. Never an article page: since 2026-09-18 the shell
fetches comments.js for one only when the admin has opened its section, and
they ship closed, so credo.html boots no client and no hover at all: the
nightly's "wait: timeout on !!window.mcKit" and "verse hover previews"
FAILs on 2026-10-08, the first night judged by main's kit."""
import json
import sys

from flows import Flow

FIX = ('# A heading\n**bold** and *ital* and :kekw: and :fire: and :nope: stay\n'
       '> a quote line\nSee John 3:16 and '
       '[our credo](https://merecatholicity.com/credo.html) and '
       '[out](https://example.com/x)')

# The hover's one slow step is kjv.json — the whole text, fetched on the first
# hover, a cold edge miss most nights — so the tip is POLLED for, up to this
# many ms, rather than given a fixed delay that measures the night's bandwidth
# instead of the feature (2.5 s used to, 2026-10-07).
TIP_WAIT_MS = 15000


def main():
    with Flow(port=9571, hover=True) as f:
        f.goto('community.html')
        f.wait('!!window.mcRich', timeout=15)
        # The hover listener is installed by the classic client's boot
        # (client/composer.ts run(), the last thing mcBoot does before it
        # publishes window.mcKit) — not by the bundle. A mouseover dispatched
        # before that boot meets no listener, shows no tip, and reads as the
        # feature missing.
        f.wait('!!window.mcKit', timeout=15)
        st = json.loads(f.js1("""
          var d = document.createElement('div'); d.setAttribute('data-probe', 'richtext');
          document.body.appendChild(d);
          window.mcRich.fillBody(d, %s);
          var img = d.querySelector('img.mc-emoji');
          var sl = d.querySelector('a.scripture-link');
          var links = Array.prototype.map.call(d.querySelectorAll('a'), function(a){return a.getAttribute('href')});
          return JSON.stringify({
            hd: !!d.querySelector('.mc-hd1'), bold: !!d.querySelector('strong'),
            em: !!d.querySelector('em'),
            emoji: img ? img.getAttribute('src') : null,
            fire: d.textContent.indexOf('\\ud83d\\udd25') !== -1,
            nope: d.textContent.indexOf(':nope:') !== -1,
            quote: !!d.querySelector('blockquote.comment-quote'),
            slug: sl ? sl.getAttribute('data-slug') : null,
            away: links.filter(function(h){return h && h.indexOf('away.html?url=')===0}).length,
            credo: links.indexOf('https://merecatholicity.com/credo.html') !== -1});""" % json.dumps(FIX)))
        tip = json.loads(f.js1("""
          /* The fixture's OWN reference, never the document's first: the board
             renders posts above the fixture, and a post carrying
             a reference of its own would be the one hovered — previewing the
             wrong verse, and reading as the hover broken. */
          var sl = document.querySelector('[data-probe=richtext] a.scripture-link');
          if (!sl) return JSON.stringify({shown: false, ms: 0, ref: '', text: ''});
          var t0 = Date.now();
          sl.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, clientX: 60, clientY: 60}));
          return new Promise(function (res) {
            (function poll() {
              var t = document.querySelector('.scripture-tip');
              var shown = !!t && !t.hidden && t.textContent.length > 0;
              if (shown || Date.now() - t0 > %d) {
                res(JSON.stringify({shown: shown, ms: Date.now() - t0, ref: sl.textContent,
                                    text: t ? t.textContent.slice(0, 70) : ''}));
              } else { setTimeout(poll, 100); }
            })();
          });""" % TIP_WAIT_MS))
        f.assert_console_clean('richtext')
        hovered = bool(tip['shown']) and 'God so loved' in tip['text']
        if not hovered:
            # the FAIL line says what was seen, so the nightly's report names
            # the cause and not the symptom
            f.failures.append('verse hover: tip shown=%s after %s ms over %r, text=%r'
                              % (tip['shown'], tip['ms'], tip['ref'], tip['text']))
        checks = [
            ('heading + bold + em', st['hd'] and st['bold'] and st['em']),
            ('custom emoji from whitelist', st['emoji'] == 'emoji/memes/kekw.webp'),
            ('named emoji resolves', st['fire']),
            ('unknown :code: stays literal', st['nope']),
            ('quote renders', st['quote']),
            ('scripture autolink', st['slug'] == 'john'),
            ('off-site via away.html', st['away'] == 1),
            ('same-site link direct', st['credo']),
            ('verse hover previews', hovered),
        ]
        sys.exit(f.verdict(checks))


if __name__ == '__main__':
    main()
