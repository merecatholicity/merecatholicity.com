#!/usr/bin/env bash
# scripts/ship.sh — the one road to main (2026-10-09). main takes no direct
# push (terraform/github.tf, the `main` ruleset): every change is a pull request
# whose required checks pass. This pushes the checkout's commits to a branch,
# opens its pull request (or finds the open one), arms auto-merge so GitHub
# merges the moment the checks are green, and waits — for the merge, which IS
# the deploy, or for the check that failed.
#
#   scripts/ship.sh                    the current branch; a detached HEAD (an
#                                      agent worktree) ships as agent/<worktree>
#   scripts/ship.sh --title "…"        default: the newest commit's subject
#   scripts/ship.sh --body-file FILE   default: every commit message on the branch
#   scripts/ship.sh --squash           a squash merge instead of a merge commit
#   scripts/ship.sh --no-wait          arm auto-merge and return
#
# A red check leaves auto-merge armed: fix, commit, run this again — the same
# branch, the same pull request. The pull request's pipeline report
# (scripts/ci_pr_report.py) carries the failing step's log tail. Never from
# the shared checkout's main: that checkout is only ever fast-forwarded.
set -euo pipefail

title= bodyfile= method=--merge wait=1
while [ $# -gt 0 ]; do
  case "$1" in
    --title) title=${2:?--title needs text}; shift 2 ;;
    --body-file) bodyfile=${2:?--body-file needs a file}; shift 2 ;;
    --squash) method=--squash; shift ;;
    --no-wait) wait=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "ship.sh: unknown argument $1" >&2; exit 64 ;;
  esac
done

git fetch -q origin main
ahead=$(git rev-list --count origin/main..HEAD)
[ "$ahead" -gt 0 ] || { echo "nothing to ship: HEAD is already in origin/main"; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "note: uncommitted changes stay here — only commits ship"
fi

branch=$(git symbolic-ref -q --short HEAD || true)
if [ "$branch" = main ]; then
  echo "ship.sh: refusing to ship from main — main takes no direct push, and this checkout's main is" >&2
  echo "  only ever fast-forwarded. \`git switch -c <branch>\` first, or work in scripts/agent_worktree.sh's worktree." >&2
  exit 1
fi
if [ -z "$branch" ]; then
  # a detached HEAD: name it after its worktree (local/wt/<name>), so a fix
  # pushed from the same worktree lands on the same pull request
  wt=$(basename "$(git rev-parse --show-toplevel)")
  branch="agent/$wt"
  remote=$(git ls-remote origin "refs/heads/$branch" | cut -f1)
  if [ -n "$remote" ] && ! git merge-base --is-ancestor "$remote" HEAD 2>/dev/null; then
    taken=$branch
    branch="agent/$wt-$(git rev-parse --short HEAD)"
    echo "note: origin's $taken holds work this HEAD does not carry; shipping as $branch"
  fi
fi

echo "shipping $ahead commit(s) as $branch"
git push -q origin "HEAD:refs/heads/$branch"

n=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -z "$n" ]; then
  [ -n "$title" ] || title=$(git log -1 --format=%s)
  if [ -z "$bodyfile" ]; then
    bodyfile=$(mktemp)
    trap 'rm -f "$bodyfile"' EXIT
    git log --reverse --format='### %s%n%n%b' origin/main..HEAD > "$bodyfile"
  fi
  url=$(gh pr create --base main --head "$branch" --title "$title" --body-file "$bodyfile")
  n=${url##*/}
  echo "opened $url"
else
  echo "updated the open pull request #$n"
fi

# Auto-merge: GitHub merges when the required checks pass. A pull request that
# is already mergeable ("clean": its checks passed) cannot be armed — merge it
# outright. Anything else is armed, and a refusal to arm is the answer: never a
# plain merge in its place.
merge_state() { gh pr view "$n" --json mergeStateStatus --jq .mergeStateStatus; }
case "$(merge_state)" in
  CLEAN|UNSTABLE|HAS_HOOKS) gh pr merge "$n" "$method" ;;
  *) if ! gh pr merge "$n" --auto "$method"; then
       [ "$(merge_state)" = CLEAN ] && gh pr merge "$n" "$method" \
         || { echo "ship.sh: #$n — auto-merge could not be armed (above)" >&2; exit 1; }
     fi ;;
esac
[ "$wait" = 1 ] || { echo "auto-merge armed on #$n; not waiting"; exit 0; }

echo "waiting for #$n: the required checks, then the merge (the deploy)…"
for _ in $(seq 1 180); do
  verdict=$(gh pr view "$n" --json state,mergeCommit,statusCheckRollup | python3 -c '
import json, sys
p = json.load(sys.stdin)
if p["state"] == "MERGED":
    print("merged " + ((p.get("mergeCommit") or {}).get("oid") or "")); sys.exit()
if p["state"] == "CLOSED":
    print("closed"); sys.exit()
bad = [c for c in p.get("statusCheckRollup") or []
       if (c.get("conclusion") or c.get("state") or "").upper() in
          ("FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED")]
if bad:
    print("failed " + " ".join("%s(%s)" % (c.get("name") or c.get("context"), c.get("detailsUrl") or c.get("targetUrl") or "") for c in bad))
else:
    print("pending")
')
  case "$verdict" in
    merged*) sha=${verdict#merged }
             echo "merged #$n as ${sha:0:7} — the merge is the deploy: gh run list --limit 6"
             exit 0 ;;
    closed) echo "#$n was closed without merging" >&2; exit 1 ;;
    failed*) echo "#$n: a check failed — ${verdict#failed }" >&2
             echo "auto-merge stays armed: fix, commit, run scripts/ship.sh again (same branch, same PR)" >&2
             exit 1 ;;
  esac
  sleep 20
done
echo "#$n has not merged in an hour; auto-merge stays armed (gh pr checks $n)" >&2
exit 2
