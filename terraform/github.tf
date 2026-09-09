# Both repositories.
#
# NOT MANAGED, DELIBERATELY: the pages block. GitHub Pages is deployed from
# .github/workflows/build.yml's artifact now (build_type: workflow, CNAME
# merecatholicity.com); it served main /docs until 2026-09-08. Terraform's
# config generator did not emit a pages block either way. Note the deploy method
# is now something a `pages` block would ASSERT: declaring one with the old
# branch source would switch Pages back to serving a branch that no longer
# carries the built site at all. Adopting Pages means ASSERTING config against the live
# setting rather than adopting it, and getting that wrong unbinds the custom
# domain and 404s the entire site (it has happened once already, when the served
# files moved out from under CNAME). Do it as its own change, with its own plan
# read carefully, not folded into the initial import.
#
# etag and fork were dropped from the generated config: both are read-only, and
# etag changes on every repository write, which would show as permanent drift.

resource "github_repository" "private_shelf" {
  allow_auto_merge            = false
  allow_forking               = false
  allow_merge_commit          = true
  allow_rebase_merge          = true
  allow_squash_merge          = true
  allow_update_branch         = false
  archive_on_destroy          = null
  archived                    = false
  auto_init                   = false
  delete_branch_on_merge      = false
  description                 = null
  gitignore_template          = null
  has_discussions             = false
  has_issues                  = true
  has_projects                = true
  has_wiki                    = false
  homepage_url                = null
  is_template                 = false
  license_template            = null
  merge_commit_message        = "PR_TITLE"
  merge_commit_title          = "MERGE_MESSAGE"
  name                        = "private-shelf"
  squash_merge_commit_message = "COMMIT_MESSAGES"
  squash_merge_commit_title   = "COMMIT_OR_PR_TITLE"
  topics                      = []
  visibility                  = "private"
  web_commit_signoff_required = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "github_repository" "site" {
  allow_auto_merge            = false
  allow_forking               = true
  allow_merge_commit          = true
  allow_rebase_merge          = true
  allow_squash_merge          = true
  allow_update_branch         = false
  archive_on_destroy          = null
  archived                    = false
  auto_init                   = false
  delete_branch_on_merge      = false
  description                 = null
  gitignore_template          = null
  has_discussions             = false
  has_issues                  = false
  has_projects                = false
  has_wiki                    = false
  homepage_url                = "https://merecatholicity.com"
  is_template                 = false
  license_template            = null
  merge_commit_message        = "PR_TITLE"
  merge_commit_title          = "MERGE_MESSAGE"
  name                        = "merecatholicity.com"
  squash_merge_commit_message = "COMMIT_MESSAGES"
  squash_merge_commit_title   = "COMMIT_OR_PR_TITLE"
  topics                      = []
  visibility                  = "public"
  web_commit_signoff_required = false
  security_and_analysis {
    secret_scanning {
      status = "disabled"
    }
    secret_scanning_push_protection {
      status = "disabled"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
