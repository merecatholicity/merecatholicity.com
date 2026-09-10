# CI/CD — how work ships here

*The operating manual for the pipeline. Read this before deploying anything, changing
infrastructure, or touching a credential. `CLAUDE.md` carries the standing rules; this
document carries the procedure, the inventory, the exceptions and the traps. Keep it
current in the same change that alters a workflow, a secret, or a make target it names.*

Everything in this repository ships through GitHub Actions. There are four workflows,
five secrets, two variables, two environments, three Cloudflare tokens and one fine-grained
GitHub PAT. Nothing else is needed, and — with the listed exceptions — nothing else is
allowed. **The source of truth is git and the build of record is CI.** A thing done by
hand that CI also does will be overwritten by the next run; a thing done by hand that CI
does not know about is drift, and the only cure for drift is to declare it (Terraform) or
build it (make) and push.

---

## 0. The golden path (what a normal change looks like)

```sh
# 1. edit sources — never the generated half of docs/ (see §7)
make tests           # the unit suite — must pass before any commit
make jscheck         # after ANY worker/client JS/TS edit (eslint + tsc + psbuild)
make check           # link check over the built site (needs a local build; CI does it anyway)
git commit … && git push origin main
```

Then read what the push started (`gh run list --limit 5`) and let it finish:

| You changed…                                  | Workflow(s) that fire            | What happens on `main`                                              |
|-----------------------------------------------|----------------------------------|---------------------------------------------------------------------|
| anything at all                               | **Build**                        | site built incrementally, gates, PDFs published, Pages deployed, edge purged |
| `comments-worker/`, `contact-worker/`, `purescript/`, `package*.json`, `tsconfig.json`, `globals.d.ts`, `eslint.config.js` | **Workers** (+ Build)   | gates, dry-run; then D1 migrations applied and `wrangler deploy` |
| `terraform/`, `terraform.yml`, `scripts/tf_plan_summary.py` | **Terraform** (+ Build) | plan → **waits for approval** → apply                               |
| `book/`, `*.tex`, `resources/*.py`            | Build (with TeX Live)            | corpus/book PDFs rebuilt and published                              |
| a chart page (`content/charting-communions.html`, `free-churches.html`, `objections.html`) or `styles/` | Build | the three chart PDFs reprinted and published |

A **pull request** runs the same Build and Workers gates and the Terraform `fmt`+`validate`,
**with no credentials and no deploy of any kind** — a PR from this repository is treated
exactly like a fork's. The plan that gets reviewed is always the push's.

Only Terraform ever waits for a human (or the operator): see §3.

---

## 1. Principles (the reasons behind every rule below)

1. **Push is the deploy.** There is no release step, no tag, no button for the site or the
   workers. `main` is production; a push to it is an act of deployment. Work on a branch or
   a PR if you want the gates without the deploy.
2. **CI is the build of record.** What the runner builds is what is served — the site
   artifact, the worker bundle, *and the PDFs in R2*. A local build is for previewing and
   for running the gates; its bytes are not what ships (a runner's TeX Live and Chrome emit
   different bytes from a dev box for the same sources — see §7).
3. **No secret is ever present on a `pull_request` event.** Not the site token, not the
   workers token, not the Terraform pair. A PR's code (make, npm, python, HCL data sources)
   is executed by the gates, and anything it could read it could exfiltrate. Every
   credentialed step is gated on `github.event_name == 'push'` (or dispatch).
4. **Infrastructure is declared, never clicked.** Cloudflare zone settings, DNS, rulesets,
   bot management, R2 buckets, D1 databases (as records), Turnstile widgets, GitHub
   repositories, Pages, environments, Actions policy and variables all live in `terraform/`.
   A change is a commit; the apply waits for approval. The exceptions are listed in §10 —
   if it is not there, do not do it by hand.
5. **Never apply a destroy or a replace from CI.** A replaced D1 database is the comments
   database, gone. The plan job fails on any delete action; the only way past it is a
   deliberate `workflow_dispatch` with `allow_destroy=true`, made in the open.
6. **This repository is public; so are its logs, summaries and artifacts.** The pipeline
   never prints a Terraform plan or apply, never uploads the plan file, and prints only
   summary lines of provider errors. Reviewers see `scripts/tf_plan_summary.py`'s rendering.
