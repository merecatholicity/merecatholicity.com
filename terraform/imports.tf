# Adoption of existing infrastructure. Every id below was read from the live
# Cloudflare and GitHub APIs on 2026-09-08 — none is guessed.
#
# The loop:
#   terraform plan -generate-config-out=generated.tf
#   (fold generated.tf into the topic files, then delete it)
#   terraform plan          # iterate until "No changes"
#   terraform apply         # writes state only; changes nothing live
#
# NOTHING here may be applied while the plan shows a destroy or a replace. A
# replaced cloudflare_d1_database destroys the comments database; a replaced
# r2_bucket destroys the objects in it. Stateful resources carry
# prevent_destroy in their own files as a second line of defence.

############################  zone  ############################

import {
  to = cloudflare_zone.main
  id = "2b270ffb21b7f98a39960abb6bf953ae"
}

# Only the settings whose values are deliberate. ssl=full is load-bearing (NOT
# strict — the GitHub Pages origin); browser_cache_ttl=0 ("respect existing
# headers") is what makes the ?v= immutable-asset strategy work. Settings not
# listed here stay unmanaged and undisturbed.
import {
  to = cloudflare_zone_setting.ssl
  id = "2b270ffb21b7f98a39960abb6bf953ae/ssl"
}

import {
  to = cloudflare_zone_setting.always_use_https
  id = "2b270ffb21b7f98a39960abb6bf953ae/always_use_https"
}

import {
  to = cloudflare_zone_setting.browser_cache_ttl
  id = "2b270ffb21b7f98a39960abb6bf953ae/browser_cache_ttl"
}

# The four bot systems that fought the Turnstile widget for a week. The PUT
# behind this endpoint is a FULL REPLACE, which is exactly how a partial body
# once silently reset ai_bots_protection and crawler_protection. Terraform
# always sends the whole object, so declaring it here closes that trap.
import {
  to = cloudflare_bot_management.main
  id = "2b270ffb21b7f98a39960abb6bf953ae"
}

############################  DNS  ############################

# Apex A/AAAA -> GitHub Pages, proxied.
import {
  to = cloudflare_dns_record.pages_a_108
  id = "2b270ffb21b7f98a39960abb6bf953ae/9ba7891fba38c1ab1ec0d43e8e58cce3"
}

import {
  to = cloudflare_dns_record.pages_a_109
  id = "2b270ffb21b7f98a39960abb6bf953ae/0b8496c138d17ada70a92e6bc0686b94"
}

import {
  to = cloudflare_dns_record.pages_a_110
  id = "2b270ffb21b7f98a39960abb6bf953ae/e3b146da65b1abd71f6f7279f81126a0"
}

import {
  to = cloudflare_dns_record.pages_a_111
  id = "2b270ffb21b7f98a39960abb6bf953ae/b50124c10e51c1ef3319deb28dbcbd50"
}

import {
  to = cloudflare_dns_record.pages_aaaa_8000
  id = "2b270ffb21b7f98a39960abb6bf953ae/9e8573f25a0b0b28e9e5d9e8f1095d19"
}

import {
  to = cloudflare_dns_record.pages_aaaa_8001
  id = "2b270ffb21b7f98a39960abb6bf953ae/fcea21409bc87e63eadace4b7e0947ae"
}

import {
  to = cloudflare_dns_record.pages_aaaa_8002
  id = "2b270ffb21b7f98a39960abb6bf953ae/d2febc7a5e41a77827af5502540f2fdf"
}

import {
  to = cloudflare_dns_record.pages_aaaa_8003
  id = "2b270ffb21b7f98a39960abb6bf953ae/5c0b8395be816f3e0fc9b1fdb1e2e218"
}

import {
  to = cloudflare_dns_record.www
  id = "2b270ffb21b7f98a39960abb6bf953ae/b205a54cd77e1a5576b9387e97238b70"
}

# The R2 custom domain for the 3.26 GB Scourby audio. The DNS record is
# importable; the cloudflare_r2_custom_domain binding behind it is NOT (see
# README.md, "What Terraform cannot hold").
import {
  to = cloudflare_dns_record.audio
  id = "2b270ffb21b7f98a39960abb6bf953ae/3a740ef5353ff7d8047a3ea89bc258ac"
}

