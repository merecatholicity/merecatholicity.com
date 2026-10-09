"""The Content-Security-Policy in terraform/rulesets.tf carries exactly the
hashes of the site's two inline scripts (scripts/csp_hashes.py computes them
from the same sources the pages are built from), names the collector as
report-uri and report-to, and the Reporting-Endpoints header names it too
(P2-7, 2026-09-16). What would break silently: a change to the anti-flash
script or the Turnstile bridge that the policy no longer hashes — every page
would report (and, once enforced, lose) its first script; a report directive
pointing at a door that does not exist. Since 2026-10-08 the policy is ENFORCED
with Trusted Types, and HSTS (preload) and COOP sit beside it: a header quietly
falling back to Report-Only, a script host the CSP admits but the `default`
policy in nav.js refuses (or the reverse), would each break or open the site
without a sound."""
import datetime
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
        # The enforced policy is a dynamic expression (a fresh nonce per response):
        # concat("…'nonce-", uuidv4(cf.random_seed), "' …"). Read back as one string
        # with NONCE where the edge mints it.
        m = re.search(r'Content-Security-Policy = \{\s*expression = "((?:[^"\\]|\\.)*)"', self.tf)
        self.assertIsNotNone(m, 'the CSP header in the response-headers rule')
        self.expr = m.group(1).replace('\\"', '"')
        self.assertTrue(self.expr.startswith('concat("') and self.expr.endswith('")'), self.expr[:40])
        self.policy = self.expr[len('concat("'):-2].replace('", uuidv4(cf.random_seed), "', 'NONCE')

    def test_exactly_the_two_inline_scripts_are_hashed(self):
        want = csp_hashes.hashes()
        script_src = [d for d in self.policy.split(';') if d.strip().startswith('script-src')][0]
        for name, tok in want.items():
            self.assertIn(tok, script_src, name + ' has changed: re-run scripts/csp_hashes.py and move the ruleset with it')
        hashes_in_policy = re.findall(r"'sha256-[A-Za-z0-9+/=]+'", script_src)
        self.assertEqual(sorted(hashes_in_policy), sorted(set(want.values()) | set(csp_hashes.OVERLAP)),
                         'no hash the site does not need, beyond a listed overlap')
        self.assertNotIn("'unsafe-inline'", script_src)
        self.assertNotIn("'unsafe-eval'", self.policy)

    def test_an_overlap_is_temporary(self):
        """A moving hash rides both ways for one deploy (csp_hashes.OVERLAP); past
        its date the extra token is a second door nobody remembers opening."""
        today = datetime.date.today().isoformat()
        for tok, until in csp_hashes.OVERLAP.items():
            self.assertRegex(until, r'^\d{4}-\d{2}-\d{2}$', tok)
            self.assertLessEqual(today, until, tok + ' outlived its overlap: drop it from the policy and from OVERLAP')
            self.assertNotIn(tok, csp_hashes.hashes().values(), 'a current hash is not an overlap')

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


    def header(self, name):
        m = re.search(re.escape(name) + r' = \{\s*expression = null\s*operation\s*=\s*"set"\s*value\s*=\s*"([^"]+)"', self.tf)
        self.assertIsNotNone(m, name + ' in the response-headers rule')
        return m.group(1)

    def test_the_policy_is_enforced_and_cloudflare_s_script_carries_a_fresh_nonce(self):
        """Bot Fight Mode's JavaScript Detections snippet is injected inline with new
        bytes every response; the owner keeps it on (2026-10-09), so the enforced
        policy carries a nonce minted per response, which Cloudflare stamps onto the
        scripts it injects. A static nonce would be no nonce at all."""
        script_src = [d for d in self.policy.split(';') if d.strip().startswith('script-src')][0]
        self.assertIn("'nonce-NONCE'", script_src, 'the nonce is uuidv4(cf.random_seed), minted at the edge')
        self.assertEqual(self.expr.count('uuidv4(cf.random_seed)'), 1)
        self.assertNotRegex(self.tf, r"'nonce-[0-9a-f-]{8,}'", 'never a fixed nonce')
        self.assertIn("'report-sample'", script_src, 'the collector tells Cloudflare\'s snippet from ours by its sample')
        self.assertNotIn('require-trusted-types-for', self.policy, 'Trusted Types would refuse the snippet inside its own iframe')

    def test_trusted_types_reports(self):
        tt = self.header('Content-Security-Policy-Report-Only')
        self.assertIn("require-trusted-types-for 'script'", tt)
        self.assertIn('trusted-types default mc-doc lit-html', tt, 'nav.js\'s default, the shell\'s mc-doc, Lit\'s own')
        self.assertIn('report-uri /api/comments/csp-report', tt)

    def test_the_trusted_types_policy_admits_exactly_the_script_hosts(self):
        script_src = [d for d in self.policy.split(';') if d.strip().startswith('script-src')][0]
        hosts = sorted(t for t in script_src.split() if t.startswith('https://'))
        with open(os.path.join(ROOT, 'pagejs', 'nav.js'), encoding='utf-8') as f:
            nav = f.read()
        m = re.search(r'var SCRIPT_ORIGINS = \[([^\]]*)\]', nav)
        self.assertIsNotNone(m, 'the default policy\'s origins in nav.js')
        self.assertEqual(sorted(re.findall(r"'([^']+)'", m.group(1))), hosts,
                         'a script host goes in BOTH the CSP and nav.js\'s policy')
        self.assertLess(nav.index("createPolicy('default'"), nav.index('createElement('),
                        'the policy is made before nav.js touches its first sink')
        with open(os.path.join(ROOT, 'docs', 'turnstile.html'), encoding='utf-8') as f:
            ts = f.read()
        self.assertLess(ts.index("createPolicy('default'"), ts.index("createElement('script')"))

    def test_hsts_is_preloadable_and_coop_isolates(self):
        hsts = self.header('Strict-Transport-Security')
        age = int(re.search(r'max-age=(\d+)', hsts).group(1))
        self.assertGreaterEqual(age, 31536000, 'the preload list asks for at least a year')
        self.assertIn('includeSubDomains', hsts)
        self.assertIn('preload', hsts)
        self.assertEqual(self.header('Cross-Origin-Opener-Policy'), 'same-origin')


if __name__ == '__main__':
    unittest.main()
