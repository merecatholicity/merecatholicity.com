# The zone itself, the three deliberate settings, and bot management.
#
# ssl = "full" is load-bearing and must NOT become "strict": the origin is
# GitHub Pages. browser_cache_ttl = 0 ("respect existing headers") is what lets
# the ?v= immutable-asset scheme work.
#
# bot_management is here because the API behind it is a FULL REPLACE: a partial
# PUT once silently reset ai_bots_protection and crawler_protection. Terraform
# always sends the whole object, which closes that trap for good.

resource "cloudflare_zone_setting" "ssl" {
  setting_id = "ssl"
  value      = "full"
  zone_id    = var.zone_id
}

resource "cloudflare_zone_setting" "browser_cache_ttl" {
  setting_id = "browser_cache_ttl"
  value      = 0
  zone_id    = var.zone_id
}

resource "cloudflare_zone_setting" "always_use_https" {
  setting_id = "always_use_https"
  value      = "on"
  zone_id    = var.zone_id
}

resource "cloudflare_zone" "main" {
  account = {
    id = var.account_id
  }
  name                = "merecatholicity.com"
  paused              = false
  type                = "full"
  vanity_name_servers = []

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_bot_management" "main" {
  ai_bots_protection      = "block"
  content_bots_protection = "disabled"
  crawler_protection      = "enabled"
  enable_js               = true
  fight_mode              = true
  is_robots_txt_managed   = false
  zone_id                 = var.zone_id
}