# The contact worker's custom domain. wrangler owns the route binding; this is
# only the placeholder AAAA record Cloudflare parks on 100::.
import {
  to = cloudflare_dns_record.contact_api
  id = "2b270ffb21b7f98a39960abb6bf953ae/0acc906393e16f53e8d2ada271c6cd7e"
}

# Email Routing: three MX plus SPF, DMARC and both DKIM records.
import {
  to = cloudflare_dns_record.mx_route1
  id = "2b270ffb21b7f98a39960abb6bf953ae/27eb8f6fd13d50652559a6542e6016c2"
}

import {
  to = cloudflare_dns_record.mx_route2
  id = "2b270ffb21b7f98a39960abb6bf953ae/cc59436bf5eb3939d44ff011ab796ff9"
}

import {
  to = cloudflare_dns_record.mx_route3
  id = "2b270ffb21b7f98a39960abb6bf953ae/f2216d8facca27d733bb5a76377d7860"
}

import {
  to = cloudflare_dns_record.spf
  id = "2b270ffb21b7f98a39960abb6bf953ae/acf6488d79790c3b15d4d57f96e33535"
}

import {
  to = cloudflare_dns_record.dmarc
  id = "2b270ffb21b7f98a39960abb6bf953ae/4f21061c54ccad4a5ca515715b187e74"
}

import {
  to = cloudflare_dns_record.dkim_cf2024
  id = "2b270ffb21b7f98a39960abb6bf953ae/09036ec54ba850dd4e981de525d459c2"
}

import {
  to = cloudflare_dns_record.dkim_wildcard
  id = "2b270ffb21b7f98a39960abb6bf953ae/ecf784731eaabb4b0cf7474601ade1f0"
}

############################  rulesets  ############################

# The response-header transform rule: CSP-Report-Only, Permissions-Policy
# (microphone=(self) — denying it once broke the voice recorder site-wide),
# HSTS, X-Frame-Options SAMEORIGIN (DENY would block our own Turnstile frame),
# Referrer-Policy, X-Content-Type-Options. This has lived ONLY in the dashboard
# until now; codifying it is the single biggest win in this whole exercise.
import {
  to = cloudflare_ruleset.response_headers
  id = "zones/2b270ffb21b7f98a39960abb6bf953ae/e61208bce12f4f938e8067d95397f061"
}

# Custom firewall: verified-crawler skip, the geo audience block, and a
# disabled TOR/datacenter block. Import preserves enabled=false as it stands.
import {
  to = cloudflare_ruleset.firewall_custom
  id = "zones/2b270ffb21b7f98a39960abb6bf953ae/f850571e3e5e498aa262c80878c61406"
}

# Zone-level rate limiting on the contact form (5 per 10s per IP+colo). Note
# this is separate from the workers ratelimit bindings in wrangler.jsonc.
import {
  to = cloudflare_ruleset.rate_limit
  id = "zones/2b270ffb21b7f98a39960abb6bf953ae/48e59c4e00264ba1bbf120e74a7d9a9b"
}

############################  email routing  ############################

# NOT MANAGED. cloudflare_email_routing_settings cannot be read by provider
# 5.24.0 at all: "Mismatch between struct and object type: Struct defines
# fields not found in object: support_subaddress" — a bug in the provider's own
# decoder, not in this config. Email Routing stays dashboard-managed; its DNS
# records (MX/SPF/DMARC/DKIM) ARE managed, in dns.tf. Revisit on a provider bump.

############################  R2  ############################

# Six project buckets. The <account>/<name>/<jurisdiction> id form is required;
# jurisdiction is "default" for all of these.
import {
  to = cloudflare_r2_bucket.backups
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-backups/default"
}

import {
  to = cloudflare_r2_bucket.avatars
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-avatars/default"
}

import {
  to = cloudflare_r2_bucket.dm_media
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-dm-media/default"
}

import {
  to = cloudflare_r2_bucket.wall_media
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-wall-media/default"
}

import {
  to = cloudflare_r2_bucket.audio
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-audio/default"
}

