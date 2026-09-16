#!/usr/bin/env sh
# scripts/worker_bundle_set.sh <outdir> — the comments worker's dry-run bundle,
# reduced to three sorted sets: its top-level function names, its code lines and its string literals
# (esbuild's numeric-suffix renames normalised, comments dropped). A
# behaviour-neutral worker change — a handler moved between files, a type
# annotation — leaves both sets identical; a function the bundler dropped (the
# 2026-08-01 tree-shake around the Durable Object re-export) shows up in
# functions.txt. Run it on the parent commit and on the change, then
#   diff /tmp/cw-before/functions.txt /tmp/cw-after/functions.txt
#   diff /tmp/cw-before/lines.txt     /tmp/cw-after/lines.txt
#   diff /tmp/cw-before/strings.txt   /tmp/cw-after/strings.txt   (identical, or additions only)
# Needs no credentials: `wrangler deploy --dry-run` only bundles.
set -e
out=${1:?usage: scripts/worker_bundle_set.sh <outdir>}
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
(cd "$here/comments-worker" && npx wrangler deploy --dry-run --outdir "$out") >/dev/null 2>&1
b="$out/index.js"
grep -oE '^(async )?function [A-Za-z_$][A-Za-z0-9_$]*' "$b" \
  | sed -E 's/^(async )?function //; s/[0-9]+$//' | sort -u > "$out/functions.txt"
grep -vE '^[[:space:]]*//' "$b" \
  | sed -E 's/^[[:space:]]+//; s/([A-Za-z_$][A-Za-z0-9_$]*[A-Za-z_$])[0-9]+\b/\1/g' | sort -u > "$out/lines.txt"
# the string literals (single- or double-quoted, no escapes inside), sorted unique: a
# refactor that keeps every wire text leaves this set identical or adds to it
grep -oE "'[^'\\]*'|\"[^\"\\]*\"" "$b" | sort -u > "$out/strings.txt"
wc -l "$b" "$out/functions.txt" "$out/lines.txt" "$out/strings.txt"
