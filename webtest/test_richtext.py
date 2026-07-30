#!/usr/bin/env python3
"""Wave B3a feature test: the richtext module (app/richtext.js) as the one
living renderer. A fixture body exercises every rule — headings, emphasis,
custom emoji from the same-origin whitelist, named emoji, unknown codes
staying literal, blockquotes, Scripture autolinks with hover previews,
same-site links direct, off-site links routed through away.html — rendered
through window.mcRich on a comments-mounted prod page (where the hover
subsystem boots), with the desktop pointer emulated."""
import json
import sys
import time

from flows import Flow

FIX = ('# A heading\n**bold** and *ital* and :kekw: and :fire: and :nope: stay\n'
       '> a quote line\nSee John 3:16 and '
       '[our credo](https://merecatholicity.com/credo.html) and '
       '[out](https://example.com/x)')


def main():
    with Flow(port=9571, hover=True) as f:
        f.goto('credo.html')
        f.wait('!!window.mcRich', timeout=15)
        st = json.loads(f.js1("""
          var d = document.createElement('div'); document.body.appendChild(d);
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
          var sl=document.querySelector('a.scripture-link');
          sl.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:60,clientY:60}));
          return new Promise(function(res){setTimeout(function(){
            var t=document.querySelector('.scripture-tip');
            res(JSON.stringify({shown: !!t && !t.hidden, text: t? t.textContent.slice(0,70):''}));},2500);});"""))
        f.assert_console_clean('richtext')
        checks = [
            ('heading + bold + em', st['hd'] and st['bold'] and st['em']),
            ('custom emoji from whitelist', st['emoji'] == 'emoji/memes/kekw.webp'),
            ('named emoji resolves', st['fire']),
            ('unknown :code: stays literal', st['nope']),
            ('quote renders', st['quote']),
            ('scripture autolink', st['slug'] == 'john'),
            ('off-site via away.html', st['away'] == 1),
            ('same-site link direct', st['credo']),
            ('verse hover previews', tip['shown'] and 'God so loved' in tip['text']),
        ]
        sys.exit(f.verdict(checks))


if __name__ == '__main__':
    main()
