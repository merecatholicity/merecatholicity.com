#!/usr/bin/env bash
# Review and approve (or reject) a CI run that is waiting on an environment gate —
# the Terraform apply's `terraform-production` environment.
#
# A human approves in the browser: the run page shows "Review deployments". This
# is the same act from a shell, so the AI operator (or anyone with gh) can do it
# too. It uses the caller's own gh credentials; GitHub requires the caller to be
# one of the environment's required reviewers.
#
#   scripts/ci_approve.sh                       # list runs waiting for review
#   scripts/ci_approve.sh <run-id>              # show the plan summary + what is pending
#   scripts/ci_approve.sh <run-id> --approve [comment]
#   scripts/ci_approve.sh <run-id> --reject  [comment]
#
# The plan summary it prints is the `tf-plan-summary` artifact the plan job
# uploads — resource addresses, actions and attribute NAMES, with values only for
# non-sensitive attributes. The plan file itself is never uploaded anywhere.
set -euo pipefail

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

if [ $# -eq 0 ]; then
  echo "Runs waiting for review in $repo:"
  gh run list --status waiting --json databaseId,workflowName,displayTitle,headBranch,createdAt \
    --template '{{range .}}  {{.databaseId}}  {{.workflowName}}  {{.headBranch}}  {{.createdAt}}  {{.displayTitle}}{{"\n"}}{{end}}'
  echo "  (none above = nothing waiting)  ·  scripts/ci_approve.sh <run-id> to review one"
  exit 0
fi

run=$1; shift
mode=${1:-show}; [ $# -gt 0 ] && shift
comment=${1:-"approved via scripts/ci_approve.sh"}

echo "== run $run"
gh run view "$run" --json workflowName,displayTitle,headBranch,status,conclusion,url \
  --template '{{.workflowName}} · {{.displayTitle}}{{"\n"}}{{.headBranch}} · {{.status}}{{if .conclusion}} · {{.conclusion}}{{end}}{{"\n"}}{{.url}}{{"\n"}}'

echo "== plan summary"
tmp=$(mktemp -d)
if gh run download "$run" -n tf-plan-summary -D "$tmp" >/dev/null 2>&1; then
  cat "$tmp"/*.md
else
  echo "(no tf-plan-summary artifact — not a Terraform run, or the plan job has not finished)"
fi
rm -rf "$tmp"

echo "== pending environments"
pending=$(gh api "repos/$repo/actions/runs/$run/pending_deployments")
PENDING="$pending" python3 - <<'PY'
import json, os
p = json.loads(os.environ['PENDING'] or '[]')
if not p:
    print('  (nothing pending on this run)')
for d in p:
    e = d.get('environment', {})
    print(f"  {e.get('id')}  {e.get('name')}  waiting since {d.get('wait_timer_started_at')}  can approve: {d.get('current_user_can_approve')}")
PY

case "$mode" in
  show) exit 0 ;;
  --approve|--reject)
    state=${mode#--}; [ "$state" = approve ] && state=approved || state=rejected
    ids=$(PENDING="$pending" python3 -c 'import json,os;print(" ".join(str(d["environment"]["id"]) for d in json.loads(os.environ["PENDING"] or "[]")))')
    if [ -z "$ids" ]; then echo "nothing to $state"; exit 1; fi
    args=()
    for id in $ids; do args+=(-F "environment_ids[]=$id"); done
    gh api -X POST "repos/$repo/actions/runs/$run/pending_deployments" \
      "${args[@]}" -f "state=$state" -f "comment=$comment" \
      --jq '.[] | "  " + .environment.name + " -> " + .state' 2>/dev/null \
      || gh api -X POST "repos/$repo/actions/runs/$run/pending_deployments" "${args[@]}" -f "state=$state" -f "comment=$comment"
    echo "== $state: $run"
    ;;
  *) echo "unknown mode: $mode (use --approve or --reject)"; exit 2 ;;
esac
