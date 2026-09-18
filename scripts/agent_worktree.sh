#!/usr/bin/env sh
# scripts/agent_worktree.sh <name> — a checkout of its own for a second agent
# (CLAUDE.md, "Two agents never share a checkout", 2026-09-16). Makes a detached
# worktree at local/wt/<name> on origin/main (local/ is git-ignored), shares
# node_modules by symlink (the toolchain is the same), and leaves the kernel
# output to `make psbuild` there — each worktree compiles its own
# purescript/output, so one agent's build never rewrites the other's. Work,
# commit and push FROM the worktree; the shared checkout is only ever
# fast-forwarded (`git pull --ff-only`).
#
# RUN IT AGAIN ON AN EXISTING WORKTREE TO REPAIR IT (2026-09-18). The
# node_modules symlink was briefly TRACKED — `.gitignore` said `node_modules/`
# and a trailing slash never matches a symlink of that name — so any worktree
# that hard-resets or checks out past the commit which untracked it (c8e3363)
# has git DELETE the link from disk, exactly as it would any other file the new
# commit does not carry. Nothing is broken and the fix was right; but every npm,
# npx and make command in that worktree then fails with a missing-module error
# that looks nothing like "a checkout removed your symlink", and it cost two
# sessions time on the day. So this script no longer only refuses when the
# directory exists: it puts back what it knows how to put back, and says so.
set -e
name=${1:?usage: scripts/agent_worktree.sh <name>  (run again to repair an existing one)}

# THE MAIN CHECKOUT, not the tree this copy of the script happens to sit in
# (2026-09-18). Every worktree carries scripts/ too, so `$(dirname $0)/..` is
# whichever checkout you invoked it from — and "make myself a worktree" is a
# natural thing to do from wherever you already are. Run from a worktree, the
# old line built local/wt/<name> INSIDE that worktree: a nested worktree that
# registers in `git worktree list`, shares the stash stack, and links its
# node_modules to the nested parent's. `--git-common-dir` answers the SHARED
# repository from inside any worktree (and `.git`, relatively, from the main
# checkout), so both roads now land in the same place.
cd "$(dirname "$0")"
common=$(git rev-parse --git-common-dir 2>/dev/null) \
  || { echo "not inside a git checkout of this repository" >&2; exit 1; }
case "$common" in /*) ;; *) common="$PWD/$common" ;; esac
here=$(cd "$common/.." && pwd)
[ -f "$here/scripts/agent_worktree.sh" ] \
  || { echo "cannot find the main checkout (resolved $here)" >&2; exit 1; }
dir="$here/local/wt/$name"

link_node_modules() {
  # -n so an existing link to a DIRECTORY is replaced rather than followed into
  # it (ln -sf alone would write inside the target); -f so a stale link goes.
  ln -sfn "$here/node_modules" "$dir/node_modules"
}

if [ -e "$dir" ]; then
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] || { echo "$dir exists and is not a worktree" >&2; exit 1; }
  if [ -e "$dir/node_modules" ]; then
    echo "worktree $dir is intact (node_modules -> $(readlink "$dir/node_modules" || echo 'a real directory'))"
  else
    link_node_modules
    echo "repaired $dir: node_modules symlink restored (a checkout past c8e3363 removes it)"
  fi
  exit 0
fi

cd "$here"
git fetch -q origin
git worktree add --detach "$dir" origin/main
link_node_modules
cat <<MSG
worktree ready: $dir  (detached at origin/main)
  cd $dir
  git switch -c <branch>      # or work detached and push with: git push origin HEAD:main
  make psbuild                # its own purescript/output
  # node_modules gone after a reset? run this script again with the same name
  # when done: cd $here && git worktree remove $dir
MSG
