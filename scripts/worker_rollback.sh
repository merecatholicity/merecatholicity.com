#!/usr/bin/env sh
# scripts/worker_rollback.sh [version-id] — roll the comments worker back to an
# earlier Version (the previous one when no id is given), then probe. The drill
# of 2026-09-16 (CICD.md §12): `wrangler rollback` re-points 100% of traffic at
# an already-uploaded Version in seconds; it is refused across a Durable Object
# class migration or a deleted binding — then `git revert` + push is the road.
# A rollback does not undo D1 migrations (additive by law, so the older worker
# keeps running). ALWAYS pair it with a `git revert` push, or the next push
# re-deploys what you just rolled away from. Needs the workers token (ci.env).
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
[ -n "$CLOUDFLARE_API_TOKEN" ] || { echo "no workers token (CLOUDFLARE_WORKERS_TOKEN in ci.env)" >&2; exit 2; }
cd "$here/comments-worker"
current=$(npx wrangler deployments status --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['versions'][0]['version_id'])")
echo "current version: $current"
target=$1
if [ -z "$target" ]; then
  # the newest version that is not the current one (versions list is oldest-first)
  target=$(npx wrangler versions list --json 2>/dev/null | python3 -c "
import json,sys
v=json.load(sys.stdin); cur='$current'
ids=[x['id'] for x in sorted(v, key=lambda x: x['metadata']['created_on']) if x['id']!=cur]
print(ids[-1] if ids else '')")
  [ -n "$target" ] || { echo "no earlier version to roll back to" >&2; exit 1; }
fi
echo "rolling back to:  $target"
t0=$(date +%s)
npx wrangler rollback "$target" --message "${MC_ROLLBACK_MESSAGE:-rollback by scripts/worker_rollback.sh}" -y
t1=$(date +%s)
echo "rolled back in $((t1 - t0)) s; probing"
code=$(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0' https://merecatholicity.com/api/comments/config || true)
echo "GET /api/comments/config -> $code"
npx wrangler deployments status 2>/dev/null | grep -E "^Created:|Version\(s\)" | head -2
echo "now: git revert the commit that shipped the bad version and push, or the next push re-deploys it"
