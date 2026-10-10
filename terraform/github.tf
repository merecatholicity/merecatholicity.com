# Both repositories.
#
# GitHub Pages is managed at the bottom of this file as github_repository_pages
# (adopted 2026-09-09), NOT as the deprecated `pages` block inside
# github_repository. Pages is deployed from .github/workflows/build.yml's
# artifact (build_type: workflow, CNAME merecatholicity.com); it served main
# /docs until 2026-09-08. The deploy method is now something Terraform ASSERTS:
# a plan that wanted `legacy` back would say so before anything moved, and a
# `legacy` source would serve a branch that no longer carries the built site. Adopting Pages means ASSERTING config against the live
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

# The merecat workflow reads the private shelf with this key: read-only, one
# repository, revocable here by emptying the variable (a destroy that the
# plan's destroy law will ask to be argued for, as it should).
resource "github_repository_deploy_key" "private_shelf_ci" {
  count      = var.private_shelf_deploy_key == "" ? 0 : 1
  repository = github_repository.private_shelf.name
  title      = "merecatholicity.com CI: the librarian ingest (read-only)"
  # GitHub stores a deploy key as its two fields — type and base64 — and drops the
  # trailing comment the variable carries (`… merecatholicity.com CI: …`); handing
  # the comment in made every plan since 2026-09-10 want to REPLACE the key, which
  # the destroy law refused (found 2026-09-16, the day a ruleset change first
  # re-planned). Compare what GitHub compares.
  key       = join(" ", slice(split(" ", trimspace(var.private_shelf_deploy_key)), 0, 2))
  read_only = true
}

resource "github_repository" "site" {
  # the pull-request road (2026-10-09, the ruleset below): a PR merges itself
  # when its checks pass (`gh pr merge --auto`, scripts/ship.sh), its branch
  # goes when it merges, and a branch behind main can be brought up to date
  allow_auto_merge            = true
  allow_forking               = true
  allow_merge_commit          = true
  allow_rebase_merge          = true
  allow_squash_merge          = true
  allow_update_branch         = true
  archive_on_destroy          = null
  archived                    = false
  auto_init                   = false
  delete_branch_on_merge      = true
  description                 = null
  gitignore_template          = null
  has_discussions             = false
  has_issues                  = true # a gate's "Approval needed" ask (scripts/ci_ask_review.sh)
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
  # Free on a public repository, and the one guard that stops a credential
  # from ever landing in git: push protection refuses the push, secret
  # scanning catches what got through before it. Both were off, and pinned off
  # here, until 2026-09-09's security review.
  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# main takes no direct push (2026-10-09). Every change reaches it through a
# pull request whose required checks passed — the merge IS the deploy, and
# scripts/ship.sh is the road (push a branch, open the PR, arm auto-merge, wait).
# Until this ruleset a red pull request could be merged with the ordinary
# button, and was (Dependabot #11: its Build failed, the merge took the Build
# on main down with it), and an agent's push went straight to production.
#
# The three checks are the jobs that run on EVERY pull request: Build's
# `build`, Workers' `check`, Terraform's `plan`. A required check that never
# reports holds the PR at "Expected" for ever, so neither workflow path-filters
# its pull_request trigger; `check` skips itself (by its `if`, which GitHub
# reports as success) when the PR touches no worker input. integration_id pins
# each to GitHub Actions (app 15368), so a commit status of the same name from
# anywhere else satisfies nothing. Not strict: a PR need not be rebased onto
# the newest main first; the push run on main gates every deploy again.
#
# No bypass actor, by design: the owner's PAT and the agents riding it get the
# same rule as everyone. An emergency in which the gates themselves are broken
# is CICD.md §10's exception (disable this ruleset in the UI, ship, re-enable),
# never a quiet bypass list. The private shelf cannot carry one: rulesets on a
# private repository need a paid plan, and its pushes run no checks to require.
resource "github_repository_ruleset" "main" {
  name        = "main: pull requests only, checks green"
  repository  = github_repository.site.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true

    # no approving review: the owner is the only reviewer, and GitHub refuses
    # an author's approval of their own pull request
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check {
        context        = "build"
        integration_id = 15368
      }
      required_check {
        context        = "check"
        integration_id = 15368
      }
      required_check {
        context        = "plan"
        integration_id = 15368
      }
    }
  }
}

