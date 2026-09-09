# Terraform: the durable infrastructure

This directory holds the parts of merecatholicity.com's infrastructure that
outlive a deploy — DNS, zone policy, the edge header rules, the storage that
exists, the GitHub repositories — as code. It is adoption-only: every resource
here already existed and was imported. Terraform did not create the site.

## The boundary: what Terraform owns, and what it must not touch

`wrangler deploy` rewrites a worker's routes, cron triggers, bindings, vars and
secrets on **every** deploy. If Terraform also declared those, the two tools
would fight forever: every `make worker-deploy` would produce a Terraform diff,
and every `terraform apply` would produce a wrangler diff. So the line is drawn
at the deploy:

**Terraform owns** — the zone and three deliberate zone settings, all 18 DNS
records, the three custom rulesets (response headers, custom firewall, rate
limiting), bot management, the six R2 buckets, the four D1 databases *as records
that they exist*, the two Turnstile widgets, both GitHub repositories, the
GitHub Pages configuration (`github_repository_pages`, adopted 2026-09-09 with
a no-op plan), the two GitHub environments (`github-pages`, and the
`terraform-production` approval gate with its main-only branch policy) and the
two public-id Actions variables. Forty-eight resources in all.

**wrangler owns** — worker scripts and versions, all bindings, vars, secrets,
`routes`, `triggers.crons`, and D1 migrations. None of that appears here. The
source of truth for it stays `comments-worker/wrangler.jsonc` and
`contact-worker/wrangler.jsonc`.

**ingest.py owns** — the contents of the three librarian D1 rooms and the
Vectorize index. All derived data, rebuilt by `make librarian`.

## Adopted 2026-09-09

The move of the published PDFs to R2 created three things by hand on the day
the state was first adopted; they are declared now, with import blocks in
`imports.tf`: the R2 bucket `merecatholicity-files`, the
`files.merecatholicity.com` DNS record, and the dynamic-redirect ruleset that
301s `/<name>.pdf` to that host (`cloudflare_ruleset.redirects`, phase
`http_request_dynamic_redirect`). Its R2 custom-domain binding is unadoptable
for the same reason `audio.merecatholicity.com`'s is (below).

The adoption was applied THROUGH the pipeline on 2026-09-09 (run 34316447061:
8 imports, 2 creates, 0 changes, 0 destroys, approved with
`scripts/ci_approve.sh` after a strict check of the summary against the
expected fingerprint). `plan` answers `No changes`.

## Running from CI

`.github/workflows/terraform.yml` fires only when `terraform/**` changes (or by
hand). `plan` runs on pull requests and pushes; `apply` runs from `main` and
waits on the **`terraform-production`** environment, whose required reviewer is
the owner. Approve in the browser (*Review deployments*) or from a shell with
`scripts/ci_approve.sh <run-id> --approve` — the same API call.

Three things the workflow will not do, on purpose:

- **Print a plan or upload the plan file.** This repository is public; its logs
  and artifacts are public; the binary plan embeds the prior state, and state
  holds secrets. Reviewers see `scripts/tf_plan_summary.py` — resource
  addresses, actions, changed attribute names, and values only where the
  provider's schema does not mark them sensitive. Imports are listed as `import`.
- **Apply a destroy or a replace.** Any delete action fails the plan job unless
  the workflow is run by hand with `allow_destroy=true`. The same law as below,
  enforced.
- **Apply a plan other than the one reviewed.** The apply job re-plans and
  compares the set of `address action` lines; a difference fails it.

