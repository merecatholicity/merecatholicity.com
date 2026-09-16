"""The Content-Security-Policy in terraform/rulesets.tf carries exactly the
hashes of the site's two inline scripts (scripts/csp_hashes.py computes them
from the same sources the pages are built from), names the collector as
report-uri and report-to, and the Reporting-Endpoints header names it too
(P2-7, 2026-09-16). What would break silently: a change to the anti-flash
script or the Turnstile bridge that the policy no longer hashes — every page
would report (and, once enforced, lose) its first script; a report directive
pointing at a door that does not exist."""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import csp_hashes  # noqa: E402


class Csp(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, 'terraform', 'rulesets.tf'), encoding='utf-8') as f:
            self.tf = f.read()
        m = re.search(r'Content-Security-Policy(?:-Report-Only)? = \{\s*expression = null\s*operation\s*=\s*"set"\s*value\s*=\s*"([^"]+)"', self.tf)
        self.assertIsNotNone(m, 'the CSP header in the response-headers rule')
        self.policy = m.group(1)

    def test_exactly_the_two_inline_scripts_are_hashed(self):
        want = csp_hashes.hashes()
        script_src = [d for d in self.policy.split(';') if d.strip().startswith('script-src')][0]
        for name, tok in want.items():
            self.assertIn(tok, script_src, name + ' has changed: re-run scripts/csp_hashes.py and move the ruleset with it')
        hashes_in_policy = re.findall(r"'sha256-[A-Za-z0-9+/=]+'", script_src)
        self.assertEqual(sorted(hashes_in_policy), sorted(want.values()), 'no hash the site does not need')
        self.assertNotIn("'unsafe-inline'", script_src)
        self.assertNotIn("'unsafe-eval'", self.policy)

    def test_the_reports_go_to_the_collector(self):
        self.assertIn('report-uri /api/comments/csp-report', self.policy)
        self.assertIn('report-to csp', self.policy)
        self.assertIn('Reporting-Endpoints = {', self.tf)
        self.assertIn('csp=\\"https://merecatholicity.com/api/comments/csp-report\\"', self.tf)
        with open(os.path.join(ROOT, 'tests', '_support', 'routes.json'), encoding='utf-8') as f:
            self.assertIn('/api/comments/csp-report', f.read(), 'the door is mounted')

    def test_the_client_needs_are_named(self):
        self.assertIn('wss://merecatholicity.com', self.policy, 'the live socket, for browsers that do not read self as wss')
        img = [d for d in self.policy.split(';') if d.strip().startswith('img-src')][0]
        media = [d for d in self.policy.split(';') if d.strip().startswith('media-src')][0]
        self.assertIn('blob:', img, 'a decrypted DM attachment is shown from an object URL')
        self.assertIn('blob:', media)


if __name__ == '__main__':
    unittest.main()
