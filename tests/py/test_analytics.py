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
        self.nav = read('pagejs', 'nav.js')

    def test_every_page_carries_it(self):
        """nav.js is the one script every page already loads — the same reason
        deeplink.js lives there. A beacon in the page templates instead would
        have to be re-injected into 274 files, and missed the next one."""
        self.assertIn(BEACON_HOST + '/beacon.min.js', self.nav)
        self.assertEqual(self.nav.count(BEACON_HOST + '/beacon.min.js'), 1, 'one beacon, once (the host is also named by the Trusted Types policy\'s origins)')

    def test_the_token_is_the_zone_s_own_site(self):
        self.assertIn('token=' + SITE_TOKEN, self.nav,
                      'the beacon names a site that is not this zone\'s')

    def test_the_token_rides_the_url_not_a_data_attribute(self):
        """`?token=` is the form Cloudflare documents for a beacon injected by
        another script, and the beacon reads it from document.currentScript.src.
        A MODULE script has no currentScript (2026-10-08): the beacon then fell
        back to whatever `script[data-cf-beacon]` the page held — the edge's
        injected tag, whose config sends it to the same-origin /cdn-cgi/rum, a
        404 — and with none it finds no token and counts nothing. So the tag is
        a classic script, and carries no data-cf-beacon of its own."""
        self.assertNotIn('b.type', self.nav.split('THE METER')[1].split('The app shell')[0])
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

        auto_install is FALSE since 2026-09-19: one meter, one road, and the
        road is pagejs/nav.js. The edge injector the site record names is
        missing anyway (the ruleset 404s — that is why the beacon is in nav.js
        at all), and the file names it so the next reader can check rather than
        assume. Turning this back to true means taking the beacon out of nav.js
        in the same commit, and turning this test around with it."""
        self.assertRegex(self.tf, r'auto_install\s*=\s*(true|false)')
        self.assertIn('4f4f6eeb-b8bf-4318-a5d2-aa5840b7b4a2', self.tf,
                      'the injector this meter does NOT use must be named, or the '
                      'next reader turns automatic setup back on and doubles the numbers')


    def test_the_edge_injects_no_second_beacon(self):
        """auto_install=false did not stop the edge injecting (2026-10-08): the
        site record's RUM ruleset still answers enabled, and `enabled` cannot be
        declared on the site without an update in every plan. The injected tag
        reported to the same-origin collector the flip closed — a 404 on every
        page — and, being the only `script[data-cf-beacon]`, it was also what
        nav.js's beacon read its config from. A configuration rule turning RUM
        off for every request is what holds the injection off."""
        rule = re.search(r'resource "cloudflare_ruleset" "config_settings" \{(.*?)\n\}', self.tf, re.S)
        self.assertIsNotNone(rule, 'the rule that stops the edge injecting lives beside the site')
        body = rule.group(1)
        self.assertIn('phase      = "http_config_settings"', body)
        self.assertRegex(body, r'disable_rum\s+= true')
        self.assertRegex(body, r'expression\s+= "true"')
        self.assertRegex(body, r'enabled\s+= true')

class ThePolicy(unittest.TestCase):
    def test_the_csp_lets_the_beacon_load_and_report(self):
        """Both hosts were allowlisted before there was anything to allow. The
        beacon loads from static.cloudflareinsights.com and, under manual
        installation, reports to cloudflareinsights.com — not to /cdn-cgi/rum,
        which is the automatic road's endpoint."""
        # the whole policy rides the Report-Only header (2026-10-09)
        policy = re.search(
            r'Content-Security-Policy-Report-Only = \{\s*expression = null\s*'
            r'operation\s*=\s*"set"\s*value\s*=\s*"([^"]+)"',
            read('terraform', 'rulesets.tf')).group(1)
        parts = {d.strip().split(' ')[0]: d for d in policy.split(';')}
        self.assertIn('https://' + BEACON_HOST, parts['script-src'])
        self.assertIn('https://cloudflareinsights.com', parts['connect-src'])


if __name__ == '__main__':
    unittest.main()
