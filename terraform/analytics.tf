# Cloudflare Web Analytics — the site's only measurement.
#
# The site record was made by hand on 2026-07-17 and adopted here on
# 2026-09-18 (imports.tf). It is privacy-preserving by design: no cookie, no
# cross-site identifier, no consent banner owed. site_token is PUBLIC — it
# rides in the beacon tag on every page, exactly like the Turnstile sitekeys.
#
# auto_install = false is DELIBERATE and is the fix for a meter that ran dark
# for two months. Automatic setup asks Cloudflare to inject the beacon at the
# edge through a zone ruleset of its own; that ruleset (4f4f6eeb-b8bf-4318-
# a5d2-aa5840b7b4a2, named in the site record) no longer exists in the zone,
# so the record said "installed" while not one page carried the beacon —
# verified against production, 0 occurrences of cloudflareinsights on / and
# /about.html. An injector that lives outside this repository and can vanish
# without a trace is not a road we can keep; the beacon now ships from
# docs/nav.js, the one script every page already loads, where a grep can find
# it and a test can hold it. Keeping auto_install off also means the two roads
# can never both fire and count every view twice.
#
# The CSP already allows it: static.cloudflareinsights.com in script-src and
# cloudflareinsights.com in connect-src (rulesets.tf) — allowlisted since the
# ruleset was written, for a beacon that was never served.
resource "cloudflare_web_analytics_site" "main" {
  account_id   = var.account_id
  zone_tag     = var.zone_id
  auto_install = false
  enabled      = true
  lite         = false
}
