# Cloudflare Web Analytics — the site's only measurement.
#
# The site record was made by hand on 2026-07-17 and adopted here on 2026-09-18
# (imports.tf). It is privacy-preserving by design: no cookie, no cross-site
# identifier, no consent banner owed. site_token is PUBLIC — it rides in the
# beacon tag on every page, exactly like the Turnstile sitekeys.
#
# auto_install = FALSE, and that flag is the whole point of this file. The
# beacon ships from pagejs/nav.js — the one script every page already loads,
# where a grep finds it and tests/py/test_analytics.py holds it. Automatic setup
# would have Cloudflare inject a second beacon at the edge, and two roads to one
# meter count every view twice: Cloudflare renders only one snippet per page.
#
# The edge injector the site record still names,
# 4f4f6eeb-b8bf-4318-a5d2-aa5840b7b4a2, does not exist in this zone — the
# ruleset 404s, which is why the beacon is in nav.js at all. It is named here so
# the next reader can check it themselves rather than assume.
#
# THE TWO MOVE TOGETHER. Whoever turns this back to true must take the beacon
# OUT of pagejs/nav.js in the same commit and turn test_analytics.py around with
# it; otherwise the graph simply goes up, invisibly, for ever.
#
# The CSP already allows it: static.cloudflareinsights.com in script-src and
# cloudflareinsights.com in connect-src (rulesets.tf).
#
# STILL INJECTING, AND STILL 404ing — measured on production 2026-09-19, after
# this file's apply reported "plan: no changes" (so the declaration above and the
# remote already agree). Two facts the declaration does not cover:
#   1. Every page still carries an edge-injected beacon —
#      static.cloudflareinsights.com/beacon.min.js/v31edd6df95cf4e85bb4c19e7a9bdbcba…
#      — so a real reader's document holds that one AND nav.js's `?token=` one.
#      It is NOT this resource's `auto_install` (false here, clean plan, and the
#      named injector ruleset really does 404), so it comes from a control this
#      file does not declare — the zone's own RUM/Browser Insights switch is the
#      first place to look, and it is a dashboard act.
#      Measure it with a BROWSER's Accept header or you will measure nothing:
#        curl -s https://merecatholicity.com/about.html -H 'User-Agent: <browser>' \
#          -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
#          | grep -c cloudflareinsights     # 1 — while `Accept: */*` shows 0
#      (the edge decides what to inject from the request; the same trap as
#      bot_management's varying injections.)
#   2. Both beacons report into a 404: one POST to /cdn-cgi/rum, 407 bytes,
#      HTTP 404, watched in a real Chrome; a GET there answers 405, so the edge
#      owns the path and the collector is refusing this site. Nothing has been
#      counted by either road. Diagnosing that needs the dashboard's site record
#      for token 9eb9b8d0…, which is the owner's act.
#
# `enabled` and `lite` are NOT declared, and that is the whole reason this file
# plans clean. The RUM read the provider imports from does not return them, so
# they are null in state; declaring the values the dashboard shows made every
# plan an update — `+ enabled`, `+ lite`, token and snippet "known after apply".
# An attribute an import cannot capture is left to the remote: adopt what the
# API answers, declare only what we mean to hold.
resource "cloudflare_web_analytics_site" "main" {
  account_id   = var.account_id
  zone_tag     = var.zone_id
  auto_install = false
}
