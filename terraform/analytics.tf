# Cloudflare Web Analytics — the site's only measurement.
#
# The site record was made by hand on 2026-07-17 and adopted here on
# 2026-09-18 (imports.tf). It is privacy-preserving by design: no cookie, no
# cross-site identifier, no consent banner owed. site_token is PUBLIC — it
# rides in the beacon tag on every page, exactly like the Turnstile sitekeys.
#
# auto_install = true is NOT a preference — it is the state this pipeline can
# hold, and the reason is worth reading before anyone "fixes" it.
#
# Automatic setup asks Cloudflare to inject the beacon at the edge through a
# zone ruleset of its own. That ruleset (4f4f6eeb-b8bf-4318-a5d2-aa5840b7b4a2,
# named in this very site record) NO LONGER EXISTS in the zone — it answers
# not_found — so for two months the record said "installed" while not one page
# carried the beacon: verified against production, zero occurrences of
# cloudflareinsights on / and on /about.html. The meter has measured nothing
# since 2026-07-17, and nothing anywhere went red, because an empty graph looks
# exactly like a site nobody visits.
#
# So the beacon ships from docs/nav.js instead, the one script every page
# already loads, where a grep finds it and a test holds it. Turning auto_install
# OFF is what this file wanted — two roads to one meter would count every view
# twice — but the apply failed with the provider's "failed to make http
# request", the same signature the D1 write gave: the Terraform token has Web
# Analytics READ and not WRITE. Widening it is the owner's act (Cloudflare API
# token → Account → Web Analytics → Edit). Until then the declaration states
# the truth rather than an intention, and the doubling it guards against cannot
# happen anyway while the injector ruleset is missing.
#
# THE TWO MOVE TOGETHER. Whoever widens the token must also decide which road
# keeps the meter, and do both in one change: flipping this to false with the
# beacon still in docs/nav.js is fine (one road, ours), but flipping it to true
# while nav.js also ships the beacon counts every view twice, invisibly — the
# graph simply goes up. Turning this into an edge install means taking the
# beacon OUT of nav.js in the same commit, and turning tests/py/test_analytics.py
# around with it.
#
# The CSP already allows it: static.cloudflareinsights.com in script-src and
# cloudflareinsights.com in connect-src (rulesets.tf) — allowlisted since the
# ruleset was written, for a beacon that was never served.
resource "cloudflare_web_analytics_site" "main" {
  account_id   = var.account_id
  zone_tag     = var.zone_id
  auto_install = true
  enabled      = true
  lite         = false
}
