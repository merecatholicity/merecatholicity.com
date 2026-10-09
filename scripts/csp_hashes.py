#!/usr/bin/env python3
"""scripts/csp_hashes.py — the CSP hashes of the site's two inline scripts (P2-7,
2026-09-16), and the policy Terraform must carry.

The zone's Content-Security-Policy allows inline script only by hash. The site
has exactly two inline scripts: the `mc-fout` anti-flash script that
scripts/inject_social.py puts at the head of every page (one text, so one
hash covers ~270 pages) and the Turnstile bridge in docs/turnstile.html. A
hash covers the script element's text exactly — every byte between <script…>
and </script> — so it is computed from the same sources the pages are built
from, never typed. Prints the two `'sha256-…'` tokens; tests/py/test_csp.py
asserts terraform/rulesets.tf carries exactly them, so a change to either
script fails the suite until the ruleset moves with it."""
import base64
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))


def token(text):
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode('utf-8')).digest()).decode('ascii') + "'"


def fout_script():
    import inject_social  # noqa: E402  (the FLASH_SCRIPT string is the one source)
    m = re.match(r'<script id="mc-fout">(.*)</script>$', inject_social.FLASH_SCRIPT, re.S)
    return m.group(1)


def turnstile_script():
    with open(os.path.join(ROOT, 'docs', 'turnstile.html'), encoding='utf-8') as f:
        html = f.read()
    m = re.search(r'<script>(.*?)</script>', html, re.S)
    return m.group(1)


# A HASH MOVES IN THREE DEPLOYS, NEVER ONE (2026-10-08). The policy is enforced,
# so a page whose inline script the header does not hash loses that script, and
# the site and the header ship on different roads: the site on push, the header
# behind the terraform-production gate. So the policy first carries BOTH hashes
# (the arriving one listed here, applied before the site changes), then the
# site changes (the departing one listed here), then a third push drops it.
# Each entry is an extra token the policy may carry and the date it must be gone
# by; tests/py/test_csp.py fails past that date, so an overlap cannot be
# forgotten into a permanent second door.
OVERLAP = {}


def hashes():
    return {'mc-fout': token(fout_script()), 'turnstile.html': token(turnstile_script())}


if __name__ == '__main__':
    for name, tok in hashes().items():
        print('%-16s %s' % (name, tok))
