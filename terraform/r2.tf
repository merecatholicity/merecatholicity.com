# Buckets, and each bucket's r2.dev switch. Objects, lifecycle rules and the
# custom-domain bindings are not managed here (see README.md).

resource "cloudflare_r2_bucket" "avatars" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-avatars"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "backups" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-backups"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "dm_media" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-dm-media"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "audio" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-audio"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "private_shelf" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-private-shelf"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "wall_media" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-wall-media"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# The published PDFs (2026-09-08): docs/ had reached 621 MB against the 1 GB
# Pages limit and 293 MB of it was 244 PDFs. Served at files.merecatholicity.com
# behind the dynamic-redirect ruleset in rulesets.tf; filled by
# scripts/publish_pdfs.py (CI and `make publish-pdfs`).
resource "cloudflare_r2_bucket" "files" {
  account_id    = var.account_id
  jurisdiction  = "default"
  location      = "WNAM"
  name          = "merecatholicity-files"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# Every bucket's public r2.dev URL — OFF (2026-09-17). The audio bucket had it
# on beside audio.merecatholicity.com, a second public door nothing used; the
# rest were off by hand. Declared for all seven so a door opened by hand shows
# as drift in the plan. Provider 5.24.0 cannot import this resource: its create
# is a PUT of the switch, so adoption is a create (six no-ops and the audio
# flip); a custom domain does not depend on it.
locals {
  r2_dev_url_off = {
    avatars       = cloudflare_r2_bucket.avatars.name
    backups       = cloudflare_r2_bucket.backups.name
    dm_media      = cloudflare_r2_bucket.dm_media.name
    audio         = cloudflare_r2_bucket.audio.name
    private_shelf = cloudflare_r2_bucket.private_shelf.name
    wall_media    = cloudflare_r2_bucket.wall_media.name
    files         = cloudflare_r2_bucket.files.name
  }
}

resource "cloudflare_r2_managed_domain" "dev_url" {
  for_each    = local.r2_dev_url_off
  account_id  = var.account_id
  bucket_name = each.value
  enabled     = false
}
