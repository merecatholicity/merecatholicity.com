# Cloudflare Web Analytics — the site's only measurement.
#
# The site record was made by hand on 2026-07-17 and adopted here on
# 2026-09-18 (imports.tf). It is privacy-preserving by design: no cookie, no
# cross-site identifier, no consent banner owed. site_token is PUBLIC — it
# rides in the beacon tag on every page, exactly like the Turnstile sitekeys.
#
# auto_install = FALSE, and that flag is the whole point of this file.
#
# Automatic setup asks Cloudflare to inject the beacon at the edge through a
# zone ruleset of its own. That ruleset (4f4f6eeb-b8bf-4318-a5d2-aa5840b7b4a2,
# named in this very site record) had ceased to exist — it answers not_found —
# so for two months the record said "installed" while not one page carried the
# beacon: verified against production, zero occurrences of cloudflareinsights
# on / and on /about.html. The meter measured nothing from 2026-07-17, and
# nothing anywhere went red, because an empty graph looks exactly like a site
# nobody visits.
#
# So the beacon ships from pagejs/nav.js instead — the one script every page
# already loads, where a grep finds it and tests/py/test_analytics.py holds it.
# Turning this flag off is that decision written down: two roads to one meter
# would count every view twice, and Cloudflare renders only one snippet per
# page. It stood at `true` until 2026-09-19 for one reason only — the Terraform
# token had Web Analytics READ and not write, the apply answered "failed to
# make http request", and a declaration that cannot be applied fails every
# later run and masks a real failure behind an expected red. The one account
# token writes it, so the file states the intention rather than the accident.
#
# THE TWO MOVE TOGETHER. Whoever turns this back to true must take the beacon
# OUT of pagejs/nav.js in the same commit and turn test_analytics.py around
# with it; otherwise the graph simply goes up, invisibly, for ever.
#
# The CSP already allows it: static.cloudflareinsights.com in script-src and
# cloudflareinsights.com in connect-src (rulesets.tf) — allowlisted since the
# ruleset was written, for a beacon that was never served.
# `enabled` and `lite` are NOT declared, and that is the whole reason this file
# plans clean. The RUM read the provider imports from does not return them, so
# they are null in state; declaring the values the dashboard shows (true/false)
# made every plan an update — `+ enabled`, `+ lite`, token and snippet "known
# after apply". An attribute an import cannot capture is left to the remote:
# adopt what the API answers, declare only what we mean to hold.
resource "cloudflare_web_analytics_site" "main" {
  account_id   = var.account_id
  zone_tag     = var.zone_id
  auto_install = false
}
