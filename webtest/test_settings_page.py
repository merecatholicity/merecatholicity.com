#!/usr/bin/env python3
"""The per-section platform-settings page (?settings=1, media wave 2026-08-02).

Pure-DOM assertions as the owner (admin): the five panel headings in order,
the DM AI-scan checkbox rendered disabled AND unchecked beside the honest
E2E note, three per-section storage-budget rows with live usage, the three
per-section purge danger boxes, and the Save button. No save round-trip, no
purge click — read-only against prod.

GATED on the v=205 client being live (the v=204 page is the old flat layout).
Run: python3 webtest/test_settings_page.py
"""
import json
import re
import sys
import urllib.request

import flows
from flows import Flow

H3S = ['Media platform (global)', 'Feed & member walls', 'Community forum',
       'Inbox (direct messages)', 'Voice calls', 'The Mere Catholicity Journal']
PURGES = ['Purge all feed & wall media now', 'Purge all forum attachments now',
          'Purge all DM attachments now']


def client_version():
    req = urllib.request.Request(flows.BASE + '/community.html',
                                 headers={'User-Agent': 'curl/8.14.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        m = re.search(r'comments\.js\?v=(\d+)', r.read().decode('utf-8', 'replace'))
    return int(m.group(1)) if m else 0


def main():
    v = client_version()
    if v < 205:
        print('SKIP  test_settings_page — new client not deployed yet '
              '(prod serves comments.js?v=%d, needs v=205)' % v)
        sys.exit(0)
    checks = []
    with Flow(port=9604) as f:
        f.login()
        f.goto('community.html')
        f.wait("!!(window.mcKit && window.mcKit.isAdmin && window.mcKit.isAdmin())", timeout=20)
        f.goto('community.html?settings=1')
        f.wait("document.querySelectorAll('.admin-settings h3').length >= 6", timeout=25)
        r = json.loads(f.js1("""
          var w = document.querySelector('.admin-settings');
          var h3s = [].map.call(w.querySelectorAll('h3'), function(h){ return h.textContent; });
          /* The DM scan box: the ONE disabled checkbox on the page, unchecked,
             with the honest E2E note in the desc right after its row. */
          var dis = [].filter.call(w.querySelectorAll('input[type=checkbox]'),
                                   function(c){ return c.disabled; });
          var note = false;
          if (dis.length === 1) {
            var p = dis[0].parentElement && dis[0].parentElement.nextElementSibling;
            note = !!(p && (p.textContent||'').indexOf('end-to-end encrypted') !== -1);
          }
          var budgets = [].filter.call(w.querySelectorAll('.admin-set-row'), function(row){
            return (row.textContent||'').indexOf('Storage budget (GB)') === 0
                && (row.textContent||'').indexOf('used') !== -1;
          }).length;
          var dangers = [].map.call(w.querySelectorAll('.admin-danger-title'),
                                    function(t){ return t.textContent; });
          var save = [].some.call(w.querySelectorAll('button'),
                                  function(b){ return b.textContent === 'Save settings'; });
          return JSON.stringify({h3s: h3s, disN: dis.length,
            disUnchecked: dis.length === 1 ? !dis[0].checked : false,
            note: note, budgets: budgets, dangers: dangers, save: save});"""))
        checks.append(('panel h3 order: ' + ' / '.join(r['h3s']), r['h3s'] == H3S))
        checks.append(('exactly one disabled checkbox (the DM AI-scan box), unchecked',
                       r['disN'] == 1 and r['disUnchecked']))
        checks.append(('the honest E2E note follows it', r['note']))
        checks.append(('three per-section storage-budget rows with usage (%d)' % r['budgets'],
                       r['budgets'] == 3))
        checks.append(('all three purge danger boxes present',
                       all(p in r['dangers'] for p in PURGES)))
        checks.append(('Save settings button present', r['save']))
        checks.append(('console clean', f.assert_console_clean('settings-page')))
        fails = list(f.failures)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
