# The three custom zone rulesets.
#
# response_headers is the one that matters most: it carries the CSP, HSTS,
# Permissions-Policy (microphone=(self) — denying it broke the voice recorder
# site-wide) and X-Frame-Options SAMEORIGIN (DENY would block our own Turnstile
# frame). It lived only in the dashboard until this commit.

resource "cloudflare_ruleset" "firewall_custom" {
  account_id = null
  kind       = "zone"
  name       = "default"
  phase      = "http_request_firewall_custom"
  rules = [
    {
      action = "skip"
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
        phases                     = ["http_request_firewall_managed"]
        polish                     = null
        private                    = null
        products                   = ["securityLevel", "bic", "hot", "uaBlock", "zoneLockdown"]
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
        ruleset                    = "current"
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
      description              = "Allow verified search engines (Googlebot, Bingbot) - bypass AI-bot/managed rules and geo block"
      enabled                  = true
      exposed_credential_check = null
      expression               = "(cf.verified_bot_category eq \"Search Engine Crawler\")"
      logging = {
        enabled = true
      }
      ratelimit = null
      ref       = "f63a6b2a600b41e6ab4ff3e2782ad35a"
    },
    {
      action = "block"
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
      description              = "geo audience"
      enabled                  = true
      exposed_credential_check = null
      expression               = "(not ip.src.continent in {\"EU\" \"OC\"} and not ip.src.country in {\"US\" \"CA\" \"JP\" \"KR\" \"TW\" \"SG\" \"PH\" \"IL\" \"AM\" \"GE\" \"LB\"})"
      ratelimit                = null
      ref                      = "386edfe507c94b759d016b962d8e7c75"
    },
    {
      action = "block"
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
      description              = "allow goodbots && block {TOR (all datacenters known to man)}"
      enabled                  = false
      exposed_credential_check = null
      expression               = "(not cf.client.bot) and (\n  ip.src.country eq \"T1\"\n  or ip.src.asnum in {16509 14618 396982 8075 31898 36351 45102 132203 16276 24940 14061 20473 63949 51167 60781 12876 199524 54290 36352 53667 9009 60068 26496 8560 47583}\n)"
      ratelimit                = null
      ref                      = "7c886484885b49ed856c4e2e08f3d6c5"
    },
  ]
  zone_id = var.zone_id
}

resource "cloudflare_ruleset" "response_headers" {
  account_id = null
  kind       = "zone"
  name       = "default"
  phase      = "http_response_headers_transform"
  rules = [
    {
      action = "rewrite"
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
        disable_rum                = null
        disable_zaraz              = null
        edge_ttl                   = null
        email_obfuscation          = null
        expression                 = null
        fonts                      = null
        from_list                  = null
        from_value                 = null
        headers = {
          Content-Security-Policy-Report-Only = {
            expression = null
            operation  = "set"
            value      = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https://audio.merecatholicity.com; connect-src 'self' https://contact-api.merecatholicity.com https://challenges.cloudflare.com https://ipv4.icanhazip.com https://ipv6.icanhazip.com https://cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; form-action 'self' https://contact-api.merecatholicity.com; base-uri 'none'; object-src 'none'; frame-ancestors 'self'"
          }
          Permissions-Policy = {
            expression = null
            operation  = "set"
            value      = "geolocation=(), microphone=(self), camera=()"
          }
          Referrer-Policy = {
            expression = null
            operation  = "set"
            value      = "strict-origin-when-cross-origin"
          }
          Strict-Transport-Security = {
            expression = null
            operation  = "set"
            value      = "max-age=31536000; includeSubDomains"
          }
          X-Content-Type-Options = {
            expression = null
            operation  = "set"
            value      = "nosniff"
          }
          X-Frame-Options = {
            expression = null
            operation  = "set"
            value      = "SAMEORIGIN"
          }
        }
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
      enabled                  = true
      exposed_credential_check = null
      expression               = "true"
      ratelimit                = null
      ref                      = "1dc65168d5f147b0b9af4c5dcf4296e9"
    },
  ]
  zone_id = var.zone_id
}

resource "cloudflare_ruleset" "rate_limit" {
  account_id = null
  kind       = "zone"
  name       = "default"
  phase      = "http_ratelimit"
  rules = [
    {
      action = "block"
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
      description              = "contact form"
      enabled                  = true
      exposed_credential_check = null
      expression               = "(http.host eq \"contact-api.merecatholicity.com\" and http.request.method eq \"POST\")"
      ratelimit = {
        characteristics            = ["ip.src", "cf.colo.id"]
        counting_expression        = null
        mitigation_timeout         = 10
        period                     = 10
        requests_per_period        = 5
        requests_to_origin         = false
        score_per_period           = null
        score_response_header_name = null
      }
      ref = "a95f027944a94a50a26557512d475cfd"
    },
  ]
  zone_id = var.zone_id
}

# Single Redirects: /<name>.pdf on the two SITE hosts -> files.merecatholicity.com.
# This is what keeps every PDF URL ever shared alive after the files left Pages.
# Scoped to the site hosts on purpose — files.* is in this same zone, and a
# zone-wide rule redirected the bucket to itself. Created by hand on 2026-09-08
# and adopted here the next day.
resource "cloudflare_ruleset" "redirects" {
  kind  = "zone"
  name  = "default"
  phase = "http_request_dynamic_redirect"
  rules = [
    {
      action = "redirect"
      action_parameters = {
        from_value = {
          preserve_query_string = false
          status_code           = 301
          target_url = {
            expression = "concat(\"https://files.merecatholicity.com\", http.request.uri.path)"
          }
        }
      }
      description = "Published PDFs moved to R2 (files.merecatholicity.com) to keep the Pages site under its 1GB limit; every previously-shared URL must keep working. Scoped to the SITE hosts: files.* is in this same zone, and a zone-wide rule redirected the bucket to itself."
      enabled     = true
      expression  = "ends_with(http.request.uri.path, \".pdf\") and (http.host eq \"merecatholicity.com\" or http.host eq \"www.merecatholicity.com\")"
      ref         = "805c4d0689c14433a81be95193eadfdd"
    },
  ]
  zone_id = var.zone_id
}
