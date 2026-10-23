#!/bin/sh
# Manual deploy (no Pages workflow is configured in this repo):
# collect → archive (commit to the `data` branch) → public build (credential-checked) → replace gh-pages.
set -eu
cd "$(dirname "$0")/.."
npm run collect

archive="$(mktemp -d)"
site="$(mktemp -d)"
trap 'git worktree remove --force "$archive" 2>/dev/null || true; git worktree remove --force "$site" 2>/dev/null || true' EXIT
git fetch -q origin data gh-pages
git worktree add -q --detach "$archive" origin/data
npm run archive -- "$archive"
git -C "$archive" add -A
if git -C "$archive" commit -q -m "Archive $(date -u +%Y-%m-%dT%H:%MZ)"; then
  git -C "$archive" push -q origin HEAD:data
fi

env -u MOENV_API_KEY npm run build:public
git worktree add -q --detach "$site" origin/gh-pages
find "$site" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R apps/web/dist/. "$site"/
touch "$site/.nojekyll"
git -C "$site" add -A
git -C "$site" commit -q -m "Deploy snapshot" || { echo "nothing to deploy"; exit 0; }
git -C "$site" push -q origin HEAD:gh-pages
echo "deployed $(git -C "$site" rev-parse --short HEAD)"
