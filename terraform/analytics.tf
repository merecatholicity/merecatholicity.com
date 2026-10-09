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
# THE INJECTION, AND WHY IT IS STOPPED BY A CONFIGURATION RULE (2026-10-08).
# The edge kept injecting a beacon after the flip to false — measured with a
# browser's Accept header (`Accept: */*` is answered with a clean page), it is
# OUR token, 9eb9b8d0…, with `"r":1` in its data-cf-beacon. The site record's
# own RUM ruleset (4f4f6eeb…, an account RUM object, not a zone ruleset) still
# answers `enabled: true` beside `auto_install: false`, and the flip closed the
# same-origin collector the injected tag reports to: every page posted to
# /cdn-cgi/rum and logged a 404 (Lighthouse's "browser errors" finding; the
# nightly's BENIGN_CONSOLE line), and nav.js's own beacon — a module script with
# no document.currentScript, so it could not read its `?token=` and took the
# injected tag's config instead — posted into the same 404. Nothing was counted
# from 2026-09-19 to 2026-10-08. `enabled` cannot be declared here (below), so
# the injection is stopped where Cloudflare documents it: a configuration rule
# with `disable_rum`, which takes precedence over any Web Analytics rule. It
# reaches only this zone's requests — the manual beacon reports to
# cloudflareinsights.com, another host — and nav.js now loads it as a classic
# script (watched in a real Chrome: one POST to cloudflareinsights.com, 204).
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

# The one control that stops the edge injecting the beacon (above). Every
# request: an injected tag on any HTML page is a second road to the meter, and
# the zone has no other configuration rule for this one to sit beside.
resource "cloudflare_ruleset" "config_settings" {
  account_id = null
  kind       = "zone"
  name       = "default"
  phase      = "http_config_settings"
  rules = [
    {
      action = "set_config"
      action_parameters = {
        additional_cacheable_ports = null
        algorithms                 = null
        asset_name                 = null
        automatic_https_rewrites   = null
        autominify                 = null
        bic                        = null
        browser_ttl                = null
        cache                      = null
        cache_key                  = null
        cache_reserve              = null
        content                    = null
        content_converter          = null
        content_type               = null
        cookie_fields              = null
        disable_apps               = null
        disable_rum                = true
        disable_zaraz              = null
        edge_ttl                   = null
        email_obfuscation          = null
        expression                 = null
        fonts                      = null
        from_list                  = null
        from_value                 = null
        headers                    = null
        host_header                = null
        hotlink_protection         = null
        id                         = null
        immutable                  = null
        increment                  = null
        matched_data               = null
        max_age                    = null
        mirage                     = null
        must_revalidate            = null
        must_understand            = null
        no_cache                   = null
        no_store                   = null
        no_transform               = null
        operation                  = null
        opportunistic_encryption   = null
        origin                     = null
        origin_cache_control       = null
        origin_error_page_passthru = null
        overrides                  = null
        phases                     = null
        polish                     = null
        private                    = null
        products                   = null
        proxy_revalidate           = null
        public                     = null
        raw_response_fields        = null
        read_timeout               = null
        redirects_for_ai_training  = null
        request_body_buffering     = null
        request_fields             = null
        respect_strong_etags       = null
        response                   = null
        response_body_buffering    = null
        response_fields            = null
        rocket_loader              = null
        rules                      = null
        ruleset                    = null
        rulesets                   = null
        s_maxage                   = null
        security_level             = null
        serve_stale                = null
        server_side_excludes       = null
        sni                        = null
        ssl                        = null
        stale_if_error             = null
        stale_while_revalidate     = null
        status_code                = null
        strip_etags                = null
        strip_last_modified        = null
        strip_set_cookie           = null
        sxg                        = null
        transformed_request_fields = null
        uri                        = null
        values                     = null
        vary                       = null
      }
      description = "No edge-injected Web Analytics beacon: the meter is pagejs/nav.js's alone (terraform/analytics.tf)"
      enabled     = true
      expression  = "true"
      ref         = null
    },
  ]
  zone_id = var.zone_id
}
