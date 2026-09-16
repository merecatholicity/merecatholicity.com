#!/usr/bin/env sh
# scripts/agent_worktree.sh <name> — a checkout of its own for a second agent
# (CLAUDE.md, "Two agents never share a checkout", 2026-09-16). Makes a detached
# worktree at local/wt/<name> on origin/main (local/ is git-ignored), shares
# node_modules by symlink (the toolchain is the same), and leaves the kernel
# output to `make psbuild` there — each worktree compiles its own
# purescript/output, so one agent's build never rewrites the other's. Work,
# commit and push FROM the worktree; the shared checkout is only ever
# fast-forwarded (`git pull --ff-only`).
set -e
name=${1:?usage: scripts/agent_worktree.sh <name>}
here=$(cd "$(dirname "$0")/.." && pwd)
dir="$here/local/wt/$name"
[ ! -e "$dir" ] || { echo "$dir exists" >&2; exit 1; }
cd "$here"
git fetch -q origin
git worktree add --detach "$dir" origin/main
ln -s "$here/node_modules" "$dir/node_modules"
cat <<MSG
worktree ready: $dir  (detached at origin/main)
  cd $dir
  git switch -c <branch>      # or work detached and push with: git push origin HEAD:main
  make psbuild                # its own purescript/output
  # when done: cd $here && git worktree remove $dir
MSG
