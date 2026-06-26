#!/usr/bin/env bash
set -euo pipefail

BRANCH="main"
REMOTE="origin"

cd "$(dirname "$0")"

# must be a git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "ERROR: Not inside a git repository"
  exit 1
}

# ensure branch exists + is checked out
current_branch="$(git branch --show-current)"
if [[ -z "${current_branch}" ]]; then
  echo "ERROR: Detached HEAD. Checkout a branch first."
  exit 1
fi

if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "ERROR: You are on branch '$current_branch' (expected '$BRANCH')"
  echo "Fix: git branch -M $BRANCH && git checkout $BRANCH"
  exit 1
fi

echo "== Status (before) =="
git status --short
echo

# stash if there are local changes so pull --rebase won't fail
stashed=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "== Stashing local changes (safe) =="
  git stash push -u -m "push.sh auto-stash $(date -Iseconds)"
  stashed=1
  echo
fi

# detect whether remote branch exists yet
remote_has_branch=0
if git ls-remote --heads "$REMOTE" "$BRANCH" | grep -q "$BRANCH"; then
  remote_has_branch=1
fi

if [[ "$remote_has_branch" == "1" ]]; then
  echo "== Fetching latest from ${REMOTE}/${BRANCH} =="
  git fetch "$REMOTE" "$BRANCH"
  echo

  echo "== Rebasing local branch on top of remote =="
  git pull --rebase "$REMOTE" "$BRANCH"
  echo
else
  echo "== Remote branch ${REMOTE}/${BRANCH} does not exist yet (first push) =="
  echo
fi

if [[ "$stashed" == "1" ]]; then
  echo "== Re-applying stashed changes =="
  git stash pop || {
    echo
    echo "NOTE: stash pop had conflicts. Resolve them, then run ./push.sh again."
    exit 1
  }
  echo
fi

echo "== Stage changes =="
git add .
echo

if git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi

msg="${1:-update demo}"
echo "== Commit: $msg =="
git commit -m "$msg"
echo

echo "== Push to ${REMOTE}/${BRANCH} =="
if [[ "$remote_has_branch" == "1" ]]; then
  git push "$REMOTE" "$BRANCH"
else
  # first push creates the branch upstream
  git push -u "$REMOTE" HEAD:"$BRANCH"
fi

echo
echo "== Done =="
git status --short

