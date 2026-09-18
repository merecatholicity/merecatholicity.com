# The browser-cache rule (2026-09-18). Separate from the four above because it
# is the one ruleset that changes what a READER's own browser keeps, and the
# blast radius of getting it wrong is the one thing on this zone that no purge
# can reach.
resource "cloudflare_ruleset" "cache_settings" {
  account_id = null
  kind       = "zone"
  name       = "default"
  phase      = "http_request_cache_settings"
  rules = [
    {
      action = "set_cache_settings"
      action_parameters = {
        additional_cacheable_ports = null
        algorithms                 = null
        asset_name                 = null
        automatic_https_rewrites   = null
        autominify                 = null
        bic                        = null
        browser_ttl = {
          default = 86400
          mode    = "override_origin"
        }
        cache                      = null
        cache_key                  = null
        cache_reserve              = null
        content                    = null
        content_converter          = null
        content_type               = null
        cookie_fields              = null
        disable_apps               = null
        disable_rum                = null
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
      description = "Browser cache for content-addressed assets and the theme art. GitHub Pages sends Cache-Control: max-age=600 on everything and browser_cache_ttl=0 passes it through, so a reader re-fetched 641 KiB of unchanged bytes every ten minutes of a session. One day, NOT a year and NOT immutable: a browser cache cannot be purged, and stamp_versions.py has silently stopped cache-busting once before, so a bad key must expire on its own. Matches only ?v= stamped js/css (whose URL changes when the bytes do), the chunks and the theme art; never HTML, never sw.js (unkeyed by design, and the update pump), never version.json. EDGE ttl is untouched: the ?v= immutability law lives there and is not this rule."
      enabled     = true
      expression  = "(http.request.uri.query contains \"v=\" and (ends_with(http.request.uri.path, \".js\") or ends_with(http.request.uri.path, \".css\"))) or starts_with(http.request.uri.path, \"/theme/\") or starts_with(http.request.uri.path, \"/chunks/\")"
      ref         = null
    },
  ]
  zone_id = var.zone_id
}
