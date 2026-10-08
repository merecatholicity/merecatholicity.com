#!/usr/bin/env bash
# Ask the reviewer, by name, to review a run that waits on an environment gate.
#
# GitHub notifies an environment's required reviewers that a deployment waits —
# except a reviewer who is the run's own actor: nobody is notified of their own
# activity, and every run here is the owner's (the pushes and the dispatches
# ride their credentials). So the gate went unannounced. Each gated workflow
# runs this in a job beside the gated one, under that job's GITHUB_TOKEN: the
# comment is github-actions[bot]'s, and its @mention reaches the reviewer as
# anyone else's would (the web inbox, email, GitHub Mobile).
#
# The ask is a comment on the run's own commit, so the notification opens onto
# the change that waits. This repository has no issues; a commit comment takes
# `contents: write` (GitHub's table says read; the job token is refused, 403),
# so the asker is one step that runs nothing but this file. The reviewer is read from the gate itself; the
# run's triggering actor stands in if GitHub will not say.
#
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL (Actions
# sets the last three), TRIGGERING_ACTOR.
set -euo pipefail

: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_RUN_ID:?}"
repo=$GITHUB_REPOSITORY
run=$GITHUB_RUN_ID
url="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/$run"

# This job and the gated one start together; wait until the gate holds the run.
# A run the gate never holds (a refused branch, a job skipped) is asked of nobody.
pending='[]'
for _ in $(seq 1 "${ASK_TRIES:-30}"); do
  if pending=$(gh api "repos/$repo/actions/runs/$run/pending_deployments" 2>/dev/null); then
    [ "$(printf %s "$pending" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" != 0 ] && break
  else
    pending='unreadable'
  fi
  sleep 10
done
if [ "$pending" = '[]' ]; then
  echo "no gate holds this run — nobody to ask"
  exit 0
fi

IFS=$'\t' read -r gates who < <(printf %s "$pending" | ACTOR="${TRIGGERING_ACTOR:-}" python3 -c '
import json, os, sys
try:
    p = json.load(sys.stdin)
except ValueError:
    p = []
gates = sorted({d["environment"]["name"] for d in p}) or ["an environment gate"]
who = sorted({r["reviewer"]["login"] for d in p for r in d.get("reviewers", [])
              if r.get("type") == "User"})
if not who and os.environ["ACTOR"]:
    who = [os.environ["ACTOR"]]
print(", ".join(gates) + "\t" + " ".join("@" + w for w in who))
')
if [ -z "$who" ]; then
  echo "::error::the gate names no reviewer and the run no actor — nobody to ask"
  exit 1
fi

# a dispatch's title is the workflow's name again, so the commit's subject says what waits
read -r sha name < <(gh api "repos/$repo/actions/runs/$run" \
  --jq '.head_sha + " " + .name + " · " + (.head_commit.message | split("\n")[0])')

body="$who — **$name** is waiting for your review at \`$gates\`.

[Review deployments]($url) · or \`scripts/ci_approve.sh $run\`"
gh api "repos/$repo/commits/$sha/comments" -f body="$body" --jq .html_url
