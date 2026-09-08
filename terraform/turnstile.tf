# This project's two widgets. The account also holds widgets for nmwebkings.com
# and trophybrowns.com, deliberately not adopted.
#
# clearance_level = "no_clearance" is deliberate: these widgets issue no
# cf_clearance cookie, which is why the JS-Detections conflict theory did not
# apply to this zone.

resource "cloudflare_turnstile_widget" "comments" {
  account_id      = var.account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["merecatholicity.com", "www.merecatholicity.com"]
  ephemeral_id    = false
  mode            = "managed"
  name            = "merecatholicity comments"
  offlabel        = false
  region          = "world"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_turnstile_widget" "contact" {
  account_id      = var.account_id
  bot_fight_mode  = false
  clearance_level = "no_clearance"
  domains         = ["merecatholicity.com"]
  ephemeral_id    = false
  mode            = "managed"
  name            = "merecatholicity contact form"
  offlabel        = false
  region          = "world"

  lifecycle {
    prevent_destroy = true
  }
}