The S3 credentials for the state backend are derived at run time from the
Cloudflare token — access key = the token's `id` (`/user/tokens/verify`),
secret = SHA-256 of the token value, Cloudflare's documented scheme — so one
secret serves everything. Set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` as
repository secrets to use a dedicated R2 token instead.

**Secrets** (repository → Settings → Secrets and variables → Actions) — three
Cloudflare account tokens, each holding only what its workflow needs, minted
through the API on 2026-09-09 (a compromise of one job cannot reach the others'
ground):

- `CLOUDFLARE_API_TOKEN` — **the terraform token** (`merecatholicity-ci-terraform`).
  Zone (merecatholicity.com only): Zone Read, Zone Settings Write, DNS Write,
  Bot Management Write, Zone WAF Write, Zone Transform Rules Write, Dynamic URL
  Redirects Write. Account: Account Settings Read, Account Rulesets Read,
  Workers R2 Storage Write (bucket management and the state backend), D1 Read
  (the per-database GET Terraform refreshes with — the list endpoint is denied,
  and Terraform never lists), Turnstile Sites Write. It cannot purge the
  cache, deploy a worker, or write D1. `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` are its derived R2 pair (id + SHA-256).
- `CLOUDFLARE_SITE_TOKEN` — **build.yml and the manual purge**: Cache Purge
  (zone) + Workers R2 Storage Write (account). Bucket-scoped R2 item
  permissions were tried first and were refused for the API's list endpoint, so
  this token can reach every bucket; it can do nothing else.
- `CLOUDFLARE_WORKERS_TOKEN` — **workers.yml**: Workers Scripts Write, D1 Write,
  Account Settings Read (account) + Workers Routes Write (zone).
- `TF_GITHUB_TOKEN` — for the github provider. Today this is the owner's `gh`
  CLI token (`repo`, `workflow`, `read:org`); a fine-grained PAT restricted to
  the two repositories (Administration, Environments, Actions variables:
  read/write; Metadata: read) is the better shape — `workflow` scope lets a
  holder rewrite workflow files — and swapping it is one `gh secret set`.

**No pull request ever sees a secret**, not even from this repository: a PR's
HCL is what `plan` evaluates, and an `http` or `external` data source in it
would read the tokens at plan time, before any gate. PRs get `fmt` and an
offline `validate`; the plan that gets reviewed is the push's.

**Bootstrap order, because it matters:** a workflow that names an environment
GitHub has never seen makes GitHub create it — with no protection rules. The
`terraform-production` environment was therefore created through the API (with
its reviewer and branch policy) before any workflow referenced it, and then
imported here. Do the same for any future gated environment.

## What Terraform cannot hold

Three pieces of live infrastructure are outside Terraform's reach, and the
reason is the provider, not a choice:

- **Vectorize (`merecat-t1`)** — the Cloudflare provider has no vectorize
  resource at all (checked against 5.24.0: 259 resources, none). It stays a
  wrangler/dashboard object.
- **The R2 custom-domain bindings** (`audio.` and, since 2026-09-08, `files.`)
  — `cloudflare_r2_custom_domain` exists but does not support `terraform
  import` (the provider's own docs say so). Their DNS records ARE managed here;
  the bucket-to-domain bindings behind them are not. Declaring one would try to
  create a second.
- **The Realtime TURN key (`merecatholicity-calls`)** — `cloudflare_calls_turn_app`
  likewise has no import. Adopting it would mint a *new* key with a new id,
  breaking `TURN_KEY_ID` and every voice call. Leave it alone.
- **Email Routing settings** — `cloudflare_email_routing_settings` cannot be
  read by provider 5.24.0 at all: it fails with "Struct defines fields not found
  in object: support_subaddress", a bug in the provider's decoder rather than in
  this config. The *DNS records* Email Routing depends on (three MX, SPF, DMARC,
  both DKIM) are managed in `dns.tf`; only the on/off settings object is not.
  Worth retrying on a provider bump.

## Blast radius

The Cloudflare account is shared with four other zones — `adamschaefers.com`,
`cypher2k1.net`, `enchant.games`, `trophybrowns.com` — and carries Turnstile
widgets for two of them. Zone-scoped resources here are pinned to
merecatholicity.com, but **account-scoped resources (R2, D1, Turnstile) cannot
be narrowed by the API**: a token that can write R2 for this project can write
R2 for all of them. Read every plan before applying it.

## Credentials

Nothing in this directory holds a secret, and nothing may. Four values come
from the environment:

| Variable | What | Where from |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | infrastructure | dashboard, scoped (below) |
| `GITHUB_TOKEN` | repositories | `gh auth token` |
| `AWS_ACCESS_KEY_ID` | state backend | R2 API token |
| `AWS_SECRET_ACCESS_KEY` | state backend | R2 API token |

The wrangler OAuth token in `~/.config/.wrangler` is **not** usable — it is
short-lived and refresh-based.

### The Cloudflare token

dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token.

Account permissions (account: this one):
- Workers R2 Storage: Edit
- D1: Edit
- Turnstile: Edit
- Email Routing Addresses: Read

Zone permissions (**Include → Specific zone → merecatholicity.com**, which is
what keeps the other four zones out of reach):
- Zone: Read
- Zone Settings: Edit
- DNS: Edit
- Zone WAF: Edit
- Transform Rules: Edit
- Bot Management: Edit
- Email Routing Rules: Edit

### The R2 state credentials

dash.cloudflare.com → R2 → API → Manage API Tokens → Create, **Object Read &
Write**, scoped to `merecatholicity-tfstate`. That flow hands back an Access Key
ID and a Secret Access Key directly — those are the `AWS_*` pair above.

## State

State lives in R2 at `merecatholicity-tfstate/merecatholicity.com/terraform.tfstate`.
That bucket is deliberately not managed here: a state store managed by the state
it holds cannot be bootstrapped or recovered.

**State is secret.** It carries Turnstile secret keys among other things, and
this repository is public. `.gitignore` keeps every `*.tfstate*` out of git; do
not defeat it.

## Working here

```sh
terraform -chdir=terraform init
terraform -chdir=terraform plan          # expect: No changes
```

Adopting something new:

```sh
# 1. add an import block naming the resource and its live id
# 2. let Terraform write the HCL from the live object
terraform -chdir=terraform plan -generate-config-out=generated.tf
# 3. fold generated.tf into the right topic file, delete it, then iterate
terraform -chdir=terraform plan
# 4. only once the plan is clean:
terraform -chdir=terraform apply
```

**Never apply a plan that shows a destroy or a replace.** A replaced
`cloudflare_d1_database` destroys the comments database; a replaced
`cloudflare_r2_bucket` destroys its objects. `prevent_destroy` is set on every
stateful resource as a second line of defence, but the first one is reading the
plan.
