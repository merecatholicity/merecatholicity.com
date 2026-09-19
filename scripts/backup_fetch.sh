#!/usr/bin/env sh
# scripts/backup_fetch.sh [YYYY-MM-DD] — fetch one of the worker's daily D1 backups
# from R2 (bucket merecatholicity-backups, key backups/comments-<day>.sql.gz —
# Domain.Ops.backupKey) to a file OUTSIDE the repo, and print its path.
# Default day: today (UTC), falling back to yesterday when today's is not there
# yet (the cron writes at 03:15 UTC). Needs CLOUDFLARE_ROOT_TOKEN from
# ~/.config/merecatholicity/ci.env, and `--remote` — without it wrangler reads
# its local store and says the key does not exist. `make comments-backup` runs this and then backup_check.py.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
env_file="${MC_CI_ENV:-$HOME/.config/merecatholicity/ci.env}"
if [ -z "$CLOUDFLARE_ROOT_TOKEN" ] && [ -f "$env_file" ]; then
  # shellcheck disable=SC1090
  set -a; . "$env_file"; set +a
fi
[ -n "$CLOUDFLARE_ROOT_TOKEN" ] || { echo "CLOUDFLARE_ROOT_TOKEN is not set (ci.env)" >&2; exit 2; }
out_dir="${MC_BACKUP_DIR:-$HOME/.config/merecatholicity/backups}"
mkdir -p "$out_dir"
bucket=merecatholicity-backups
fetch() {
  day=$1
  key="backups/comments-$day.sql.gz"
  out="$out_dir/comments-$day.sql.gz"
  if (cd "$here/comments-worker" && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ROOT_TOKEN" npx wrangler r2 object get "$bucket/$key" --remote --file "$out" >/dev/null 2>&1) && [ -s "$out" ]; then
    echo "$out"; return 0
  fi
  rm -f "$out"; return 1
}
if [ -n "$1" ]; then
  fetch "$1" || { echo "no backup object for $1 in $bucket" >&2; exit 1; }
else
  today=$(date -u +%Y-%m-%d)
  yesterday=$(date -u -d yesterday +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)
  fetch "$today" || fetch "$yesterday" || { echo "no backup object for $today or $yesterday in $bucket — the daily cron writes at 03:15 UTC; pass a day (e.g. the 1st of the month)" >&2; exit 1; }
fi