7. **Every deploy self-verifies.** Build checks the bucket against the manifest; Workers
   reads `/api/comments/config` after deploying; Terraform re-plans before applying and
   refuses if the plan moved since review; the purge answers `"success":true` or says why
   not.
8. **Pinned and policed.** Every `uses:` names a commit SHA; the repository requires it;
   only GitHub-owned and verified-creator actions may run; Dependabot bumps the pins by PR.

---

## 2. The four workflows

### 2.1 `build.yml` — **Build** (every push and PR)

*Triggers:* `pull_request` (any), `push` to `main`. *Concurrency:* `build-<ref>`,
**cancel-in-progress** — a newer push cancels an older build of the same ref (never the
deploy job of a finished build). *Permissions:* `contents: read`; the `deploy` job alone
holds `pages: write` + `id-token: write`.

*The `build` job, in order:*

1. **Work out what changed** — `git diff --name-only $before HEAD`. A force-push or a
   first push has no usable base and is treated as "everything changed" (full rebuild,
   TeX installed, all PDFs built). Outputs: `latex`, `book`, `charts`.
2. **Teach make what changed** — flattens every mtime to a fixed old timestamp, then
   touches only the diffed files. Without this, git's arbitrary checkout order makes `make`
   rebuild everything or nothing. (Trap: a diff ending in a deletion once failed this step;
   it guards `[ -e ]` now.)
