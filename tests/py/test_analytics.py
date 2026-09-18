"""The meter, and the two ways it goes dark or double.

Cloudflare Web Analytics was created for this zone on 2026-07-17 with automatic
setup — Cloudflare injecting the beacon at the edge — and it measured nothing
for two months. The site record still said `auto_install: true, enabled: true`
while the zone ruleset that does the injecting (4f4f6eeb-b8bf-4318-a5d2-
aa5840b7b4a2, named in that record) had ceased to exist; a fetch of the live
HTML found zero occurrences of `cloudflareinsights` on the home page. Nothing
was red, because nothing on this side of the wire had ever been asked.

So the beacon ships from docs/nav.js — the one script every page already loads
— where a grep finds it and this test holds it. Two things would break
silently:

  * The tag stops being served (a nav.js edit, a token that no longer matches
    the site) and the numbers quietly go to zero — which looks exactly like
    nobody visiting.
  * auto_install is turned back on while nav.js still carries the tag, and
    every page view is counted twice by two beacons that cannot see each
    other. Cloudflare's own note: only one snippet may be rendered per page.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Public by design, exactly like the Turnstile sitekeys: it names the site being
# measured and authorises nothing. Read from the live API on 2026-09-18.
SITE_TOKEN = '9eb9b8d07c9c4503bca7e8749904638f'
BEACON_HOST = 'static.cloudflareinsights.com'


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return f.read()


class TheBeacon(unittest.TestCase):
    def setUp(self):
        self.nav = read('docs', 'nav.js')

    def test_every_page_carries_it(self):
        """nav.js is the one script every page already loads — the same reason
        deeplink.js lives there. A beacon in the page templates instead would
        have to be re-injected into 274 files, and missed the next one."""
        self.assertIn(BEACON_HOST + '/beacon.min.js', self.nav)
        self.assertEqual(self.nav.count(BEACON_HOST), 1, 'one beacon, once')

    def test_the_token_is_the_zone_s_own_site(self):
        self.assertIn('token=' + SITE_TOKEN, self.nav,
                      'the beacon names a site that is not this zone\'s')

    def test_the_token_rides_the_url_not_a_data_attribute(self):
        """A module script has no document.currentScript, so a beacon injected
        by another script cannot be handed its token through data-cf-beacon.
        `?token=` is the form Cloudflare documents for exactly this case."""
        self.assertIn("b.type = 'module'", self.nav)
        self.assertNotIn('data-cf-beacon', self.nav)

    def test_automation_is_not_a_reader(self):
        """The nightly headless run against production would otherwise post
        itself into the numbers every night, and every 'which page first'
        decision would be answered by our own robot."""
        self.assertIn('navigator.webdriver', self.nav)

    def test_a_dev_box_is_not_measured(self):
        self.assertIn('merecatholicity', re.search(
            r'if \(!/\(\^\|\\\.\)([^/]*)/\.test\(location\.hostname\)\) return;',
            self.nav).group(1))


class TheDeclaration(unittest.TestCase):
    def setUp(self):
        self.tf = read('terraform', 'analytics.tf')
        self.imports = read('terraform', 'imports.tf')

    def test_the_site_is_declared_and_adopted(self):
        """Made by hand in July; Cloudflare settings live in terraform/ or they
        are drift (CLAUDE.md), so it carries an import block of its own."""
        self.assertIn('resource "cloudflare_web_analytics_site" "main"', self.tf)
        self.assertIn('to = cloudflare_web_analytics_site.main', self.imports)

    def test_the_state_of_the_edge_injector_is_stated_not_assumed(self):
        """THE rule of this file: one meter, one road, and the declaration says
        which. Two roads would count every view twice and the doubling is
        invisible — the graph just goes up.

        auto_install is TRUE here, which is not what this change wanted: the
        apply that would have turned it off failed with "failed to make http
        request", the Terraform token's signature for a permission it does not
        have. It is harmless while the edge injector it names is missing (the
        ruleset 404s — that is why the beacon is in nav.js at all), and the
        file names the ruleset so the next reader can check it for themselves.
        Widen the token and this test turns around with the declaration."""
        self.assertRegex(self.tf, r'auto_install\s*=\s*(true|false)')
        self.assertIn('4f4f6eeb-b8bf-4318-a5d2-aa5840b7b4a2', self.tf,
                      'the injector this meter does NOT use must be named, or the '
                      'next reader turns automatic setup back on and doubles the numbers')


class ThePolicy(unittest.TestCase):
    def test_the_csp_lets_the_beacon_load_and_report(self):
        """Both hosts were allowlisted before there was anything to allow. The
        beacon loads from static.cloudflareinsights.com and, under manual
        installation, reports to cloudflareinsights.com — not to /cdn-cgi/rum,
        which is the automatic road's endpoint."""
        policy = re.search(
            r'Content-Security-Policy(?:-Report-Only)? = \{\s*expression = null\s*'
            r'operation\s*=\s*"set"\s*value\s*=\s*"([^"]+)"',
            read('terraform', 'rulesets.tf')).group(1)
        parts = {d.strip().split(' ')[0]: d for d in policy.split(';')}
        self.assertIn('https://' + BEACON_HOST, parts['script-src'])
        self.assertIn('https://cloudflareinsights.com', parts['connect-src'])


if __name__ == '__main__':
    unittest.main()