# The approval gate for Terraform applies from CI (.github/workflows/terraform.yml).
# A job that names this environment waits until a required reviewer approves —
# the owner, in the browser, or the AI operator via scripts/ci_approve.sh (the
# same API call). One org member, so the pusher must be allowed to approve their
# own run. Restricted to main by the policy below. Created by hand via the API on
# 2026-09-09 BEFORE any workflow referenced it — GitHub auto-creates a referenced
# environment with NO protection, which would have made the gate a formality.
resource "github_repository_environment" "terraform_production" {
  repository          = github_repository.site.name
  environment         = "terraform-production"
  can_admins_bypass   = false # the gate is the only road; nobody walks around it
  prevent_self_review = false

  reviewers {
    users = [26800291] # a-schaefers
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "terraform_production_main" {
  repository     = github_repository.site.name
  environment    = github_repository_environment.terraform_production.environment
  branch_pattern = "main"
}

# The approval gate for merecat's persona and dials (2026-09-17). The librarian
# pipeline (.github/workflows/merecat.yml) authenticates with GitHub's signed
# OIDC token, and the worker takes a persona or dials push only from a job that
# ran in THIS environment (the token's `environment` claim) — so persona.md and
# config.yml reach production only after a required reviewer presses Review
# deployments; the pipeline holds no key, and the worker none that opens this
# door (the owner's admin key still can, by hand). Declared here
# before any workflow names it: GitHub auto-creates a referenced environment
# with no protection.
resource "github_repository_environment" "librarian_config" {
  repository          = github_repository.site.name
  environment         = "librarian-config"
  can_admins_bypass   = false
  prevent_self_review = false

  reviewers {
    users = [26800291] # a-schaefers
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "librarian_config_main" {
  repository     = github_repository.site.name
  environment    = github_repository_environment.librarian_config.environment
  branch_pattern = "main"
}

# The environment actions/deploy-pages made for itself. Declared so the whole
# set of environments is known here; it carries no protection rules.
resource "github_repository_environment" "github_pages" {
  repository          = github_repository.site.name
  environment         = "github-pages"
  can_admins_bypass   = true
  prevent_self_review = false

  # deploy-pages set these up; declaring them as they stand is what makes the
  # adoption a no-op rather than a change.
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "github_pages_main" {
  repository     = github_repository.site.name
  environment    = github_repository_environment.github_pages.environment
  branch_pattern = "main"
}

# The two PUBLIC identifiers the workflows read as `vars.*` (they also carry
# fallbacks, so a fresh repo works before this is applied). Secrets are NOT
# managed here — a token cannot be created by the automation it authorises.
resource "github_actions_variable" "cloudflare_account_id" {
  repository    = github_repository.site.name
  variable_name = "CLOUDFLARE_ACCOUNT_ID"
  value         = var.account_id
}

resource "github_actions_variable" "cloudflare_zone_id" {
  repository    = github_repository.site.name
  variable_name = "CLOUDFLARE_ZONE_ID"
  value         = var.zone_id
}

# GitHub Pages, adopted 2026-09-09 as its own import with a no-op plan. With
# workflow-type Pages the configuration is two attributes, and declaring them
# means Terraform now guards the deploy method itself: a plan that wanted to
# turn this back into a branch deploy would say so before anything moved. The
# `pages` block inside github_repository is deprecated by the provider; this is
# its replacement. https_enforced stays false because Cloudflare fronts the
# origin and enforces HTTPS at the edge (zone.tf: always_use_https).
resource "github_repository_pages" "site" {
  repository     = github_repository.site.name
  build_type     = "workflow"
  cname          = "merecatholicity.com"
  public         = true
  https_enforced = false
}

# Dependabot security updates on the public repo (free): a vulnerable npm
# dependency gets a fix PR. Version bumps for the pinned actions come from
# .github/dependabot.yml, which keeps the SHA pins fresh.
resource "github_repository_dependabot_security_updates" "site" {
  repository = github_repository.site.name
  enabled    = true
}

# What may run in Actions, and how it must be referenced. Every job here holds
# or sits next to a production credential, so a hijacked tag is a route to
# them: only GitHub-owned and verified-creator actions, and every `uses:` must
# name a commit SHA (GitHub enforces this at run time).
resource "github_actions_repository_permissions" "site" {
  repository           = github_repository.site.name
  enabled              = true
  allowed_actions      = "selected"
  sha_pinning_required = true

  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = true
    patterns_allowed     = []
  }
}
