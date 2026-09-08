# EXISTENCE ONLY. Schema belongs to comments-worker/migrations/ via wrangler;
# the three librarian rooms are derived data rebuilt by ingest.py. A replace of
# any of these destroys the database.

resource "cloudflare_d1_database" "library_deep2" {
  account_id            = var.account_id
  jurisdiction          = null
  name                  = "merecat-library-deep2"
  primary_location_hint = null
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "library_deep" {
  account_id            = var.account_id
  jurisdiction          = null
  name                  = "merecat-library-deep"
  primary_location_hint = null
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "comments" {
  account_id            = var.account_id
  jurisdiction          = null
  name                  = "merecatholicity-comments"
  primary_location_hint = null
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "library" {
  account_id            = var.account_id
  jurisdiction          = null
  name                  = "merecat-library"
  primary_location_hint = null
  read_replication = {
    mode = "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}
