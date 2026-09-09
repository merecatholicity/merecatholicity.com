# Buckets only. Objects, lifecycle rules and the audio custom-domain binding
# are not managed here (see README.md).

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
