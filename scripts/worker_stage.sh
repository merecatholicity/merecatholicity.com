#!/usr/bin/env sh
# scripts/worker_stage.sh stage [percent] | promote | status — the staged
# rollout (2026-09-16, CICD.md §12). `stage` uploads the checkout as a new
# Version WITHOUT deploying it, then splits traffic: <percent>% to the new
# Version, the rest to the current one. `promote` sends 100% to the newest
# uploaded Version. `status` shows the split. The workflow's
# `workflow_dispatch` (mode=stage|promote) runs these from CI — the build of
# record; the hand road below is for the dev box in an emergency.
# Caveats: a staged Version does not update triggers/routes (`wrangler
# triggers deploy` after a cron change); a split across a Durable Object
# class migration is refused; the D1 ledger is applied before either mode.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
env_file="${MC_CI_ENV:-$HOME/.config/merecatholicity/ci.env}"
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  if [ -n "$CLOUDFLARE_WORKERS_TOKEN" ]; then CLOUDFLARE_API_TOKEN="$CLOUDFLARE_WORKERS_TOKEN"
  elif [ -f "$env_file" ]; then
    # shellcheck disable=SC1090
    set -a; . "$env_file"; set +a; CLOUDFLARE_API_TOKEN="$CLOUDFLARE_WORKERS_TOKEN"
  fi
fi
export CLOUDFLARE_API_TOKEN
[ -n "$CLOUDFLARE_API_TOKEN" ] || { echo "no workers token (CLOUDFLARE_WORKERS_TOKEN in ci.env, or CLOUDFLARE_API_TOKEN)" >&2; exit 2; }
mode=${1:?usage: worker_stage.sh stage [percent] | promote | status}
cd "$here/comments-worker"
current() { npx wrangler deployments status --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['versions'][0]['version_id'])"; }
newest() { npx wrangler versions list --json 2>/dev/null | python3 -c "import json,sys; v=json.load(sys.stdin); print(sorted(v, key=lambda x: x['metadata']['created_on'])[-1]['id'])"; }
case "$mode" in
  stage)
    pct=${2:-10}
    case "$pct" in ''|*[!0-9]*) echo "percent must be an integer 1-99" >&2; exit 2;; esac
    [ "$pct" -ge 1 ] && [ "$pct" -le 99 ] || { echo "percent must be 1-99" >&2; exit 2; }
    cur=$(current)
    echo "current version: $cur"
    out=$(npx wrangler versions upload --message "${MC_STAGE_MESSAGE:-staged by scripts/worker_stage.sh}" 2>&1 | grep -v "npm notice") || { echo "$out"; exit 1; }
    echo "$out" | grep -E "Worker Version ID|Uploaded" || true
    new=$(echo "$out" | sed -n 's/.*Worker Version ID: *\([0-9a-f-]*\).*/\1/p' | head -1)
    [ -n "$new" ] || new=$(newest)
    echo "new version:     $new"
    rest=$((100 - pct))
    npx wrangler versions deploy "$new@$pct%" "$cur@$rest%" --message "stage $pct% of $new" -y
    echo "staged: $pct% -> $new, $rest% -> $cur. Watch, then: scripts/worker_stage.sh promote (or rollback: scripts/worker_rollback.sh $cur)"
    ;;
  promote)
    new=$(newest)
    echo "promoting newest version $new to 100%"
    npx wrangler versions deploy "$new@100%" --message "promote $new" -y
    ;;
  status)
    npx wrangler deployments status 2>/dev/null | grep -v "npm notice"
    ;;
  *) echo "unknown mode $mode" >&2; exit 2;;
esac