3. Node 24 (official build — Ubuntu's `+dfsg` node cannot run the `.ts` tests), Python
   3.12, `pandoc`, `poppler-utils`, `pyyaml`; **TeX Live only when `latex=yes`**.
4. `npm ci`; restore the PureScript output cache; **restore the built site cache** (`docs/`
   keyed `site-2-<sha>`, fallback `site-2-`; the prefix is a generation — bump it to force one
   cold rebuild; a miss costs time, never correctness) — then
   **`git checkout -- docs` + `git clean -fd -- docs`, and the step fails if a tracked file
   still differs**: the cache is the previous build's WHOLE `docs/` tree, hand files
   included, so without this the previous commit's `nav.js`, `sw.js`, `turnstile.html`,
   images and architecture docs silently replaced this commit's before the gates and the
   artifact (found 2026-09-09; the same step guards `workers.yml`).
5. `make css` + `make bundle`, then `make -C resources pdf` (latex), `make pdf publish`
   (book), `make content` + `make html` (the site, incrementally; `make html` ends with
   the version stamp, the manifest and `make check`), `make chart-pdfs` (charts, after the
   site — they print the built pages, with `CHROMIUM=/usr/bin/google-chrome`), `make logos`
   (when the book changed or the docx is missing).
6. **Publish the rebuilt PDFs to R2** — `make publish-pdfs`, **push to `main` only**,
   with `CLOUDFLARE_SITE_TOKEN`. Uploads only PDFs whose MD5 differs from the bucket's
   ETag, purges exactly those URLs. Unconditional on push: an ordinary push costs one
   list call.
7. **Gates** — `make tests`, `make jscheck`, `make check`, `make check-pdfs` (the token is
   present on push only; on a PR it falls back to public HEADs, which see absence only).
8. **CNAME + .nojekyll must be in the artifact** (losing CNAME once 404'd the whole site).
9. **Name the build** (`docs/version.json` → job output `build_id`).
10. **Hold the PDFs back** (they are served from R2; on Pages they would be unreachable
    bytes — 400 MB vs 113 MB artifact), package `docs/` — a `tar` plus a SHA-pinned
    `actions/upload-artifact` named `github-pages`, which is `actions/upload-pages-artifact`
    inlined: that composite references `upload-artifact@v4` by tag inside itself and the
    repository's SHA-pinning policy refuses nested tag references too — then **return the
    PDFs** to the cached tree so the next LaTeX change rebuilds one, not 244.

*The `deploy` job* (`main` pushes only): `actions/deploy-pages`, which polls until GitHub
reports the deployment succeeded, then **purges `sw.js` and `version.json`** at the
Cloudflare edge — the only two served files that cannot carry a content-hash key. The
purge is safe precisely there: purging BEFORE Pages publishes re-caches the old bytes under
a key the edge treats as immutable.

*What it proves:* `linkcheck: OK, … 244 published PDFs …`, `publish_pdfs: OK — the bucket
matches the manifest and every local PDF`, `{"success":true,…}` from the purge.

### 2.2 `workers.yml` — **Workers** (path-filtered)

*Triggers:* `pull_request` and `push` to `main` touching `comments-worker/**`,
`contact-worker/**`, `purescript/**`, `package.json`, `package-lock.json`, `tsconfig.json`,
`globals.d.ts`, `eslint.config.js`, or the workflow itself; `workflow_dispatch` (a dispatch
has no diff base, so it redeploys BOTH workers). *Concurrency:* `workers`, **never
cancelled** mid-deploy.

*`check`* (every event, no credentials): pandoc + pyyaml + `npm ci`; restore the PureScript
cache; **restore the built site (read-only), re-assert the tracked half from the commit
(`git checkout -- docs`, as in `build.yml`) and `make css`** — `make tests` is not entirely
hermetic (tests/css reads the stylesheet, two Python suites read the baked corpus); on a
cold cache it builds the site; `make jscheck`, `make tests`; `wrangler deploy --dry-run`
for both workers (needs no auth).

*`deploy`* (push to `main` / dispatch): `make psbuild`; with `CLOUDFLARE_WORKERS_TOKEN`:
`wrangler d1 migrations apply merecatholicity-comments --remote` **then** `wrangler
deploy` (comments worker; the contact worker only when its paths changed); then `GET
/api/comments/config` must not 5xx (Bot Fight Mode may 403 a runner — not a verdict).

*Order matters:* the migration ledger is applied before the new code; every migration in
this repository is additive, which is what makes those seconds safe for the old code.

### 2.3 `terraform.yml` — **Terraform** (path-filtered, gated)

*Triggers:* `pull_request` and `push` to `main` touching `terraform/**`, the workflow, or
`scripts/tf_plan_summary.py`; `workflow_dispatch` with inputs `apply` (bool) and
`allow_destroy` (bool). *Concurrency:* `terraform`, never cancelled. *Permissions:*
`contents: read`.

*`plan`*: `fmt -check`; if there are no credentials **(every PR, by rule)** → `init
-backend=false` + `validate` and stop. Otherwise derive the R2 state pair (or take the
`AWS_*` secrets), `init`, `validate`, `plan -out=tfplan -detailed-exitcode` **with output
to a file, never the log**; `terraform show -json tfplan` → `scripts/tf_plan_summary.py`
→ markdown to the job summary + the `tf-plan-summary` artifact (safe by construction:
addresses, actions, attribute names, values only where the provider does not mark them
sensitive; imports shown as `import`). **Any delete action fails the job** unless
`allow_destroy`. Outputs: `changes` (yes/no), `fingerprint` (the sorted `address action`
lines, base64).

*`apply`* (push to `main`, or dispatch with `apply=true`; only when `changes=yes`):
**waits on the `terraform-production` environment** → re-init, re-plan, re-summarise,
**refuse if the fingerprint differs from the reviewed one**, then `apply tfplan` with output
to a file; only `Apply complete! Resources: …` reaches the summary.

*Gotcha:* paths given to a `-chdir=terraform` terraform resolve *inside* that directory —
the plan file is `tfplan`, not `terraform/tfplan`.

### 2.4 `purge-cache.yml` — **manual purge**

`workflow_dispatch` only, input `everything` (bool). Purges `sw.js` + `version.json` (or the
whole zone) with `CLOUDFLARE_SITE_TOKEN`. For "an edge rule changed and something is being
served stale" — never needed for a normal deploy, and **never run while a Build is
mid-deploy** (that is the re-cache trap).

### 2.5 `dependabot.yml`

Weekly grouped PRs bumping the SHA-pinned actions. Such a PR carries no secrets (rule 3),
so it can only fail the gates, never touch production. Merge it; the next push to `main`
ships with the new pins.

---

## 3. The approval gate (Terraform)

A push that changes `terraform/**` produces a run whose `apply` job sits in **waiting**.
Two ways to review and approve — they are the same API call:

**Human:** open the run → *Review deployments* → tick `terraform-production` → *Approve*.
The plan summary is in the `plan` job's summary tab.

**Operator / AI:**

```sh
scripts/ci_approve.sh                 # list runs waiting for review
scripts/ci_approve.sh <run-id>        # print the plan summary + what is pending
scripts/ci_approve.sh <run-id> --approve "why"   # or --reject "why"
```

Before approving, **compare the summary with what you intended**: the set of `address ·
action` rows must be exactly the change you pushed, nothing destructive, nothing you did
not expect (an unexpected row is drift being corrected — decide whether that is right).
The apply re-plans and refuses if the set moved since you looked.

Environment facts: required reviewer `a-schaefers`; `prevent_self_review=false` (one org
member — the pusher must be able to approve); **`can_admins_bypass=false`**; branch policy
`main` only. Created **through the API before any workflow named it** — GitHub creates a
referenced-but-unknown environment with *no* protection, which would have made the gate a
formality. Do the same for any future gated environment.

A **no-change plan** (`changes=no`) skips the apply and needs no approval.

`workflow_dispatch` with `apply=true` reruns the same flow by hand; `allow_destroy=true` is
the only way a delete/replace reaches an apply — read the summary twice.

---

## 4. Credentials, variables, environments, policy — the inventory

All set once by hand (`gh secret set NAME --body …`), all mirrored in
**`~/.config/merecatholicity/ci.env`** on the dev box (mode 600, outside the repo, for
local Terraform and local publishing: `set -a && . ~/.config/merecatholicity/ci.env && set +a`).
**Nothing under the repository may ever hold one** — push protection and secret scanning
are on, and would refuse the push.

| Name | Kind | Held by | Scope (exactly) |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | `terraform.yml` | account token `merecatholicity-ci-terraform` — zone: Zone Read, Zone Settings Write, DNS Write, Bot Management Write, Zone WAF Write, Zone Transform Rules Write, Dynamic URL Redirects Write; account: Account Settings Read, Account Rulesets Read, Workers R2 Storage Write, D1 Read, Turnstile Sites Write. **Cannot purge, deploy or write D1.** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | secrets | `terraform.yml` (state backend) | the Terraform token's derived R2 pair: key = token id, secret = SHA-256 of the token value (Cloudflare's documented scheme; the workflow can derive them itself if these are absent) |
| `CLOUDFLARE_SITE_TOKEN` | secret | `build.yml`, `purge-cache.yml` | account token `merecatholicity-ci-site` — Cache Purge (zone) + Workers R2 Storage Write (account; bucket-scoped item permissions were tried and are refused by the list endpoint) |
| `CLOUDFLARE_WORKERS_TOKEN` | secret | `workers.yml` | account token `merecatholicity-ci-workers` — Workers Scripts Write, D1 Write, Account Settings Read (account); Workers Routes Write (zone) |
| `TF_GITHUB_TOKEN` | secret | `terraform.yml` (github provider) | **fine-grained PAT**, no expiry, on `merecatholicity.com` + `private-shelf` only: Administration, Environments, Variables, Pages read/write; Metadata read |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` | **variables** | all | public ids; **Terraform-managed** (`github_actions_variable`) — workflows carry hardcoded fallbacks too |

Environments: **`github-pages`** (deploy-pages' own; no rules) and
**`terraform-production`** (§3). Repository policy (all Terraform-managed):
`allowed_actions = selected` (GitHub-owned + verified creators), **`sha_pinning_required`**,
secret scanning + push protection + Dependabot security updates **on**.

**Rotating a Cloudflare token:** mint a new account token with the same policy (dashboard,
or the API with a token that has *Account API Tokens Write* — the three CI tokens
deliberately do not), `gh secret set …`, update `ci.env`, run one workflow that uses it
(dispatch Workers / push a docs commit for Build / dispatch Terraform), then delete the
old token. **Rotating the PAT:** the browser form (GitHub has no API for minting a PAT),
same permissions, `gh secret set TF_GITHUB_TOKEN`, `terraform plan` locally, dispatch a
Terraform plan. The org must allow fine-grained PATs and not require expiry — two org
toggles with neither a Terraform resource nor an endpoint.

---

## 5. Terraform — the operating procedure

**Local prerequisites:** Terraform 1.16.x; the env file above (the `AWS_*` pair reaches the
R2 state bucket `merecatholicity-tfstate`, which is deliberately unmanaged); `GITHUB_TOKEN`
set to the PAT for the github provider:

```sh
set -a && . ~/.config/merecatholicity/ci.env && set +a && export GITHUB_TOKEN=$TF_GITHUB_TOKEN
terraform -chdir=terraform init -lockfile=readonly
terraform -chdir=terraform plan          # THE DRIFT CHECK — expect: No changes.
```

**Changing something that is managed:** edit the `.tf`, `terraform fmt`, `validate`, plan
locally, commit, push, approve (§3). Never `terraform apply` locally for a change that could
go through the gate — the pipeline is the audit trail. (A local apply is not forbidden; it
is simply not the road, and the next CI plan will show `No changes` if you did it right.)

**Adopting something made by hand** (the trap this repository fell into on the very day
the state was created — the PDF move made a bucket, a DNS record and a redirect ruleset that
nobody declared):

```sh
# 1. find the id from the live API (rulesets list, dns_records, r2 buckets, gh api …)
# 2. add an `import { to = …  id = "…" }` block to terraform/imports.tf
# 3. let the provider write the HCL, then fold it into the topic file and delete generated.tf:
terraform -chdir=terraform plan -generate-config-out=generated.tf
# 4. iterate until `plan` shows the import and NOTHING ELSE (an "import+update" means your
#    HCL differs from what exists — declare what exists, don't change it in the same move)
# 5. commit, push, approve; the CI apply is the adoption
```

Strip read-only attributes the generator emits (`etag`, ids) or they show as permanent
drift. An import block's `provider =` argument is legal only while generating.

**What Terraform cannot hold** (provider limits — documented, not chosen): Vectorize (no
resource); the R2 custom-domain bindings (`audio.`, `files.`) and the Realtime TURN key (no
import; declaring would create duplicates); Email Routing settings (provider decoder bug
#7301/#7302/#7304). Their DNS records ARE managed.

**The boundary with wrangler:** `wrangler deploy` rewrites a worker's routes, crons,
bindings, vars and secrets on every run. Terraform never declares those, or the two tools
would fight forever. Worker config lives in `wrangler.jsonc`; secrets in `wrangler secret put`.

---

## 6. Workers and migrations

- **Deploy:** push a change under a worker path; Workers runs. Watch it. Manual road (emergencies
  only): `make worker-deploy` — it runs the gates first; never a bare `wrangler deploy`.
  A manual deploy is not drift (the next CI deploy ships the same git source), but it skips
  the ledger step, so run `make migrate` first if a migration is pending.
- **Schema change:** `cd comments-worker && npx wrangler d1 migrations create merecatholicity-comments <name>`
  → a NEW `migrations/NNNN_name.sql` with the **next** number (0012 is next; there were two
  0010s once, one is 0011 now), additive only (`IF NOT EXISTS` / `ALTER` / table-swap);
  `make schema-snapshot` regenerates the read-only `schema.sql`; commit; the push applies it
  before deploying. Check: `make migrate-status` → *No migrations to apply*.
- **Renaming an applied migration file** makes wrangler see it as pending: rename the row in
  `d1_migrations` too (prod AND local miniflare), or the next apply fails on a duplicate
  column.
- **Worker secrets** (`TURNSTILE_SECRET`, `VAPID_PRIVATE_KEY`, `TURN_KEY_SECRET`,
  `CF_USAGE_TOKEN`): `cd comments-worker && npx wrangler secret put NAME`.
  Never in git, never in CI.

---

## 7. The site and the PDFs

- **`docs/` is a mixture.** Hand-maintained source (nav.js, sw.js, the page scripts, the
  vendored libraries, turnstile.html, images, the 17 hand pages, CNAME, .nojekyll) is
  tracked; everything the build writes (corpus pages, bundles, style.css, version.json,
  manifests, Bible JSON, the Logos docx) is git-ignored and rebuilt. `.gitignore` lists the
  generated set; `tests/py/test_docs_sources.py` fails if a new hand page is not added to it.
  **Never hand-edit a generated file; never commit one.**
- **Cache keys are stamped, never bumped by hand** (`scripts/stamp_versions.py`, run by
  `make bundle` and at the end of `make html`). **Never fetch a freshly-stamped `?v=N` URL
  mid-deploy** — probe a throwaway query string (`app.js?probe123`) instead.
- **Verifying a deploy:** `curl -s "https://merecatholicity.com/version.json?probe=$RANDOM"`
  → `build` must equal `docs/version.json`'s in the run's checkout (the run logs `shipping
  build <id>`). HTML is `cf-cache-status: DYNAMIC`; only `sw.js`/`version.json` are purged.
- **PDFs live in R2** (`merecatholicity-files`, `files.merecatholicity.com`, a Cloudflare
  redirect from `/<name>.pdf` on the site hosts). `docs/pdfs.txt` is the manifest (`make
  pdf-manifest`, inside `make html`), linkcheck validates `.pdf` hrefs against it, and
  `make check-pdfs` proves the bucket holds every manifest name and matches every local
  PDF. **CI's bytes are the record**: after a local `make -C resources pdf`, `check-pdfs`
  will say "rebuilt but unpublished" — that is the dev box differing from CI, not a reason
  to upload. `make publish-pdfs` exists for one-offs (needs `CLOUDFLARE_SITE_TOKEN` in the
  env; uploads only what differs; purges those URLs). One PDF has no build:
  `The_Bishop_of_Rome.pdf` is a mirrored source in `resources/docs-src/`, copied in by
  `make mirrored-pdfs`.
- **Adding a corpus work:** converter + `WORKS` line + html stanza in `resources/Makefile`,
  `library.html`, `librarian/works.yml`; the PDF appears in `pdfs.txt` automatically
  (`list-pdfs`) and is published by the next `main` push that builds it.
- **Adding a hand page:** the file under `docs/`, an `!docs/<name>.html` line in
  `.gitignore`, `scripts/nav.py`'s `PAGES`, the test above.

---

## 8. Verification cheat-sheet

```sh
gh run list --limit 6                                   # what ran, what it concluded
gh run view <id> --json jobs --jq '.jobs[]|{name,conclusion}'
gh run view <id> --log-failed                           # the failing step, only
scripts/ci_approve.sh                                   # anything waiting on the gate?
terraform -chdir=terraform plan                         # drift check: No changes.
python3 scripts/publish_pdfs.py --check                 # bucket vs manifest vs local PDFs
cd comments-worker && npx wrangler d1 migrations list merecatholicity-comments --remote
gh secret list; gh variable list                        # the inventory in §4
gh api repos/merecatholicity/merecatholicity.com/actions/permissions   # selected + sha pinning
curl -s "https://merecatholicity.com/version.json?probe=$RANDOM" | grep build
```

---

## 9. Known traps (each one happened; each one is guarded now)

| Symptom | Cause | Guard |
|---|---|---|
| A workflow that "never fails" also never runs | its trigger event stopped firing (`page_build` after Pages moved to an artifact) | when a deploy mechanism changes, audit every trigger that watched the old road |
| `linkcheck: … 246 published PDFs`, `check-pdfs` 404s two names | `make -C resources list-pdfs` under a sub-make wrote `make[2]: Entering directory` into the manifest | `--no-print-directory` + a `.pdf` filter in `pdf-manifest` |
| `make tests` fails in CI on `docs/style.css` | the tests read built output the job never built | Workers restores the site cache and runs `make css` first |
| a test passes locally, fails on the runner against a file in `docs/` that the commit changed; the drift step warns about a doc nobody edited | the site cache restored the previous commit's copy of a TRACKED hand file over the checkout (`docs/` is a mixture) | `git checkout -- docs` + `git clean -fd -- docs` right after the restore, failing if anything tracked still differs |
| a corpus page whose `.tex` changed ships stale; the log says `'../docs/X.html' is up to date` | the version stamp in `make bundle` rewrote every page's `?v=` and bumped its mtime a minute before `make html`, so the cached page outranked its changed source | the stamp writes through `write_keeping_mtime` (invisible to make); the cache key prefix is a generation (`site-2-`) — bump it to force one cold rebuild of everything |
| plan succeeded, `show` cannot find the plan file | `-chdir` resolves paths inside the directory | `tfplan`, not `terraform/tfplan` |
| approval "failed" with a 422 but the apply ran | a fallback second POST after a jq error on the first, successful one | one JSON POST, tolerant printer |
| purge "skipping — not set" with the secret present | the step read the zone id as a *secret*; it is a *variable* | both purge steps read `vars.CLOUDFLARE_ZONE_ID` |
| importing an existing environment wants to *change* it | HCL omitted the policy deploy-pages had set | declare what exists before importing |
| `gh run list --commit <sha>` returns nothing for a run that exists | the filter is flaky with short shas | list unfiltered and match `headSha` |
| a rebuilt PDF keeps serving old bytes | the edge caches PDFs | `publish_pdfs` purges exactly the changed URLs |
| the artifact is 400 MB, not 113 | PDFs built by a LaTeX-touching run rode along | held back at packaging, returned to the cache |
| every Build fails at *Set up job* the moment SHA pinning is required | GitHub's own `upload-pages-artifact` composite references `upload-artifact@v4` by tag internally; the policy applies to nested references | the composite is inlined (tar + pinned upload named `github-pages`) — prefer plain actions over composites under this policy |

---

## 10. Exceptions — done by hand, on purpose, with the reason

1. **Worker secrets** — `wrangler secret put`; a secret does not belong in git or CI.
2. **The librarian ingest** (`make librarian`) — needs the private shelf (a separate private
   clone) and the owner's admin key.
3. **The bootstrap secrets and the state bucket** — `gh secret set` for the five secrets;
   `merecatholicity-tfstate` unmanaged. A credential cannot be minted by the automation it
   authorises; a state store cannot manage itself.
4. **The PAT and the org's PAT policy** — GitHub offers no API for either; browser-only
   owner acts (Administration/Environments/Variables/Pages RW on the two repos; org allows
   fine-grained PATs; expiry not required).
5. **Email Routing settings** — provider decoder bug (#7301/#7302/#7304); its DNS is managed.
6. **R2 custom-domain bindings** (`audio.`, `files.`) and **the TURN key** — no provider
   import; declaring would create duplicates. **Vectorize** — no resource at all.
7. **One-off uploads** — the KJV audio (3.26 GB) and the private-shelf tarball.
8. **Headless verification against production** (`webtest/`) — Bot Fight Mode 403s a
   runner; it runs from the dev box after a deploy.
9. **A history rewrite** — deliberate, backed-up, owner-authorised (last: 2026-09-09,
   554 → 153 MB); never automated. Every pre-rewrite sha is gone; re-clone, don't pull.
10. **The private-shelf repo's scanning** — GHAS is paid on private repositories.
11. **Branch protection on `main`** — none, deliberately: the push is the deploy, and the
    environment gate guards infrastructure.

---

## 11. Anti-drift checklist — what to update when you add…

- **a workflow or a step** → its header comment, this document (§2), the README table.
- **a secret or variable** → §4 here, `terraform/README.md`, `ci.env`, and — for a
  variable — `github.tf` (`github_actions_variable`); a secret is set by hand and *named*
  in the workflow's header comment.
- **an infrastructure object** (DNS, bucket, rule, environment, repo setting) → declare it
  in `terraform/` (import block if it already exists) **in the same change**, or write
  down that you did not and why (§10).
- **a migration** → next number, additive, `make schema-snapshot`.
- **a generated file under `docs/`** → `.gitignore` + `tests/py/test_docs_sources.py`'s
  `buildable()`; a **hand** file → the `!docs/…` exception.
- **a published PDF** → it must come from a make target (or `resources/docs-src/` +
  `mirrored-pdfs`); never upload something no target can rebuild.
- **a gated environment** → create it via the API with its reviewers *before* any workflow
  names it; then import.
- **a deploy-mechanism change** → audit every trigger (rule 9 above).

*Written 2026-09-09, the day the pipeline took over. If this document and the workflows
disagree, the workflows are right and this document is a bug — fix it in the same commit.*
