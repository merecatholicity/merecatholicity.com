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
that they exist*, the two Turnstile widgets, and both GitHub repositories —
but **NOT the GitHub Pages configuration**, which is deliberately left alone
(see the header of `github.tf`: adopting Pages means asserting config rather
than adopting it, and getting it wrong unbinds the custom domain and 404s the
site). Forty resources in all.

**wrangler owns** — worker scripts and versions, all bindings, vars, secrets,
`routes`, `triggers.crons`, and D1 migrations. None of that appears here. The
source of truth for it stays `comments-worker/wrangler.jsonc` and
`contact-worker/wrangler.jsonc`.

**ingest.py owns** — the contents of the three librarian D1 rooms and the
Vectorize index. All derived data, rebuilt by `make librarian`.

## Known drift (2026-09-08)

The move of the published PDFs to R2 created three things by hand on the day the
state was adopted, and none of them are declared here yet:

- the R2 bucket **`merecatholicity-files`** — so `r2.tf` holds six buckets while
  the account has seven adoptable ones (plus the unmanaged `merecatholicity-tfstate`);
- the **`files.merecatholicity.com`** DNS record — so `dns.tf`'s 18 records are
  one short;
- the **dynamic-redirect ruleset** that 301s `/<name>.pdf` to that host — a
  fourth ruleset phase (`http_request_dynamic_redirect`) beside the three
  declared here.

Its R2 custom-domain binding is unadoptable for the same reason
`audio.merecatholicity.com`'s is (below). Nothing is broken — all of it is live
and verified — but **`plan` reporting `No changes` does not currently mean the
zone is fully described.** Adopt each the documented way: an `import` block,
`plan -generate-config-out`, fold the HCL into the topic file, iterate to `No
changes`, apply.

## What Terraform cannot hold

Three pieces of live infrastructure are outside Terraform's reach, and the
reason is the provider, not a choice:

- **Vectorize (`merecat-t1`)** — the Cloudflare provider has no vectorize
  resource at all (checked against 5.24.0: 259 resources, none). It stays a
  wrangler/dashboard object.
- **`audio.merecatholicity.com`'s R2 binding** — `cloudflare_r2_custom_domain`
  exists but does not support `terraform import`. Its DNS record IS managed
  here; the bucket-to-domain binding behind it is not. Declaring it would try
  to create a second one.
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