import {
  to = cloudflare_r2_bucket.private_shelf
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-private-shelf/default"
}

############################  D1  ############################

# EXISTENCE ONLY. wrangler owns the schema (comments-worker/migrations/) and
# ingest.py owns the three librarian rooms' contents. A replace here is
# unrecoverable data loss — prevent_destroy is set in d1.tf.
import {
  to = cloudflare_d1_database.comments
  id = "6093bc0889c95a08f0a92a8df6750c66/af00d34a-c1bc-46a3-b51f-1a2fdfec3eb8"
}

import {
  to = cloudflare_d1_database.library
  id = "6093bc0889c95a08f0a92a8df6750c66/c21d00ec-55d3-4288-b462-a373315f95e7"
}

import {
  to = cloudflare_d1_database.library_deep
  id = "6093bc0889c95a08f0a92a8df6750c66/a75f874a-7922-426c-be74-c479f268006e"
}

import {
  to = cloudflare_d1_database.library_deep2
  id = "6093bc0889c95a08f0a92a8df6750c66/98e30c6d-dacf-4c6b-8417-ee6ad176c9a2"
}

############################  Turnstile  ############################

# Only this project's two widgets. The account also carries widgets for
# nmwebkings.com and trophybrowns.com — they are deliberately NOT adopted.
import {
  to = cloudflare_turnstile_widget.comments
  id = "6093bc0889c95a08f0a92a8df6750c66/0x4AAAAAAD8IYH9_xQ0HE0yB"
}

import {
  to = cloudflare_turnstile_widget.contact
  id = "6093bc0889c95a08f0a92a8df6750c66/0x4AAAAAAD4gH6kfaUH2IRSI"
}

############################  GitHub  ############################

# The served site. Pages (main /docs, CNAME merecatholicity.com) is a block
# inside this resource, not a separate one.
import {
  to = github_repository.site
  id = "merecatholicity.com"
}

import {
  to = github_repository.private_shelf
  id = "private-shelf"
}

############################  2026-09-09: the PDF move to R2  ############################

# Three things made by hand on 2026-09-08 while the PDFs moved to R2, adopted the
# next day. Ids read from the live API (rulesets list, dns_records, r2 buckets).
import {
  to = cloudflare_r2_bucket.files
  id = "6093bc0889c95a08f0a92a8df6750c66/merecatholicity-files/default"
}

import {
  to = cloudflare_dns_record.files
  id = "2b270ffb21b7f98a39960abb6bf953ae/f0597803fcd314af9c09b2c7516b381e"
}

# The dynamic-redirect phase: /<name>.pdf on the site hosts -> files.merecatholicity.com.
import {
  to = cloudflare_ruleset.redirects
  id = "zones/2b270ffb21b7f98a39960abb6bf953ae/322a70382fdd4f14820313c0887fdf36"
}

############################  GitHub environments  ############################

# The Pages environment actions/deploy-pages created for itself, and the approval
# gate created by hand (API, 2026-09-09) before any workflow could reference it.
import {
  to = github_repository_environment.github_pages
  id = "merecatholicity.com:github-pages"
}

import {
  to = github_repository_environment.terraform_production
  id = "merecatholicity.com:terraform-production"
}

# The "main only" branch policy on the gate; the numeric id is the policy's own.
import {
  to = github_repository_environment_deployment_policy.terraform_production_main
  id = "merecatholicity.com:terraform-production:59479775"
}

# Pages itself (build_type workflow, CNAME merecatholicity.com). Its own import,
# its own plan — getting this wrong once unbound the custom domain.
import {
  to = github_repository_pages.site
  id = "merecatholicity.com"
}

import {
  to = github_repository_environment_deployment_policy.github_pages_main
  id = "merecatholicity.com:github-pages:54881721"
}

############################  GitHub security posture (2026-09-09 review)  ############################

# Both exist as settings objects on the repository already (disabled / "all"),
# so they are imported and then changed, rather than created.
import {
  to = github_repository_dependabot_security_updates.site
  id = "merecatholicity.com"
}

import {
  to = github_actions_repository_permissions.site
  id = "merecatholicity.com"
}
